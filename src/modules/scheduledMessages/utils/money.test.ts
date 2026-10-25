import { describe, expect, it } from "vitest";
import { parseMoneyInput, previewMessageText } from "./schedule";

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
