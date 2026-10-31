import { describe, expect, it } from "vitest";
import { buildChatTurns, buildSystemPrompt, messageToText } from "./aiAssistant";

describe("buildSystemPrompt", () => {
  it("junta base, empresa e etapa", () => {
    const prompt = buildSystemPrompt({
      companyName: "Ótica Visão",
      settings: {
        assistant_name: "Lia",
        tone: "formal",
        use_emojis: false,
        business_info: "Aberto de segunda a sexta, 9h às 18h.",
        faq: "",
        rules: "Nunca dê desconto.",
        custom_instructions: "Consulte o estoque antes de confirmar.",
      },
      node: { ai_instructions: "Qualifique o interesse em lentes." },
      departmentName: "Vendas",
    });
    expect(prompt).toContain("Você se chama Lia e atende pela empresa Ótica Visão");
    expect(prompt).toContain("senhor ou senhora");
    expect(prompt).toContain("Não use emojis.");
    expect(prompt).toContain("## Sobre a empresa\nAberto de segunda");
    expect(prompt).not.toContain("## Perguntas frequentes");
    expect(prompt).toContain("## Regras da empresa\nNunca dê desconto.");
    expect(prompt).toContain("## Instruções adicionais\nConsulte o estoque");
    expect(prompt).toContain("Qualifique o interesse em lentes.");
    expect(prompt).toContain("setor Vendas");
  });

  it("funciona sem configuração da empresa", () => {
    const prompt = buildSystemPrompt({ companyName: "Loja", settings: null, node: {} });
    expect(prompt).toContain("Você se chama Assistente");
    expect(prompt).not.toContain("Objetivo desta etapa");
  });
});

describe("messageToText", () => {
  it("usa a transcrição do áudio", () => {
    expect(messageToText({ direction: "inbound", type: "audio", transcript_text: "quero marcar" })).toBe(
      "[áudio] quero marcar",
    );
    expect(messageToText({ direction: "inbound", type: "audio" })).toBe("[áudio]");
  });

  it("marca mídia com legenda", () => {
    expect(messageToText({ direction: "inbound", type: "image", text: "olha isso" })).toBe("[foto] olha isso");
  });
});

describe("buildChatTurns", () => {
  it("junta mensagens seguidas e começa pelo cliente", () => {
    const turns = buildChatTurns([
      { direction: "outbound", text: "Olá! Como posso ajudar?" },
      { direction: "inbound", text: "oi" },
      { direction: "inbound", text: "quanto custa?" },
    ]);
    expect(turns).toEqual([
      { role: "user", content: "[o cliente iniciou a conversa]" },
      { role: "assistant", content: "Olá! Como posso ajudar?" },
      { role: "user", content: "oi\nquanto custa?" },
    ]);
  });

  it("termina com o cliente", () => {
    const turns = buildChatTurns([
      { direction: "inbound", text: "oi" },
      { direction: "outbound", text: "Escolha uma opção" },
    ]);
    expect(turns[turns.length - 1].role).toBe("user");
  });
});
