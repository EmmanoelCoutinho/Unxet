// deno-lint-ignore-file
// @ts-nocheck
// Vigia do WhatsApp por QR Code (sem dependências, testável no Vitest).
//
// A sessão do WhatsApp dentro da Evolution às vezes trava: a instância segue
// "conectada", mas nenhuma mensagem chega mais. O vigia compara o movimento
// de agora com o mesmo horário das semanas anteriores e, se um número que
// costuma receber ficou em silêncio, reinicia a instância. Se nem assim as
// mensagens voltarem, avisa os administradores para ler o QR Code de novo.
// Dados: migration 20261117000000_whatsapp_silence_watchdog.sql.

/** Intervalo observado: "nenhuma mensagem nos últimos 45 minutos". */
export const WATCHDOG_WINDOW_MINUTES = 45;
/**
 * O número só é vigiado se, nesse mesmo intervalo, recebeu pelo menos 10
 * mensagens em 2 das 4 semanas anteriores. Com esse movimento, 45 minutos de
 * silêncio por acaso são raríssimos; números com pouco movimento ficam de
 * fora para não serem reiniciados à toa.
 */
export const WATCHDOG_MIN_BASELINE_MESSAGES = 10;
export const WATCHDOG_MIN_BASELINE_WEEKS = 2;
/** Intervalo mínimo entre dois reinícios do mesmo número. */
export const WATCHDOG_RESTART_COOLDOWN_MINUTES = 180;
/** Se o último reinício não trouxe mensagens (ex.: feriado), espera bem mais. */
export const WATCHDOG_FAILED_RESTART_COOLDOWN_MINUTES = 12 * 60;
/** Tempo dado para as mensagens voltarem depois do reinício. */
export const WATCHDOG_RECOVERY_MINUTES = 20;
/** No máximo um aviso de "continua sem receber" por dia (ex.: feriado). */
export const WATCHDOG_ALERT_COOLDOWN_MINUTES = 24 * 60;

const minutesSince = (now: Date, value: unknown) => {
  if (!value) return null;
  const time = new Date(value as string).getTime();
  return Number.isNaN(time) ? null : (now.getTime() - time) / 60000;
};

/**
 * O que fazer com um número conectado:
 * - "ok": está recebendo, ou não costuma receber nesse horário
 * - "restart": em silêncio fora do normal, reinicia a instância
 * - "alert": já foi reiniciado e continua sem receber, avisa os administradores
 * - "wait": reiniciado há pouco, aguarda
 */
export const watchdogDecision = (activity, now = new Date()) => {
  if ((activity?.recent_count ?? 0) > 0) return "ok";

  const baseline = Array.isArray(activity?.baseline_counts) ? activity.baseline_counts : [];
  const busyWeeks = baseline.filter((count) => count >= WATCHDOG_MIN_BASELINE_MESSAGES).length;
  if (busyWeeks < WATCHDOG_MIN_BASELINE_WEEKS) return "ok";

  // Acabou de conectar: o silêncio ainda não diz nada
  const sinceConnection = minutesSince(now, activity.last_connection_at);
  if (sinceConnection !== null && sinceConnection < WATCHDOG_WINDOW_MINUTES) return "ok";

  const sinceRestart = minutesSince(now, activity.watchdog_restarted_at);
  const recovered = (activity.inbound_since_restart ?? 0) > 0;
  const cooldown = recovered
    ? WATCHDOG_RESTART_COOLDOWN_MINUTES
    : WATCHDOG_FAILED_RESTART_COOLDOWN_MINUTES;
  if (sinceRestart === null || sinceRestart >= cooldown) return "restart";

  if (sinceRestart < WATCHDOG_RECOVERY_MINUTES || recovered) return "wait";

  const sinceAlert = minutesSince(now, activity.watchdog_alerted_at);
  if (sinceAlert !== null && sinceAlert < WATCHDOG_ALERT_COOLDOWN_MINUTES) return "wait";
  return "alert";
};

/** Como o número aparece no aviso: nome do WhatsApp e/ou telefone. */
export const watchdogNumberLabel = (activity) => {
  const digits = String(activity?.connected_phone ?? "").split(/[:@]/)[0].replace(/\D/g, "");
  const name = String(activity?.connected_name ?? "").trim();
  if (name && digits) return `${name} (+${digits})`;
  if (digits) return `+${digits}`;
  return name || "WhatsApp";
};

export const watchdogNotification = (kind: "restart" | "alert", activity) => {
  const label = watchdogNumberLabel(activity);
  if (kind === "restart") {
    return {
      kind: "whatsapp_watchdog_restart",
      title: "WhatsApp reiniciado automaticamente",
      body: `O número ${label} ficou ${WATCHDOG_WINDOW_MINUTES} minutos sem receber mensagens num horário em que costuma receber. A conexão foi reiniciada sozinha; não é preciso fazer nada.`,
    };
  }
  return {
    kind: "whatsapp_watchdog_alert",
    title: "WhatsApp sem receber mensagens",
    body: `O número ${label} continua sem receber mensagens mesmo depois de reiniciado. Se os clientes estiverem escrevendo, desconecte e leia o QR Code de novo em Integrações.`,
  };
};

/**
 * Reinicia a instância na Evolution (a sessão é mantida, não pede QR Code).
 * A v2 usa POST e a v1 usa PUT: tenta o outro método se o primeiro não existir.
 * Nunca lança erro; devolve true quando a Evolution aceitou.
 */
export const restartInstance = async (
  apiUrl: string,
  apiKey: string,
  sessionName: string,
  { fetchImpl = fetch, timeoutMs = 15000 } = {},
) => {
  const url = `${apiUrl.replace(/\/$/, "")}/instance/restart/${encodeURIComponent(sessionName)}`;
  let lastStatus = 0;
  for (const method of ["POST", "PUT"]) {
    try {
      const response = await fetchImpl(url, {
        method,
        headers: { apikey: apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel?.();
      if (response.ok) return true;
      lastStatus = response.status;
      if (response.status !== 404 && response.status !== 405) break;
    } catch (err) {
      console.warn("[WATCHDOG_RESTART_ERROR]", {
        sessionName,
        method,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
  console.warn("[WATCHDOG_RESTART_FAILED]", { sessionName, status: lastStatus });
  return false;
};
