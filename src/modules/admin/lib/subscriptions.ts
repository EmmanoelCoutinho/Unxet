import type {
  BillingCycle,
  PaymentMethod,
  PlanCode,
  SubscriptionPlan,
  SubscriptionStatus,
} from "../../../constants/plans";
import { daysBetweenIso, todayIso } from "../../../lib/billingNotice";

export { todayIso };

// Uma empresa como vem de platform_subscriptions
export type SubscriberRow = {
  id: string;
  name: string;
  created_at: string | null;
  plan_code: PlanCode;
  status: SubscriptionStatus;
  current_period_end: string | null; // yyyy-mm-dd
  billing_cycle: BillingCycle;
  price: number | null;
  grace_days: number;
  blocked_at: string | null;
  blocked_reason: "overdue" | "manual" | null;
  notes: string | null;
  updated_at: string | null;
  last_payment_at: string | null;
  last_payment_amount: number | null;
  last_payment_method: PaymentMethod | null;
  attendants: number;
  pending_invites: number;
  whatsapp: number;
  instagram: number;
  messenger: number;
  active_bots: number;
  extra_departments: number;
  pending_scheduled: number;
  last_message_at: string | null;
};

export type SubscriptionPayment = {
  id: string;
  clinic_id: string;
  paid_at: string; // yyyy-mm-dd
  amount: number;
  method: PaymentMethod;
  billing_cycle: BillingCycle;
  periods: number;
  period_start: string;
  period_end: string;
  notes: string | null;
  created_at: string;
};

export type PlatformSubscriptions = {
  generated_at: string;
  // Hoje em America/Sao_Paulo, segundo o banco (mesma régua da rotina)
  today: string;
  plans: SubscriptionPlan[];
  clinics: SubscriberRow[];
};

// Vencimento: só conta para quem ainda deveria pagar (cancelada não vence)
export type DueState =
  | { kind: "none" }
  | { kind: "overdue"; days: number; daysToSuspension: number }
  | { kind: "soon"; days: number }
  | { kind: "ok"; days: number };

export const DUE_SOON_DAYS = 7;

export const getDueState = (row: SubscriberRow, today: string): DueState => {
  if (
    !row.current_period_end ||
    row.status === "canceled" ||
    row.status === "suspended"
  ) {
    return { kind: "none" };
  }
  const days = daysBetweenIso(today, row.current_period_end);
  if (days < 0) {
    // Suspensa no primeiro dia depois da carência
    const daysToSuspension = Math.max(row.grace_days + 1 + days, 0);
    return { kind: "overdue", days: -days, daysToSuspension };
  }
  if (days <= DUE_SOON_DAYS) return { kind: "soon", days };
  return { kind: "ok", days };
};

// Situação que a régua do banco (subscription_refresh_status) vai aplicar ao
// salvar. Suspensão manual e cancelada ficam como estão.
export const predictStatus = (
  status: SubscriptionStatus,
  periodEnd: string | null,
  graceDays: number,
  today: string,
  manualSuspension: boolean,
): SubscriptionStatus => {
  if (!periodEnd || status === "canceled") return status;
  if (status === "suspended" && manualSuspension) return status;
  const days = daysBetweenIso(today, periodEnd);
  if (days >= 0) {
    return status === "past_due" || status === "suspended" ? "active" : status;
  }
  if (-days > graceDays) return "suspended";
  return status === "trial" ? "trial" : "past_due";
};

// O que a empresa usa além do plano (fica de quando o plano era maior)
export const getPlanAlerts = (
  row: SubscriberRow,
  plan: SubscriptionPlan | undefined,
): string[] => {
  if (!plan) return [];
  const alerts: string[] = [];
  const has = (feature: SubscriptionPlan["features"][number]) =>
    plan.features.includes(feature);

  if (plan.max_attendants !== null && row.attendants > plan.max_attendants) {
    alerts.push(
      `${row.attendants} atendentes (limite ${plan.max_attendants})`,
    );
  }
  if (
    plan.max_whatsapp_numbers !== null &&
    row.whatsapp > plan.max_whatsapp_numbers
  ) {
    alerts.push(
      `${row.whatsapp} números de WhatsApp (limite ${plan.max_whatsapp_numbers})`,
    );
  }
  if (!has("social_channels") && row.instagram + row.messenger > 0) {
    alerts.push("Instagram/Messenger conectado");
  }
  if (!has("bots") && row.active_bots > 0) {
    alerts.push(
      row.active_bots === 1
        ? "1 bot ativo (não responde)"
        : `${row.active_bots} bots ativos (não respondem)`,
    );
  }
  if (!has("departments") && row.extra_departments > 0) {
    alerts.push(
      `${row.extra_departments} ${row.extra_departments === 1 ? "departamento extra" : "departamentos extras"}`,
    );
  }
  if (!has("scheduled_messages") && row.pending_scheduled > 0) {
    alerts.push(
      `${row.pending_scheduled} ${row.pending_scheduled === 1 ? "mensagem programada pendente" : "mensagens programadas pendentes"}`,
    );
  }
  return alerts;
};

// Mesmo cálculo do banco (date + interval): 31/01 + 1 mês = 28/02
export const addPeriodsIso = (
  startIso: string,
  cycle: BillingCycle,
  periods: number,
) => {
  const [y, m, d] = startIso.split("-").map(Number);
  const months = (cycle === "annual" ? 12 : 1) * periods;
  const totalMonths = y * 12 + (m - 1) + months;
  const ny = Math.floor(totalMonths / 12);
  const nm = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
};

const moneyFormat = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const formatMoney = (value: number | null | undefined) =>
  value === null || value === undefined ? "–" : moneyFormat.format(Number(value));

// Quanto do limite está em uso: "2/3", "12" (ilimitado)
export const formatUsage = (used: number, max: number | null) =>
  max === null ? `${used}` : `${used}/${max}`;
