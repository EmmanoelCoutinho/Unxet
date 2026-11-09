import { describe, expect, it } from "vitest";
import { GENERIC_SEND_ERROR, sendErrorMessage } from "./sendError";

describe("sendErrorMessage", () => {
  it("número removido tem aviso próprio", () => {
    expect(
      sendErrorMessage(400, {
        error: "O número de WhatsApp desta conversa foi removido da empresa.",
        code: "number_removed",
      }),
    ).toMatch(/removido da empresa/);
  });

  it("traduz motivos conhecidos", () => {
    expect(sendErrorMessage(403, { error: "Not allowed" })).toMatch(/outro atendente/);
    expect(sendErrorMessage(429, { error: "rate_limited" })).toMatch(/Aguarde/);
  });

  it("mostra frase em português que veio da função", () => {
    expect(
      sendErrorMessage(400, { error: "Contato inválido: informe nome e telefone com DDD" }),
    ).toBe("Contato inválido: informe nome e telefone com DDD");
  });

  it("motivo técnico ou erro do servidor fica com o genérico", () => {
    expect(sendErrorMessage(400, { error: "nonce_invalid" })).toBe(GENERIC_SEND_ERROR);
    expect(sendErrorMessage(500, { error: "Erro ao salvar mensagem outbound" })).toBe(GENERIC_SEND_ERROR);
    expect(sendErrorMessage(400, null)).toBe(GENERIC_SEND_ERROR);
  });
});
