import { describe, expect, it } from "vitest";
import {
  buildTemplateComponents,
  buildTemplateMessage,
  describeRejection,
  describeTemplateSendError,
  mapMetaTemplateStatus,
  renderTemplateText,
  toMetaTemplateName,
  validateTemplateInput,
} from "./metaTemplates";

const valid = {
  name: "Promoção de novembro",
  category: "marketing" as const,
  body: "Olá {nome}! Em novembro todos os serviços estão com 20% de desconto.",
};

describe("validateTemplateInput", () => {
  it("aceita um modelo simples", () => {
    expect(validateTemplateInput(valid)).toBeNull();
    expect(validateTemplateInput({ ...valid, body: "Novembro com 20% de desconto em tudo." })).toBeNull();
  });

  it("recusa {nome} no começo ou no fim", () => {
    expect(validateTemplateInput({ ...valid, body: "{nome}, temos desconto para você" })).toMatch(/começo/);
    expect(validateTemplateInput({ ...valid, body: "Temos desconto para você, {nome}!" })).toMatch(/fim/);
  });

  it("recusa outras variáveis e {nome} repetido", () => {
    expect(validateTemplateInput({ ...valid, body: "Olá {{1}}, temos desconto hoje." })).toMatch(/só \{nome\}/);
    expect(validateTemplateInput({ ...valid, body: "Olá {cliente}, temos desconto hoje." })).toMatch(/só \{nome\}/);
    expect(validateTemplateInput({ ...valid, body: "Olá {nome}, oi {nome}, tudo bem por aí?" })).toMatch(/uma vez/);
  });

  it("confere rodapé e botões", () => {
    expect(validateTemplateInput({ ...valid, footer: "x".repeat(61) })).toMatch(/rodapé/);
    expect(validateTemplateInput({ ...valid, buttons: ["Quero", "quero"] })).toMatch(/diferentes/);
    expect(validateTemplateInput({ ...valid, buttons: ["a", "b", "c", "d"] })).toMatch(/máximo 3/);
    expect(validateTemplateInput({ ...valid, buttons: ["Quero", " ", ""] })).toBeNull();
  });
});

describe("toMetaTemplateName", () => {
  it("gera nome técnico em minúsculas, sem acento, com sufixo", () => {
    expect(toMetaTemplateName("Promoção de Novembro!", "ab12")).toBe("promocao_de_novembro_ab12");
    expect(toMetaTemplateName("***", "x9")).toBe("modelo_x9");
  });
});

describe("buildTemplateComponents", () => {
  it("troca {nome} por {{1}} e manda o exemplo", () => {
    const components = buildTemplateComponents({ ...valid, footer: "Unxet", buttons: ["Quero"] });
    expect(components[0]).toEqual({
      type: "BODY",
      text: "Olá {{1}}! Em novembro todos os serviços estão com 20% de desconto.",
      example: { body_text: [["Maria"]] },
    });
    expect(components[1]).toEqual({ type: "FOOTER", text: "Unxet" });
    expect(components[2]).toEqual({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero" }] });
  });

  it("sem {nome}, não manda exemplo", () => {
    const [body] = buildTemplateComponents({ ...valid, body: "Novembro com 20% de desconto em tudo." });
    expect(body).not.toHaveProperty("example");
  });
});

describe("buildTemplateMessage e renderTemplateText", () => {
  it("passa o nome do cliente como parâmetro", () => {
    const payload = buildTemplateMessage({
      to: "5511999990000",
      metaTemplateName: "promo_ab12",
      languageCode: "pt_BR",
      body: valid.body,
      name: "Ana",
    });
    expect(payload.template.components?.[0].parameters[0].text).toBe("Ana");
  });

  it("sem nome com letra, usa o substituto", () => {
    const payload = buildTemplateMessage({
      to: "5511999990000",
      metaTemplateName: "promo_ab12",
      languageCode: "pt_BR",
      body: valid.body,
      name: "5511999990000",
    });
    expect(payload.template.components?.[0].parameters[0].text).toBe("cliente");
    expect(renderTemplateText(valid.body, null)).toBe(
      "Olá cliente! Em novembro todos os serviços estão com 20% de desconto.",
    );
  });

  it("modelo sem variável vai sem componentes", () => {
    const payload = buildTemplateMessage({
      to: "5511999990000",
      metaTemplateName: "promo_ab12",
      languageCode: "pt_BR",
      body: "Novembro com desconto.",
      name: "Ana",
    });
    expect(payload.template).not.toHaveProperty("components");
  });
});

describe("status e erros da Meta", () => {
  it("traduz o status", () => {
    expect(mapMetaTemplateStatus("APPROVED")).toBe("approved");
    expect(mapMetaTemplateStatus("pending")).toBe("pending");
    expect(mapMetaTemplateStatus("REJECTED")).toBe("rejected");
    expect(mapMetaTemplateStatus("PAUSED")).toBe("paused");
    expect(mapMetaTemplateStatus("DISABLED")).toBe("disabled");
    expect(mapMetaTemplateStatus("??")).toBeNull();
  });

  it("traduz o motivo da recusa", () => {
    expect(describeRejection("NONE")).toBeNull();
    expect(describeRejection("INVALID_FORMAT")).toMatch(/formato/);
    expect(describeRejection("Outro motivo")).toBe("Outro motivo");
  });

  it("número sem WhatsApp vira falha permanente", () => {
    expect(describeTemplateSendError(400, { error: { code: 131026 } })).toMatch(/^Este número não tem WhatsApp/);
    expect(describeTemplateSendError(400, { error: { code: 131050 } })).toMatch(/^Este número não tem WhatsApp/);
    expect(describeTemplateSendError(500, {})).toBe("Falha no envio (código 500).");
  });
});
