import { describe, expect, it } from "vitest";
import {
  describeProviderError,
  renderScheduledText,
  sendDelayMs,
} from "./scheduledMessages";

describe("renderScheduledText", () => {
  it("troca {nome} pelo nome do destinatário (qualquer caixa)", () => {
    expect(renderScheduledText("Olá {nome}, tudo bem? Até já, {NOME}!", " Ana ")).toBe(
      "Olá Ana, tudo bem? Até já, Ana!",
    );
  });

  it("sem nome, remove a marcação e ajusta a pontuação", () => {
    expect(renderScheduledText("Olá {nome}, tudo bem?", null)).toBe("Olá, tudo bem?");
    expect(renderScheduledText("{nome}, bom dia!", "")).toBe("bom dia!");
    expect(renderScheduledText("Bom dia {nome}", undefined)).toBe("Bom dia");
  });

  it("não usa telefone gravado como nome", () => {
    expect(renderScheduledText("Olá {nome}!", "5511999998888")).toBe("Olá!");
  });

  it("mantém quebras de linha e textos sem marcação", () => {
    expect(renderScheduledText("Linha 1\n\nLinha 2", "Ana")).toBe("Linha 1\n\nLinha 2");
    expect(renderScheduledText("Oi {nome}\nSegue o boleto.", null)).toBe(
      "Oi\nSegue o boleto.",
    );
  });
});

describe("sendDelayMs", () => {
  it("fica dentro da faixa", () => {
    expect(sendDelayMs(3000, 6000, () => 0)).toBe(3000);
    expect(sendDelayMs(3000, 6000, () => 1)).toBe(6000);
    expect(sendDelayMs(3000, 6000, () => 0.5)).toBe(4500);
  });
});

describe("describeProviderError", () => {
  it("reconhece número sem WhatsApp", () => {
    const body = {
      status: 400,
      response: { message: [{ exists: false, number: "5511999998888" }] },
    };
    expect(describeProviderError(400, body)).toBe("Este número não tem WhatsApp.");
  });

  it("usa o texto do erro quando existe", () => {
    expect(describeProviderError(500, { message: "Connection Closed" })).toBe(
      "Falha no envio: Connection Closed",
    );
  });

  it("cai no código HTTP quando não há detalhe", () => {
    expect(describeProviderError(502, null)).toBe("Falha no envio (código 502).");
  });
});
