import { describe, expect, it } from "vitest";
import { agentSignature, cleanAgentName, loadAgentSender, signText } from "./agentSignature";

describe("cleanAgentName", () => {
  it("tira símbolos de formatação e espaços extras", () => {
    expect(cleanAgentName("  Maria   *Silva*\n")).toBe("Maria Silva");
    expect(cleanAgentName("_João_ ~Souza~ `x`")).toBe("João Souza x");
  });

  it("vazio para nome ausente", () => {
    expect(cleanAgentName(null)).toBe("");
    expect(cleanAgentName("   ")).toBe("");
  });

  it("corta nomes muito longos", () => {
    expect(cleanAgentName("a".repeat(80))).toHaveLength(60);
  });
});

describe("agentSignature", () => {
  it("negrito no WhatsApp, texto simples nos outros canais", () => {
    expect(agentSignature("Maria", { bold: true })).toBe("*Maria:*");
    expect(agentSignature("Maria", { bold: false })).toBe("Maria:");
  });

  it("sem nome, sem assinatura", () => {
    expect(agentSignature("", { bold: true })).toBe("");
  });
});

describe("signText", () => {
  it("nome na primeira linha e a mensagem embaixo", () => {
    expect(signText("Olá, tudo bem?", "Atendente 1", { bold: false })).toBe(
      "Atendente 1:\nOlá, tudo bem?",
    );
    expect(signText("Olá", "Maria", { bold: true })).toBe("*Maria:*\nOlá");
  });

  it("sem texto (ex.: foto sem legenda) vira só a assinatura", () => {
    expect(signText("", "Maria", { bold: true })).toBe("*Maria:*");
    expect(signText(null, "Maria", { bold: true })).toBe("*Maria:*");
  });

  it("sem nome devolve o texto como veio", () => {
    expect(signText("Olá", null, { bold: true })).toBe("Olá");
  });
});

describe("loadAgentSender", () => {
  const fakeAdmin = (opts: { name?: string | null; sign?: boolean | null; settingsError?: boolean }) => ({
    from: (table: string) => {
      const result =
        table === "clinic_users"
          ? { data: opts.name === undefined ? null : { name: opts.name }, error: null }
          : opts.settingsError
            ? { data: null, error: { message: "boom" } }
            : { data: opts.sign === undefined ? null : { sign_agent_messages: opts.sign }, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => result,
      };
      return chain;
    },
  });

  it("assina por padrão quando a pessoa tem nome", async () => {
    const sender = await loadAgentSender(fakeAdmin({ name: "Maria" }), "u1", "c1");
    expect(sender).toEqual({ userId: "u1", name: "Maria", sign: true });
  });

  it("respeita a empresa que desligou a assinatura", async () => {
    const sender = await loadAgentSender(fakeAdmin({ name: "Maria", sign: false }), "u1", "c1");
    expect(sender.sign).toBe(false);
    expect(sender.name).toBe("Maria");
  });

  it("não assina sem nome cadastrado nem com erro ao ler a configuração", async () => {
    expect((await loadAgentSender(fakeAdmin({ name: null }), "u1", "c1")).sign).toBe(false);
    expect((await loadAgentSender(fakeAdmin({ name: "Maria", settingsError: true }), "u1", "c1")).sign).toBe(false);
  });
});
