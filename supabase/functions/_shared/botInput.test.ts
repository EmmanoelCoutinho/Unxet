import { describe, expect, it } from "vitest";
import { classifyUnmatchedInput, isFreeText, isMediaMessageType } from "./botInput";

describe("isFreeText (frase que precisa de atendente)", () => {
  it.each([
    "Não possui cadastro no nosso sistema",
    "Vai mudar o sócio e as atividades vai ficar apenas o endereço",
    "Outro número me mandou esse",
    "Mais isso pra é mesmo ? Vou baixar aki",
    "📄 *Documentos obrigatórios para cadastro, 1° Licenciamento e Renovação:*",
    "[Mensagem em um formato que o Unxet ainda não exibe. Peça ao cliente para reenviar como texto, foto ou documento.]",
  ])("%s", (text) => {
    expect(isFreeText(text)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "1",
    "Oi",
    "Olá",
    "Boa tarde",
    "Bom dia, tudo bem?",
    "Oi, boa tarde! Tudo bem com você?",
    "Oky",
    "Certo",
    "AIMBERE2026",
    "Sistema VERI",
    "👍",
  ])("%s não é frase", (text) => {
    expect(isFreeText(text)).toBe(false);
  });
});

describe("isMediaMessageType", () => {
  it.each(["image", "audio", "document", "video", "IMAGE"])("%s é mídia", (type) => {
    expect(isMediaMessageType(type)).toBe(true);
  });
  it.each(["text", "interactive", "", null, undefined])("%s não é mídia", (type) => {
    expect(isMediaMessageType(type)).toBe(false);
  });
});

describe("classifyUnmatchedInput", () => {
  it("áudio ou foto sem legenda vai para atendente", () => {
    expect(classifyUnmatchedInput([{ type: "audio", text: "" }])).toBe("media");
    expect(classifyUnmatchedInput([{ type: "text", text: "oi" }, { type: "image", text: "" }])).toBe("media");
  });

  it("frase de verdade vai para atendente", () => {
    expect(
      classifyUnmatchedInput([
        { type: "text", text: "Não possui cadastro no nosso sistema" },
        { type: "text", text: "Esse CNPJ" },
      ]),
    ).toBe("free_text");
  });

  it("cumprimentos e respostas curtas continuam como opção inválida", () => {
    expect(
      classifyUnmatchedInput([
        { type: "text", text: "Oi" },
        { type: "text", text: "Bom dia" },
        { type: "text", text: "3" },
      ]),
    ).toBe("invalid");
  });
});
