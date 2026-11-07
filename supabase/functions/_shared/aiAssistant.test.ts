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
    expect(turns).toHaveLength(3);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toMatch(/^\(Nota do sistema:/);
    expect(turns[1]).toEqual({ role: "assistant", content: "Olá! Como posso ajudar?" });
    expect(turns[2]).toEqual({ role: "user", content: "oi\nquanto custa?" });
  });

  it("boas-vindas depois do cliente viram aviso junto da mensagem dele", () => {
    // Bot com boas-vindas e primeira etapa de IA: cliente → boas-vindas → IA
    const turns = buildChatTurns([
      { direction: "inbound", text: "oi" },
      { direction: "outbound", text: "Oi! Eu sou a Uni, da Unxet." },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toMatch(/^oi\n\n\(Nota do sistema:/);
    expect(turns[0].content).toContain("Oi! Eu sou a Uni, da Unxet.");
    // Nenhuma fala inventada do cliente
    expect(turns[0].content).not.toContain("aguarda");
  });

  it("menu e botão escolhido terminam na escolha do cliente", () => {
    const turns = buildChatTurns([
      { direction: "inbound", text: "oi" },
      { direction: "outbound", text: "Bem-vindo!" },
      { direction: "outbound", text: "Escolha: Conhecer a Unxet / Já sou cliente" },
      { direction: "inbound", text: "Conhecer a Unxet" },
    ]);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(turns[2].content).toBe("Conhecer a Unxet");
  });

  it("sem mensagem do cliente não monta histórico", () => {
    expect(buildChatTurns([{ direction: "outbound", text: "Olá" }])).toEqual([]);
  });
});
