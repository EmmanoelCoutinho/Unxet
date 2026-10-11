// deno-lint-ignore-file
// @ts-nocheck
// Helpers do webhook da Evolution API (sem dependências, testáveis no Vitest).

/**
 * Com "Webhook by Events" ligado, a Evolution acrescenta o nome do evento ao
 * final da URL configurada. Como o token fica na query string, ele chega como
 * "<secret>/messages-upsert", "<secret>/connection-update" etc.
 * Remove esse sufixo para o token poder ser comparado com o secret.
 */
export const stripWebhookEventSuffix = (provided: string, secret: string) => {
  if (typeof provided !== "string" || typeof secret !== "string" || !secret) {
    return provided;
  }
  if (provided.length > secret.length && provided[secret.length] === "/") {
    return provided.slice(0, secret.length);
  }
  return provided;
};

/**
 * Cópia do payload do webhook sem os segredos (apikey da Evolution e token da
 * URL de destino), para poder ser gravada nos logs.
 */
export const redactWebhookSecrets = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const redacted = { ...(body as Record<string, unknown>) };
  if (redacted.apikey) redacted.apikey = "[REDACTED]";
  if (typeof redacted.destination === "string") {
    redacted.destination = redacted.destination.replace(
      /([?&]token=)[^&]*/gi,
      "$1[REDACTED]",
    );
  }
  return redacted;
};

/**
 * Decide o status de channel_connections a partir do estado real da instância
 * na Evolution. Retorna null quando não há nada a corrigir.
 *
 * "connecting" é ignorado de propósito: é o estado transitório das
 * reconexões automáticas e da leitura do QR Code.
 */
export const reconcileConnectionStatus = (
  currentStatus: string,
  evolutionState: string | null,
  instanceExists: boolean,
): "connected" | "disconnected" | null => {
  const isOpen = evolutionState === "open" || evolutionState === "connected";
  const isClosed =
    !instanceExists ||
    evolutionState === "close" ||
    evolutionState === "disconnected";

  if (currentStatus === "connected" && isClosed) return "disconnected";
  if (currentStatus === "disconnected" && instanceExists && isOpen) {
    return "connected";
  }
  return null;
};
