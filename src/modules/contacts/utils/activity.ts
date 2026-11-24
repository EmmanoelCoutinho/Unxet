/** Dias sem contato a partir dos quais o cliente deixa de ser "ativo". */
export const ACTIVE_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/** Dias desde a data informada; sem data, conta como nunca visto. */
export const daysSince = (date: string | null | undefined, now = Date.now()) => {
  if (!date) return Number.POSITIVE_INFINITY;
  const time = new Date(date).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : (now - time) / DAY_MS;
};

/**
 * Cliente ativo = falou com a empresa nos últimos 30 dias ou tem atendimento
 * em andamento. Antes o selo vinha só do status da conversa: bastava a
 * conversa ser encerrada (ou o cliente responder a pesquisa de satisfação)
 * para ele aparecer "Inativo" mesmo mandando mensagem no mesmo dia.
 */
export const isActiveContact = (params: {
  lastContactAt: string | null | undefined;
  conversationStatus?: "open" | "pending" | "closed" | null;
  now?: number;
}) => {
  const { lastContactAt, conversationStatus, now = Date.now() } = params;
  if (conversationStatus === "open" || conversationStatus === "pending") return true;
  return daysSince(lastContactAt, now) < ACTIVE_WINDOW_DAYS;
};
