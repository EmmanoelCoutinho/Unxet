import { describe, expect, it } from "vitest";
import { describeRecurrence, nextRun, upcomingRuns, type RecurrenceDraft } from "./recurrence";

// Quarta, 28/10/2026, 15:00 (hora local do teste)
const NOW = new Date(2026, 9, 28, 15, 0);

const rule = (overrides: Partial<RecurrenceDraft>): RecurrenceDraft => ({
  frequency: "daily",
  weekdays: [],
  monthDay: 1,
  sendTime: "09:00",
  startsOn: "2026-10-28",
  endsOn: null,
  maxRuns: null,
  ...overrides,
});

const local = (d: Date | null) =>
  d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : null;

describe("nextRun", () => {
  it("todo dia: hoje se ainda não passou, senão amanhã", () => {
    expect(local(nextRun(rule({ sendTime: "16:00" }), NOW))).toBe("2026-10-28 16:00");
    expect(local(nextRun(rule({ sendTime: "09:00" }), NOW))).toBe("2026-10-29 9:00");
  });

  it("toda semana nos dias escolhidos", () => {
    expect(local(nextRun(rule({ frequency: "weekly", weekdays: [1, 5], sendTime: "10:00" }), NOW))).toBe("2026-10-30 10:00");
  });

  it("todo mês: dia 31 vira o último dia em meses curtos", () => {
    const monthly = rule({ frequency: "monthly", monthDay: 31, sendTime: "08:00" });
    expect(local(nextRun(monthly, NOW))).toBe("2026-10-31 8:00");
    expect(local(nextRun(monthly, new Date(2026, 9, 31, 9, 0)))).toBe("2026-11-30 8:00");
    expect(local(nextRun(monthly, new Date(2027, 0, 31, 9, 0)))).toBe("2027-2-28 8:00");
  });

  it("respeita início, fim e envio único", () => {
    expect(local(nextRun(rule({ startsOn: "2026-11-10" }), NOW))).toBe("2026-11-10 9:00");
    expect(nextRun(rule({ endsOn: "2026-10-28" }), NOW)).toBeNull();
    expect(nextRun(rule({ frequency: "once", sendTime: "09:00" }), NOW)).toBeNull();
    expect(local(nextRun(rule({ frequency: "once", sendTime: "18:00" }), NOW))).toBe("2026-10-28 18:00");
  });
});

describe("upcomingRuns", () => {
  it("lista os próximos e para no limite de envios", () => {
    expect(upcomingRuns(rule({}), NOW, 3).map(local)).toEqual(["2026-10-29 9:00", "2026-10-30 9:00", "2026-10-31 9:00"]);
    expect(upcomingRuns(rule({ maxRuns: 2 }), NOW, 3)).toHaveLength(2);
  });
});

describe("describeRecurrence", () => {
  it("descreve em português", () => {
    expect(describeRecurrence(rule({ sendTime: "09:00" }))).toBe("Todo dia às 09:00");
    expect(describeRecurrence(rule({ frequency: "weekly", weekdays: [5, 1], sendTime: "10:00" }))).toBe(
      "Toda segunda e sexta às 10:00",
    );
    expect(describeRecurrence(rule({ frequency: "weekly", weekdays: [6] }))).toBe("Todo sábado às 09:00");
    expect(describeRecurrence(rule({ frequency: "weekly", weekdays: [1, 2, 3, 4, 5] }))).toBe(
      "De segunda a sexta às 09:00",
    );
    expect(describeRecurrence(rule({ frequency: "monthly", monthDay: 5, maxRuns: 6 }))).toBe(
      "Todo dia 5 do mês às 09:00 · 6 envios",
    );
    expect(describeRecurrence(rule({ frequency: "once", startsOn: "2026-10-30", sendTime: "14:00" }))).toBe(
      "Uma vez, em 30/10/2026 às 14:00",
    );
  });
});
