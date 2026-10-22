import { describe, expect, it } from "vitest";
import {
  billingNoticeText,
  getBillingNotice,
  type BillingNoticeInput,
} from "./billingNotice";

const sub = (overrides: Partial<BillingNoticeInput> = {}): BillingNoticeInput => ({
  status: "active",
  billing_cycle: "monthly",
  current_period_end: "2026-10-21",
  grace_days: 10,
  ...overrides,
});

describe("getBillingNotice", () => {
  it("mensal em dia não avisa", () => {
    expect(getBillingNotice(sub({ current_period_end: "2026-10-25" }), "2026-10-21")).toBeNull();
    expect(getBillingNotice(sub(), "2026-10-21")).toBeNull();
  });

  it("vencida conta os dias até a suspensão", () => {
    // Venceu dia 10, carência 10: suspensa no dia 21
    expect(getBillingNotice(sub({ current_period_end: "2026-10-10" }), "2026-10-13")).toEqual({
      kind: "overdue",
      daysOverdue: 3,
      daysToSuspension: 8,
      trial: false,
    });
    expect(getBillingNotice(sub({ current_period_end: "2026-10-10" }), "2026-10-20")).toEqual({
      kind: "overdue",
      daysOverdue: 10,
      daysToSuspension: 1,
      trial: false,
    });
  });

  it("suspensa e cancelada não mostram faixa", () => {
    expect(
      getBillingNotice(sub({ status: "suspended", current_period_end: "2026-10-01" }), "2026-10-21"),
    ).toBeNull();
    expect(
      getBillingNotice(sub({ status: "canceled", current_period_end: "2026-10-01" }), "2026-10-21"),
    ).toBeNull();
  });

  it("anual avisa a partir de 30 dias e fica urgente com 15", () => {
    const annual = (end: string) =>
      getBillingNotice(sub({ billing_cycle: "annual", current_period_end: end }), "2026-10-21");
    expect(annual("2026-11-21")).toBeNull(); // 31 dias
    expect(annual("2026-11-20")).toMatchObject({ kind: "annual_ending", daysLeft: 30, urgent: false });
    expect(annual("2026-11-05")).toMatchObject({ daysLeft: 15, urgent: true });
  });

  it("sem vencimento não avisa", () => {
    expect(getBillingNotice(sub({ current_period_end: null }), "2026-10-21")).toBeNull();
  });
});

describe("billingNoticeText", () => {
  it("monta as frases", () => {
    expect(
      billingNoticeText({ kind: "overdue", daysOverdue: 3, daysToSuspension: 8, trial: false }),
    ).toBe(
      "Pagamento em atraso há 3 dias. Fale com a Unxet para regularizar e evitar a suspensão do acesso em 8 dias.",
    );
    expect(
      billingNoticeText({ kind: "overdue", daysOverdue: 10, daysToSuspension: 1, trial: false }),
    ).toBe(
      "Pagamento em atraso há 10 dias. Fale com a Unxet para regularizar e evitar a suspensão do acesso amanhã.",
    );
    expect(
      billingNoticeText({ kind: "overdue", daysOverdue: 1, daysToSuspension: 10, trial: true }),
    ).toBe(
      "Seu período de teste terminou há 1 dia. Fale com a Unxet para contratar e evitar a suspensão do acesso em 10 dias.",
    );
    expect(
      billingNoticeText({ kind: "annual_ending", daysLeft: 15, endsOn: "2026-11-05", urgent: true }),
    ).toBe(
      "Sua assinatura anual termina em 15 dias (05/11/2026). Fale com a Unxet para renovar.",
    );
  });
});
