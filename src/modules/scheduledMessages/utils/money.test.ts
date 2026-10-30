import { describe, expect, it } from "vitest";
import { aggregateCampaigns, parseMoneyInput, previewMessageText, startsIn } from "./schedule";

describe("parseMoneyInput", () => {
  it.each([
    ["150", 150],
    ["1.500,00", 1500],
    ["R$ 80,5", 80.5],
    ["99.90", 99.9],
  ])("aceita %j", (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });

  it("vazio vira null", () => {
    expect(parseMoneyInput("  ")).toBeNull();
  });

  it.each(["abc", "-10", "1,2,3", "10,999"])("rejeita %j", (input) => {
    expect(Number.isNaN(parseMoneyInput(input))).toBe(true);
  });
});

describe("previewMessageText", () => {
  it("troca {nome} pelo nome do cliente", () => {
    expect(previewMessageText("Olá {nome}, tudo bem?", "Ana")).toBe("Olá Ana, tudo bem?");
  });

  it("sem nome, tira a marcação e ajusta a pontuação", () => {
    expect(previewMessageText("Olá {nome}, tudo bem?", null)).toBe("Olá, tudo bem?");
    expect(previewMessageText("{nome}, temos novidades", "5511999")).toBe("temos novidades");
  });
});

describe("lista de campanhas", () => {
  it("soma os totais do topo", () => {
    expect(
      aggregateCampaigns([
        { stats: { sent: 10, replied: 3, converted: 1, revenue: 150 } },
        { stats: { sent: 5, replied: 0, converted: 0, revenue: 0 } },
      ]),
    ).toEqual({ campaigns: 2, sent: 15, replied: 3, converted: 1, revenue: 150 });
  });

  it("diz quanto falta para começar", () => {
    const now = new Date("2026-10-28T12:00:00Z").getTime();
    expect(startsIn("2026-10-28T12:15:00Z", now)).toBe("em 15 min");
    expect(startsIn("2026-10-28T15:00:00Z", now)).toBe("em 3 h");
    expect(startsIn("2026-10-30T12:00:00Z", now)).toBe("em 2 dias");
    expect(startsIn("2026-10-28T11:00:00Z", now)).toBe("");
  });
});
