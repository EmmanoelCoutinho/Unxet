// Fila de entrada dos webhooks (Cloudflare Worker + Queue).
// Guia em docs/fila-de-entrada.md.
import {
  MAX_QUEUE_MESSAGE_BYTES,
  buildQueuedWebhook,
  buildRecoveredWebhook,
  chunkForQueue,
  parseRecoveryRequest,
  safeEqual,
  deliveryOutcome,
  evolutionSkipReason,
  fromBase64,
  functionUrl,
  pickHeaders,
  queuedSize,
  retryDelaySeconds,
  targetFromPath,
  type QueuedWebhook,
  type Target,
} from "./gateway";

// Tipos mínimos do runtime do Cloudflare (evita depender de @cloudflare/workers-types)
export interface QueueProducer {
  send(message: QueuedWebhook): Promise<void>;
  sendBatch(messages: { body: QueuedWebhook }[]): Promise<void>;
}
export interface QueueMessage {
  body: QueuedWebhook;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}
export interface MessageBatch {
  queue: string;
  messages: QueueMessage[];
}
export interface Env {
  INBOUND: QueueProducer;
  /** Ex.: https://<projeto>.supabase.co/functions/v1 */
  SUPABASE_FUNCTIONS_URL: string;
  /** "develop" ou "production", só para os logs */
  ENVIRONMENT?: string;
  /**
   * Mesmo valor do INTERNAL_BOT_SECRET do Supabase (wrangler secret put).
   * Sem ele, a recuperação de mensagens (/evolution-recovery) fica desligada.
   */
  INTERNAL_BOT_SECRET?: string;
}

// Tempo máximo de cada repasse. Com fetch de mídia, o evolution-in pode demorar.
const FORWARD_TIMEOUT_MS = 60_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const forward = (
  env: Env,
  target: Target,
  search: string,
  headers: Record<string, string>,
  body: BodyInit,
  receivedAt: string,
  fetchImpl: typeof fetch,
) =>
  fetchImpl(functionUrl(env.SUPABASE_FUNCTIONS_URL, target, search), {
    method: "POST",
    headers: {
      ...headers,
      "x-unxet-gateway": "1",
      "x-unxet-received-at": receivedAt,
    },
    body,
    signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
  });

/**
 * Recuperação de mensagens: o evolution-connection-sync manda até 100
 * webhooks por pedido e todos entram na fila de uma vez. Responde quantos
 * entraram e quais ficaram de fora (grandes demais para a fila).
 */
const handleRecovery = async (request: Request, env: Env): Promise<Response> => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.INTERNAL_BOT_SECRET) return json({ error: "not_configured" }, 503);
  const internalSecret = request.headers.get("x-internal-secret") ?? "";
  if (!safeEqual(internalSecret, env.INTERNAL_BOT_SECRET)) return json({ error: "unauthorized" }, 401);

  const webhooks = parseRecoveryRequest(await request.text());
  if (!webhooks) return json({ error: "invalid_body" }, 400);

  const secrets = { webhookSecret: request.headers.get("x-webhook-secret") ?? "", internalSecret };
  const rejected: number[] = [];
  const messages: QueuedWebhook[] = [];
  webhooks.forEach((webhook, index) => {
    const message = buildRecoveredWebhook(webhook, secrets);
    if (queuedSize(message) > MAX_QUEUE_MESSAGE_BYTES) rejected.push(index);
    else messages.push(message);
  });

  let queued = 0;
  try {
    for (const chunk of chunkForQueue(messages)) {
      await env.INBOUND.sendBatch(chunk.map((body) => ({ body })));
      queued += chunk.length;
    }
  } catch (err) {
    console.error("[GATEWAY_RECOVERY_QUEUE_FAILED]", { queued, error: String(err) });
    return json({ error: "queue_unavailable", queued }, 503);
  }
  console.log("[GATEWAY_RECOVERY_QUEUED]", { queued, rejected: rejected.length });
  return json({ queued, rejected });
};

export const handleRequest = async (
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === "/evolution-recovery") return handleRecovery(request, env);

  // Monitor da página de status
  if (url.pathname === "/health" && (request.method === "GET" || request.method === "HEAD")) {
    return json({ status: "ok", environment: env.ENVIRONMENT ?? null });
  }

  const target = targetFromPath(url.pathname);
  if (!target) return json({ error: "not_found" }, 404);

  // Verificação do webhook da Meta (hub.challenge): só acontece ao configurar,
  // vai direto para a função e precisa do Supabase no ar
  if (request.method === "GET") {
    const res = await fetchImpl(functionUrl(env.SUPABASE_FUNCTIONS_URL, target, url.search), {
      method: "GET",
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "text/plain" } });
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = new Uint8Array(await request.arrayBuffer());

  // Eventos que o evolution-in não usa não entram na fila (economiza operações)
  if (target === "evolution-in") {
    const reason = evolutionSkipReason(body);
    if (reason) return json({ ignored: true, reason });
  }

  const message = buildQueuedWebhook(target, url, request.headers, body);

  if (queuedSize(message) <= MAX_QUEUE_MESSAGE_BYTES) {
    try {
      await env.INBOUND.send(message);
      return json({ queued: true });
    } catch (err) {
      console.error("[GATEWAY_QUEUE_SEND_FAILED]", { target, error: String(err) });
    }
  } else {
    console.warn("[GATEWAY_TOO_LARGE]", { target, bytes: body.length });
  }

  // Sem fila (mensagem grande demais ou fila indisponível): repassa direto.
  // Se o Supabase também falhar, responde erro para quem enviou tentar de novo.
  try {
    const res = await forward(
      env,
      target,
      url.search,
      pickHeaders(request.headers),
      body,
      message.receivedAt,
      fetchImpl,
    );
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[GATEWAY_DIRECT_FAILED]", { target, error: String(err) });
    return json({ error: "unavailable" }, 503);
  }
};

const deliver = async (env: Env, message: QueueMessage, fetchImpl: typeof fetch) => {
  const { target, search, headers, body, receivedAt } = message.body;
  let status = 0;
  try {
    const res = await forward(env, target, search, headers, fromBase64(body), receivedAt, fetchImpl);
    status = res.status;
    await res.body?.cancel();
  } catch (err) {
    console.warn("[GATEWAY_DELIVERY_ERROR]", { target, attempts: message.attempts, error: String(err) });
  }

  const outcome = status ? deliveryOutcome(status) : "retry";
  if (outcome === "retry") {
    const delaySeconds = retryDelaySeconds(message.attempts);
    console.warn("[GATEWAY_RETRY]", { target, status, attempts: message.attempts, delaySeconds, receivedAt });
    message.retry({ delaySeconds });
    return outcome;
  }
  if (outcome === "rejected") {
    // A função recusou (token, assinatura, conexão inexistente): repetir não adianta
    console.warn("[GATEWAY_REJECTED]", { target, status, receivedAt });
  } else if (message.attempts > 1) {
    console.log("[GATEWAY_DELIVERED_LATE]", { target, attempts: message.attempts, receivedAt });
  }
  message.ack();
  return outcome;
};

// Em paralelo, como a Evolution e a Meta já entregam hoje
export const handleBatch = async (batch: MessageBatch, env: Env, fetchImpl: typeof fetch = fetch) =>
  Promise.all(batch.messages.map((message) => deliver(env, message, fetchImpl)));

export default {
  fetch: (request: Request, env: Env) => handleRequest(request, env),
  queue: (batch: MessageBatch, env: Env) => handleBatch(batch, env),
};
