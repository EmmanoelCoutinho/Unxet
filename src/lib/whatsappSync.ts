// Faixa "Sincronizando mensagens" (sem dependências, testável no Vitest).
//
// Ao ler o QR Code de novo, o evolution-connection-sync traz as mensagens que
// chegaram enquanto o número esteve fora (supabase/functions/_shared/
// inboundRecovery.ts). A primeira busca roda de 2 a 7 minutos depois de
// conectar; depois disso o total é conhecido e o contador sobe a cada
// mensagem que entra na conversa (migration 20261203000000).

export type WhatsappSyncRow = {
  /** Status da conexão: a faixa só aparece com o número conectado. */
  status?: string | null;
  inbound_recovery_requested_at: string | null;
  inbound_recovery_total: number | null;
  inbound_recovery_done: number | null;
  inbound_recovery_progress_at: string | null;
};

export type WhatsappSyncState =
  | { kind: "searching" }
  | { kind: "progress"; done: number; total: number }
  | { kind: "done"; total: number };

/** A primeira busca não rodou até aqui: algo deu errado, a faixa some. */
export const SYNC_SEARCH_MAX_MINUTES = 15;
/**
 * Sem avanço por este tempo, a faixa some. O que sobrou não entra (contato
 * bloqueado, mensagem que falha) ou fica para a recuperação terminar sozinha.
 */
export const SYNC_STALE_MINUTES = 10;
/** Quanto tempo o "concluída" fica na tela depois da última mensagem. */
export const SYNC_DONE_VISIBLE_SECONDS = 60;

const minutesSince = (iso: string | null, now: Date) => {
  const time = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(time) ? Infinity : (now.getTime() - time) / 60000;
};

/** O que a faixa mostra para um número, ou null quando não há nada a mostrar. */
export const whatsappSyncState = (
  row: WhatsappSyncRow | null | undefined,
  now = new Date(),
): WhatsappSyncState | null => {
  if (!row?.inbound_recovery_requested_at) return null;
  // Número caiu de novo: a recuperação para e volta na próxima conexão
  if (row.status && row.status !== "connected") return null;
  const total = row.inbound_recovery_total;

  if (total === null || total === undefined) {
    return minutesSince(row.inbound_recovery_requested_at, now) < SYNC_SEARCH_MAX_MINUTES
      ? { kind: "searching" }
      : null;
  }
  // Nada ficou para trás enquanto o número esteve fora
  if (total <= 0) return null;

  const sinceProgress = minutesSince(
    row.inbound_recovery_progress_at ?? row.inbound_recovery_requested_at,
    now,
  );
  const done = Math.min(Math.max(row.inbound_recovery_done ?? 0, 0), total);
  if (done >= total) {
    return sinceProgress * 60 < SYNC_DONE_VISIBLE_SECONDS ? { kind: "done", total } : null;
  }
  return sinceProgress < SYNC_STALE_MINUTES ? { kind: "progress", done, total } : null;
};

/** Porcentagem da barra (0 a 100). */
export const whatsappSyncPercent = (state: WhatsappSyncState) => {
  if (state.kind === "done") return 100;
  if (state.kind === "searching") return 0;
  return Math.floor((state.done / state.total) * 100);
};
