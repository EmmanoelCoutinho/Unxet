import { describe, expect, it } from "vitest";
import {
  buildTemplateComponents,
  buildTemplateMessage,
  describeRejection,
  describeTemplateSendError,
  mapMetaTemplateStatus,
  renderTemplateText,
  templateIsCampaignSafe,
  templateVariables,
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

describe("variáveis do lembrete da Agenda", () => {
  const reminder = {
    name: "Lembrete de horário",
    category: "utility" as const,
    body: "Olá {nome}! Seu horário de {servico} com {profissional} é {data}, às {hora}. Até lá!",
  };

  it("aceita {data}, {hora}, {profissional} e {servico}, cada uma uma vez", () => {
    expect(validateTemplateInput(reminder)).toBeNull();
    expect(validateTemplateInput({ ...reminder, body: "Lembrete: {data} e de novo {data}, combinado?" })).toMatch(
      /\{data\} só uma vez/,
    );
    expect(validateTemplateInput({ ...reminder, body: "{hora} é o seu horário, combinado?" })).toMatch(/começo/);
  });

  it("numera na ordem em que aparecem e manda um exemplo de cada", () => {
    const [body] = buildTemplateComponents(reminder);
    expect(body).toEqual({
      type: "BODY",
      text: "Olá {{1}}! Seu horário de {{2}} com {{3}} é {{4}}, às {{5}}. Até lá!",
      example: { body_text: [["Maria", "Consulta", "Dra. Ana", "sexta-feira, 28/11", "14:30"]] },
    });
  });

  it("envia os valores na mesma ordem; valor vazio vira hífen", () => {
    const values = { data: "sexta-feira, 28/11", hora: "14:30", profissional: "Dra. Ana" };
    const payload = buildTemplateMessage({
      to: "5511999990000",
      metaTemplateName: "lembrete_ab12",
      languageCode: "pt_BR",
      body: reminder.body,
      name: "Ana",
      values,
    });
    expect(payload.template.components?.[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "Ana",
      "-",
      "Dra. Ana",
      "sexta-feira, 28/11",
      "14:30",
    ]);
    expect(renderTemplateText(reminder.body, "Ana", { ...values, servico: "Consulta" })).toBe(
      "Olá Ana! Seu horário de Consulta com Dra. Ana é sexta-feira, 28/11, às 14:30. Até lá!",
    );
  });

  it("só modelos com {nome} servem para Campanhas", () => {
    expect(templateIsCampaignSafe(valid.body)).toBe(true);
    expect(templateIsCampaignSafe("Sem variáveis aqui.")).toBe(true);
    expect(templateIsCampaignSafe(reminder.body)).toBe(false);
    expect(templateVariables(reminder.body)).toEqual(["nome", "servico", "profissional", "data", "hora"]);
  });
});
