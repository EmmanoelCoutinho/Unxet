// deno-lint-ignore-file
// @ts-nocheck
// Recuperação das mensagens recebidas enquanto o WhatsApp por QR Code esteve
// fora do ar (sem dependências, testável no Vitest).
//
// Quando a sessão trava ou o número é desconectado, as mensagens dos clientes
// não geram webhook e nunca chegam ao Unxet. Ao ler o QR Code de novo, o
// celular manda o histórico recente para a Evolution, que guarda no banco
// dela. Depois que a conexão volta, o evolution-connection-sync pergunta à
// Evolution (/chat/findMessages) o que chegou desde a última mensagem que o
// Unxet recebeu e importa o que falta pelo próprio evolution-in.
// Marcas da conexão: migration 20261118000000_inbound_recovery.sql.

/** Espera o celular terminar de mandar o histórico antes da primeira busca. */
export const RECOVERY_WAIT_MINUTES = 2;
/** Depois disso a recuperação é encerrada (a busca roda a cada 5 minutos). */
export const RECOVERY_LAST_RUN_MINUTES = 30;
/** Folga antes da última mensagem recebida (relógios diferentes). */
export const RECOVERY_MARGIN_MINUTES = 5;
/** Não volta mais que isso, por mais tempo que o número tenha ficado fora. */
export const RECOVERY_MAX_DAYS = 7;
/**
 * Mensagens por página e teto de páginas de uma busca (até 10 mil). O
 * histórico gravado na Evolution inclui grupos, que a busca não consegue
 * filtrar e que passam a maior parte do volume; elas são descartadas depois.
 * A Evolution devolve da mais nova para a mais antiga: se o teto for atingido,
 * as mais antigas ficam de fora (o log marca "truncated").
 */
export const RECOVERY_PAGE_SIZE = 250;
export const RECOVERY_MAX_PAGES = 40;

/**
 * Em que ponto a recuperação está:
 * - "wait": acabou de conectar, o histórico ainda está chegando
 * - "run": busca e importa o que falta
 * - "last": última busca; depois dela a marca é limpa
 */
export const recoveryPhase = (requestedAt: unknown, now = new Date()) => {
  const requested = new Date(requestedAt as string).getTime();
  if (Number.isNaN(requested)) return "last";
  const minutes = (now.getTime() - requested) / 60000;
  if (minutes < RECOVERY_WAIT_MINUTES) return "wait";
  return minutes >= RECOVERY_LAST_RUN_MINUTES ? "last" : "run";
};

/**
 * Intervalo a buscar na Evolution: da última mensagem que o Unxet tinha
 * recebido (com folga) até agora. Null quando o número nunca recebeu nada:
 * conexão nova não importa histórico.
 */
export const recoveryWindow = (from: unknown, now = new Date()) => {
  const fromTime = new Date(from as string).getTime();
  if (!from || Number.isNaN(fromTime)) return null;
  const oldest = now.getTime() - RECOVERY_MAX_DAYS * 24 * 60 * 60000;
  const start = Math.max(fromTime - RECOVERY_MARGIN_MINUTES * 60000, oldest);
  if (start >= now.getTime()) return null;
  return { gte: new Date(start).toISOString(), lte: now.toISOString() };
};

const isCustomerChatJid = (jid: unknown) =>
  typeof jid === "string" &&
  (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"));

/**
 * Das mensagens guardadas na Evolution, as que interessam: enviadas por
 * clientes em conversas individuais, sem repetição, da mais antiga para a
 * mais nova (a ordem em que devem entrar na conversa).
 */
export const pickRecoverable = (records: unknown) => {
  const seen = new Set<string>();
  const picked = [];
  for (const record of Array.isArray(records) ? records : []) {
    const id = String(record?.key?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    if (record?.key?.fromMe !== false) continue;
    if (!isCustomerChatJid(record?.key?.remoteJid)) continue;
    if (!record?.message || typeof record.message !== "object") continue;
    seen.add(id);
    picked.push(record);
  }
  return picked.sort((a, b) => Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0));
};

/**
 * Corpo que o evolution-in recebe para uma mensagem recuperada: o mesmo
 * formato do webhook messages.upsert, só com os campos que ele usa.
 */
export const recoveredWebhookBody = (sessionName: string, record) => ({
  event: "messages.upsert",
  instance: sessionName,
  recovered: true,
  data: {
    key: record.key,
    pushName: record.pushName ?? null,
    message: record.message,
    messageType: record.messageType ?? null,
    messageTimestamp: record.messageTimestamp,
  },
});

/**
 * Busca na Evolution as mensagens do intervalo, página por página.
 * Devolve null quando a Evolution não respondeu direito (tenta de novo na
 * próxima rodada) e `truncated` quando havia mais páginas que o teto.
 */
export const fetchStoredMessages = async (
  apiUrl: string,
  apiKey: string,
  sessionName: string,
  window: { gte: string; lte: string },
  { fetchImpl = fetch, timeoutMs = 15000, maxPages = RECOVERY_MAX_PAGES } = {},
) => {
  const url = `${apiUrl.replace(/\/$/, "")}/chat/findMessages/${encodeURIComponent(sessionName)}`;
  const records = [];
  let pages = 1;
  for (let page = 1; page <= pages && page <= maxPages; page++) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({
          where: { messageTimestamp: window },
          page,
          offset: RECOVERY_PAGE_SIZE,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel?.();
        console.warn("[INBOUND_RECOVERY_FETCH_FAILED]", { sessionName, page, status: response.status });
        return null;
      }
      const json = await response.json();
      const result = json?.messages ?? json;
      const pageRecords = Array.isArray(result?.records) ? result.records : Array.isArray(result) ? result : [];
      records.push(...pageRecords);
      pages = Number(result?.pages) > 0 ? Number(result.pages) : 1;
      if (pageRecords.length === 0) break;
    } catch (err) {
      console.warn("[INBOUND_RECOVERY_FETCH_ERROR]", {
        sessionName,
        page,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  return { records, truncated: pages > maxPages };
};

// ── Telefone das mensagens com @lid ─────────────────────────────────────────
// As mensagens que chegam ao vivo trazem o telefone real junto do @lid
// (remoteJidAlt). As que vêm do histórico do pareamento podem vir só com o
// @lid, e sem telefone o evolution-in descarta a mensagem. O telefone é
// procurado em outras mensagens do mesmo contato guardadas na Evolution.

/** Máximo de contatos com @lid procurados na Evolution por rodada. */
export const RECOVERY_MAX_LID_LOOKUPS = 30;

const PHONE_JID = /^\d{8,15}@s\.whatsapp\.net$/;

/** Telefone real da mensagem (remoteJidAlt ou o próprio remoteJid), ou null. */
export const phoneJidOf = (key) => {
  if (typeof key?.remoteJidAlt === "string" && PHONE_JID.test(key.remoteJidAlt)) return key.remoteJidAlt;
  if (typeof key?.remoteJid === "string" && PHONE_JID.test(key.remoteJid)) return key.remoteJid;
  return null;
};

/** @lid -> telefone, a partir das mensagens que trazem os dois. */
export const lidPhoneMap = (records: unknown) => {
  const map = new Map<string, string>();
  for (const record of Array.isArray(records) ? records : []) {
    const jid = record?.key?.remoteJid;
    const alt = record?.key?.remoteJidAlt;
    if (typeof jid !== "string" || !jid.endsWith("@lid") || map.has(jid)) continue;
    if (typeof alt === "string" && PHONE_JID.test(alt)) map.set(jid, alt);
  }
  return map;
};

/** Contatos com @lid cujas mensagens ainda estão sem telefone. */
export const unresolvedLids = (records: unknown, map: Map<string, string>) => {
  const lids = new Set<string>();
  for (const record of Array.isArray(records) ? records : []) {
    const jid = record?.key?.remoteJid;
    if (typeof jid !== "string" || !jid.endsWith("@lid")) continue;
    if (phoneJidOf(record.key) || map.has(jid)) continue;
    lids.add(jid);
  }
  return [...lids];
};

/** A mensagem com o telefone preenchido, ou null se não houver como. */
export const withPhone = (record, map: Map<string, string>) => {
  if (phoneJidOf(record?.key)) return record;
  const alt = map.get(record?.key?.remoteJid);
  return alt ? { ...record, key: { ...record.key, remoteJidAlt: alt } } : null;
};

/** Procura o telefone de um @lid nas mensagens mais recentes dele na Evolution. */
export const fetchLidPhone = async (
  apiUrl: string,
  apiKey: string,
  sessionName: string,
  lid: string,
  { fetchImpl = fetch, timeoutMs = 15000 } = {},
) => {
  try {
    const response = await fetchImpl(
      `${apiUrl.replace(/\/$/, "")}/chat/findMessages/${encodeURIComponent(sessionName)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({ where: { key: { remoteJid: lid } }, page: 1, offset: 50 }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) {
      await response.body?.cancel?.();
      return null;
    }
    const json = await response.json();
    const result = json?.messages ?? json;
    const records = Array.isArray(result?.records) ? result.records : Array.isArray(result) ? result : [];
    return lidPhoneMap(records).get(lid) ?? null;
  } catch {
    return null;
  }
};

/**
 * Resultado da entrega ao evolution-in: "imported", "failed" ou
 * "ignored:<motivo>" (ele responde 200 também quando descarta a mensagem).
 */
export const importOutcome = (status: number, bodyText: string) => {
  if (status < 200 || status >= 300) return "failed";
  try {
    const json = JSON.parse(bodyText);
    if (json?.ignored) return `ignored:${json.reason ?? json.event ?? "unknown"}`;
  } catch {
    // Resposta sem JSON: tratada como entregue
  }
  return "imported";
};
