// Lógica da fila de entrada (sem dependências do Cloudflare, testável no Vitest).
//
// Caminho de cada webhook:
//   Meta / Evolution  ->  Worker (responde 200 na hora e guarda na fila)
//                     ->  consumidor da fila  ->  edge function no Supabase
// Se o Supabase estiver fora, a mensagem fica na fila e é reenviada depois.

/** Edge functions que podem receber pela fila. */
export const TARGETS = ["evolution-in", "meta-webhook", "meta-in"] as const;
export type Target = (typeof TARGETS)[number];

// Cabeçalhos repassados. As funções conferem a assinatura da Meta e o token
// da Evolution sobre o corpo original, então o corpo vai byte a byte.
const FORWARDED_HEADERS = [
  "content-type",
  "x-hub-signature-256",
  "x-hub-signature",
  "x-webhook-secret",
];

// Limite de uma mensagem na fila do Cloudflare é 128 KB. Acima disso o
// webhook é repassado direto, sem fila.
export const MAX_QUEUE_MESSAGE_BYTES = 120 * 1024;

export type QueuedWebhook = {
  target: Target;
  /** Query string original, com "?" (a Evolution manda o token aqui) */
  search: string;
  headers: Record<string, string>;
  /** Corpo original em base64 */
  body: string;
  receivedAt: string;
};

/** "/evolution-in" -> "evolution-in"; qualquer outro caminho -> null. */
export const targetFromPath = (pathname: string): Target | null => {
  const name = pathname.replace(/^\/+|\/+$/g, "");
  return (TARGETS as readonly string[]).includes(name) ? (name as Target) : null;
};

export const pickHeaders = (headers: Headers) => {
  const picked: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = headers.get(name);
    if (value !== null) picked[name] = value;
  }
  return picked;
};

export const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

export const fromBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export const buildQueuedWebhook = (
  target: Target,
  url: URL,
  headers: Headers,
  body: Uint8Array,
  now = new Date(),
): QueuedWebhook => ({
  target,
  search: url.search,
  headers: pickHeaders(headers),
  body: toBase64(body),
  receivedAt: now.toISOString(),
});

export const queuedSize = (message: QueuedWebhook) =>
  new TextEncoder().encode(JSON.stringify(message)).length;

/** Endereço da edge function, mantendo a query string original. */
export const functionUrl = (functionsBaseUrl: string, target: Target, search: string) =>
  `${functionsBaseUrl.replace(/\/+$/, "")}/${target}${search}`;

/**
 * O que fazer com a resposta da edge function:
 * - 2xx: entregue
 * - 408, 425, 429 e 5xx: Supabase fora ou sobrecarregado, tenta de novo
 * - outros 4xx (token errado, conexão inexistente): repetir não adianta
 */
export const deliveryOutcome = (status: number): "delivered" | "retry" | "rejected" => {
  if (status >= 200 && status < 300) return "delivered";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  return "rejected";
};

/**
 * Espera antes da próxima tentativa: 15 s, 30 s, 1 min, 2 min, 4 min, 8 min
 * e depois a cada 15 min. Com 100 tentativas cobre cerca de 24 horas, o
 * tempo que o plano grátis guarda as mensagens.
 */
export const retryDelaySeconds = (attempts: number) =>
  Math.min(15 * 2 ** Math.max(0, attempts - 1), 900);

// ── Filtro da Evolution ─────────────────────────────────────────────────────
// O webhook global da Evolution manda todos os eventos (contatos, presença,
// chats, edições...), mas o evolution-in só usa estes. Descartar o resto aqui
// evita gastar operações da fila (em 09/11/2026 eram ~55% do volume).
// Mantenha em sincronia com supabase/functions/evolution-in/index.ts.
const EVOLUTION_USED_EVENTS = new Set([
  "messages.upsert",
  "messages.update",
  "connection.update",
  "qrcode.updated",
]);

/** "MESSAGES_UPSERT" e "messages-upsert" -> "messages.upsert" */
const normalizeEvent = (event: string) => event.toLowerCase().replace(/[_-]/g, ".");

/** Grupos, Status do WhatsApp, canais e listas de transmissão (o evolution-in ignora). */
const isIgnoredJid = (jid: unknown) =>
  typeof jid === "string" &&
  (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter"));

/**
 * Motivo para descartar um webhook da Evolution antes da fila, ou null para
 * seguir. Na dúvida (JSON inválido, formato desconhecido), segue: quem decide
 * é o evolution-in.
 */
export const evolutionSkipReason = (body: Uint8Array): string | null => {
  let payload: { event?: unknown; data?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  if (typeof payload?.event !== "string") return null;
  const event = normalizeEvent(payload.event);

  if (!EVOLUTION_USED_EVENTS.has(event)) return `event:${event}`;

  if (event === "messages.upsert") {
    const jid = (payload.data as { key?: { remoteJid?: unknown } } | undefined)?.key?.remoteJid;
    return isIgnoredJid(jid) ? "jid" : null;
  }

  if (event === "messages.update") {
    // O evolution-in só grava entregue/lido das mensagens que nós enviamos (fromMe)
    type Item = { fromMe?: unknown; key?: { fromMe?: unknown } } | null;
    const items: Item[] = Array.isArray(payload.data) ? payload.data : [payload.data as Item];
    const hasFromMe = items.some((item) => (item?.fromMe ?? item?.key?.fromMe) === true);
    return hasFromMe ? null : "update_not_from_me";
  }

  return null;
};
