import { describe, expect, it } from "vitest";
import { isActiveContact } from "./activity";

const now = new Date("2026-11-24T12:00:00.000Z").getTime();
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

describe("isActiveContact", () => {
  it("cliente que mandou mensagem hoje continua ativo com a conversa encerrada", () => {
    expect(
      isActiveContact({ lastContactAt: daysAgo(0), conversationStatus: "closed", now }),
    ).toBe(true);
  });

  it("atendimento em andamento é ativo mesmo sem data de contato", () => {
    expect(isActiveContact({ lastContactAt: null, conversationStatus: "pending", now })).toBe(true);
    expect(isActiveContact({ lastContactAt: daysAgo(90), conversationStatus: "open", now })).toBe(true);
  });

  it("encerrada e sem contato há 30 dias ou mais é inativo", () => {
    expect(isActiveContact({ lastContactAt: daysAgo(30), conversationStatus: "closed", now })).toBe(false);
    expect(isActiveContact({ lastContactAt: null, conversationStatus: null, now })).toBe(false);
  });

  it("sem conversa, mas com contato recente, é ativo", () => {
    expect(isActiveContact({ lastContactAt: daysAgo(29), now })).toBe(true);
  });
});
