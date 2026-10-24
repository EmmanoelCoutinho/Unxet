import { describe, expect, it } from "vitest";
import type { SubscriptionPlan } from "../../../constants/plans";
import {
  addPeriodsIso,
  formatUsage,
  getDueState,
  getPlanAlerts,
  parseWhatsappAddon,
  predictStatus,
  todayIso,
  whatsappNumbersLimit,
  type SubscriberRow,
} from "./subscriptions";

const essencial: SubscriptionPlan = {
  code: "essencial",
  name: "Essencial",
  position: 1,
  max_attendants: 3,
  max_whatsapp_numbers: 1,
  features: [],
};

const empresarial: SubscriptionPlan = {
  code: "empresarial",
  name: "Empresarial",
  position: 3,
  max_attendants: null,
  max_whatsapp_numbers: null,
  features: [
    "social_channels",
    "bots",
    "departments",
    "scheduled_messages",
    "analytics",
    "audio_transcription",
    "internal_chat",
  ],
};

const row = (overrides: Partial<SubscriberRow> = {}): SubscriberRow => ({
  id: "c1",
  name: "Clínica",
  created_at: null,
  plan_code: "essencial",
  status: "active",
  current_period_end: null,
  billing_cycle: "monthly",
  price: null,
  grace_days: 10,
  whatsapp_numbers_addon: null,
  blocked_at: null,
  blocked_reason: null,
  notes: null,
  updated_at: null,
  last_payment_at: null,
  last_payment_amount: null,
  last_payment_method: null,
  attendants: 1,
  pending_invites: 0,
  whatsapp: 1,
  qr_numbers: 1,
  instagram: 0,
  messenger: 0,
  active_bots: 0,
  extra_departments: 0,
  pending_scheduled: 0,
  last_message_at: null,
  ...overrides,
});

describe("getDueState", () => {
  it("sem vencimento ou cancelada não tem prazo", () => {
    expect(getDueState(row(), "2026-10-21")).toEqual({ kind: "none" });
    expect(
      getDueState(
        row({ status: "canceled", current_period_end: "2026-01-01" }),
        "2026-10-21",
      ),
    ).toEqual({ kind: "none" });
  });

  it("separa vencida, vencendo e em dia", () => {
    const at = (end: string) =>
      getDueState(row({ current_period_end: end }), "2026-10-21");
    expect(at("2026-10-18")).toEqual({ kind: "overdue", days: 3, daysToSuspension: 8 });
    expect(at("2026-10-11")).toEqual({ kind: "overdue", days: 10, daysToSuspension: 1 });
    expect(at("2026-10-21")).toEqual({ kind: "soon", days: 0 });
    expect(at("2026-10-28")).toEqual({ kind: "soon", days: 7 });
    expect(at("2026-10-29")).toEqual({ kind: "ok", days: 8 });
  });
});

describe("getPlanAlerts", () => {
  it("dentro do plano não gera alerta", () => {
    expect(getPlanAlerts(row({ attendants: 3 }), essencial)).toEqual([]);
  });

  it("aponta o que passa do Essencial", () => {
    expect(
      getPlanAlerts(
        row({
          attendants: 5,
          whatsapp: 2,
          instagram: 1,
          active_bots: 2,
          extra_departments: 1,
          pending_scheduled: 4,
        }),
        essencial,
      ),
    ).toEqual([
      "5 atendentes (limite 3)",
      "2 números de WhatsApp (limite 1)",
      "Instagram/Messenger conectado",
      "2 bots ativos (não respondem)",
      "1 departamento extra",
      "4 mensagens programadas pendentes",
    ]);
  });

  it("Empresarial é ilimitado", () => {
    expect(
      getPlanAlerts(row({ attendants: 80, whatsapp: 2, active_bots: 3 }), empresarial),
    ).toEqual([]);
  });

  it("o adicional de números vale sobre o limite do plano", () => {
    expect(
      getPlanAlerts(
        row({ whatsapp: 3, qr_numbers: 3, whatsapp_numbers_addon: 3 }),
        essencial,
      ),
    ).toEqual([]);
    expect(
      getPlanAlerts(
        row({ whatsapp: 4, qr_numbers: 4, whatsapp_numbers_addon: 3 }),
        essencial,
      ),
    ).toEqual([
      "4 números de WhatsApp (limite 3)",
      "4 números QR Code (adicional permite 3)",
    ]);
  });

  it("vários números QR Code sem o adicional", () => {
    expect(
      getPlanAlerts(row({ whatsapp: 1, qr_numbers: 2 }), empresarial),
    ).toEqual(["2 números QR Code (adicional desligado)"]);
  });
});

describe("parseWhatsappAddon", () => {
  it("desligado vira null", () => {
    expect(parseWhatsappAddon(false, "5")).toBeNull();
  });

  it("ligado aceita de 2 a 50", () => {
    expect(parseWhatsappAddon(true, "2")).toBe(2);
    expect(parseWhatsappAddon(true, "50")).toBe(50);
    expect(parseWhatsappAddon(true, "1")).toBeUndefined();
    expect(parseWhatsappAddon(true, "51")).toBeUndefined();
    expect(parseWhatsappAddon(true, "2.5")).toBeUndefined();
    expect(parseWhatsappAddon(true, "")).toBeUndefined();
  });
});

describe("whatsappNumbersLimit", () => {
  it("usa o adicional quando ligado e o plano quando não", () => {
    expect(whatsappNumbersLimit(4, essencial)).toBe(4);
    expect(whatsappNumbersLimit(null, essencial)).toBe(1);
    expect(whatsappNumbersLimit(null, empresarial)).toBeNull();
  });
});

describe("predictStatus", () => {
  const today = "2026-10-21";
  it("segue a régua do banco", () => {
    expect(predictStatus("active", "2026-10-25", 10, today, false)).toBe("active");
    expect(predictStatus("active", "2026-10-18", 10, today, false)).toBe("past_due");
    expect(predictStatus("active", "2026-10-10", 10, today, false)).toBe("suspended");
    expect(predictStatus("past_due", "2026-11-21", 10, today, false)).toBe("active");
    expect(predictStatus("trial", "2026-10-30", 10, today, false)).toBe("trial");
    expect(predictStatus("trial", "2026-10-20", 10, today, false)).toBe("trial");
    expect(predictStatus("trial", "2026-10-01", 10, today, false)).toBe("suspended");
  });

  it("suspensão manual e cancelada não mudam", () => {
    expect(predictStatus("suspended", "2026-12-01", 10, today, true)).toBe("suspended");
    expect(predictStatus("suspended", "2026-12-01", 10, today, false)).toBe("active");
    expect(predictStatus("canceled", "2026-01-01", 10, today, false)).toBe("canceled");
    expect(predictStatus("active", null, 10, today, false)).toBe("active");
  });
});

describe("addPeriodsIso", () => {
  it("avança mês e ano como o Postgres", () => {
    expect(addPeriodsIso("2026-10-10", "monthly", 1)).toBe("2026-11-10");
    expect(addPeriodsIso("2026-12-10", "monthly", 2)).toBe("2027-02-10");
    expect(addPeriodsIso("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(addPeriodsIso("2028-02-29", "annual", 1)).toBe("2029-02-28");
    expect(addPeriodsIso("2026-10-21", "annual", 1)).toBe("2027-10-21");
  });
});

describe("formatUsage", () => {
  it("mostra o limite só quando existe", () => {
    expect(formatUsage(2, 3)).toBe("2/3");
    expect(formatUsage(12, null)).toBe("12");
  });
});

describe("todayIso", () => {
  it("usa a data local", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
