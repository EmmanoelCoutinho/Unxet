import { describe, expect, it } from "vitest";
import { hasTemplateErrors, validateTemplateDraft, validateTemplateFields } from "./templates";

const valid = {
  name: "Promoção",
  category: "marketing" as const,
  body: "Olá {nome}, temos novidades para você hoje.",
  footer: "",
  buttons: [] as string[],
};

describe("validateTemplateFields", () => {
  it("modelo certo não tem erro", () => {
    expect(hasTemplateErrors(validateTemplateFields(valid))).toBe(false);
  });

  it("aponta cada campo com o próprio erro, todos de uma vez", () => {
    const errors = validateTemplateFields({
      ...valid,
      name: " ",
      body: "Use {cupom} hoje mesmo, por favor",
      footer: "Valido até {data}",
    });
    expect(errors.name).toBe("Dê um nome para o modelo.");
    expect(errors.body).toMatch(/Use só \{nome\}/);
    expect(errors.footer).toBe("O rodapé não pode ter variáveis.");
  });

  it("erro de botão fica no botão certo", () => {
    const errors = validateTemplateFields({ ...valid, buttons: ["Sim", "", "sim"] });
    expect(errors.buttons).toEqual({
      1: "Escreva o texto do botão ou remova o botão.",
      2: "Este botão repete o texto de outro.",
    });
  });

  it("validateTemplateDraft devolve o primeiro erro", () => {
    expect(validateTemplateDraft({ ...valid, body: "curto" })).toBe(
      "A mensagem precisa ter pelo menos 10 caracteres.",
    );
    expect(validateTemplateDraft(valid)).toBeNull();
  });
});
