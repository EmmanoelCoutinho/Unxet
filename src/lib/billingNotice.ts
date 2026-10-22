import type { BillingCycle, SubscriptionStatus } from "../constants/plans";

// Avisos de cobrança mostrados aos admins da empresa (faixa no topo do app).
// A suspensão em si não passa por aqui: vira a tela de acesso suspenso.

export type BillingNoticeInput = {
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  current_period_end: string | null; // yyyy-mm-dd
  grace_days: number;
};

export type BillingNotice =
  | {
      kind: "overdue";
      daysOverdue: number;
      daysToSuspension: number;
      // Teste vencido: ninguém pagou nada ainda, o texto muda
      trial: boolean;
    }
  | { kind: "annual_ending"; daysLeft: number; endsOn: string; urgent: boolean };

// Avisos do fim do plano anual: a partir de 30 dias; mais forte a partir de 15
export const ANNUAL_NOTICE_DAYS = 30;
export const ANNUAL_URGENT_DAYS = 15;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Data local de hoje em yyyy-mm-dd, para comparar com as colunas date do banco
export const todayIso = (now = new Date()) => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const daysBetweenIso = (fromIso: string, toIso: string) =>
  Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) /
      MS_PER_DAY,
  );

export const getBillingNotice = (
  sub: BillingNoticeInput,
  today: string,
): BillingNotice | null => {
  if (!sub.current_period_end) return null;
  if (sub.status === "canceled" || sub.status === "suspended") return null;

  const daysLeft = daysBetweenIso(today, sub.current_period_end);

  // Vencida: conta pelas datas, sem esperar a rotina marcar como inadimplente
  if (daysLeft < 0) {
    const daysOverdue = -daysLeft;
    // A suspensão acontece no primeiro dia depois da carência
    const daysToSuspension = Math.max(sub.grace_days + 1 - daysOverdue, 0);
    return {
      kind: "overdue",
      daysOverdue,
      daysToSuspension,
      trial: sub.status === "trial",
    };
  }

  if (sub.billing_cycle === "annual" && daysLeft <= ANNUAL_NOTICE_DAYS) {
    return {
      kind: "annual_ending",
      daysLeft,
      endsOn: sub.current_period_end,
      urgent: daysLeft <= ANNUAL_URGENT_DAYS,
    };
  }

  return null;
};

// yyyy-mm-dd → dd/mm/aaaa sem passar por Date (não muda o dia no fuso)
export const formatIsoDateBr = (value: string) => {
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
};

const inDays = (days: number) =>
  days === 0 ? "hoje" : days === 1 ? "amanhã" : `em ${days} dias`;

export const billingNoticeText = (notice: BillingNotice) => {
  if (notice.kind === "overdue") {
    const days =
      notice.daysOverdue === 1 ? "1 dia" : `${notice.daysOverdue} dias`;
    const when =
      notice.daysToSuspension === 0 ? "a qualquer momento" : inDays(notice.daysToSuspension);
    if (notice.trial) {
      return `Seu período de teste terminou há ${days}. Fale com a Unxet para contratar e evitar a suspensão do acesso ${when}.`;
    }
    return `Pagamento em atraso há ${days}. Fale com a Unxet para regularizar e evitar a suspensão do acesso ${when}.`;
  }
  return `Sua assinatura anual termina ${inDays(notice.daysLeft)} (${formatIsoDateBr(notice.endsOn)}). Fale com a Unxet para renovar.`;
};
