import { describe, expect, it } from "vitest";
import {
  mediaExtension,
  phoneMessageConversationUpdates,
  waitForKnownMessage,
} from "./phoneSentMessages";

// Supabase falso: devolve, a cada consulta, o próximo resultado da lista
const fakeLookup = (results: Array<{ data?: unknown; error?: unknown }>) => {
  let calls = 0;
  const query = {
    select: () => query,
    eq: () => query,
    limit: () => query,
    maybeSingle: async () => results[Math.min(calls++, results.length - 1)],
  };
  return { client: { from: () => query }, calls: () => calls };
};

describe("waitForKnownMessage", () => {
  it("mensagem gravada pelo Unxet: true e para de procurar", async () => {
    const fake = fakeLookup([{ data: null }, { data: { id: "m1" } }]);
    expect(await waitForKnownMessage(fake.client, "WA1", [0, 0, 0])).toBe(true);
    expect(fake.calls()).toBe(2);
  });

  it("ninguém gravou: saiu do celular", async () => {
    const fake = fakeLookup([{ data: null }]);
    expect(await waitForKnownMessage(fake.client, "WA1", [0, 0])).toBe(false);
    expect(fake.calls()).toBe(2);
  });

  it("banco falhou: null (na dúvida, nada muda)", async () => {
    const fake = fakeLookup([{ data: null, error: { message: "fora" } }]);
    expect(await waitForKnownMessage(fake.client, "WA1", [0, 0])).toBeNull();
  });
});

describe("phoneMessageConversationUpdates", () => {
  const now = "2026-11-14T12:00:00.000Z";

  it("conta como resposta da empresa e zera o prazo de 1ª resposta", () => {
    expect(
      phoneMessageConversationUpdates(
        { last_message_at: "2026-11-14T10:00:00.000Z", last_outbound_at: null, first_outbound_at: null },
        "2026-11-14T11:00:00.000Z",
        now,
      ),
    ).toEqual({
      updated_at: now,
      last_message_at: "2026-11-14T11:00:00.000Z",
      last_outbound_at: "2026-11-14T11:00:00.000Z",
      first_unanswered_inbound_at: null,
      first_outbound_at: "2026-11-14T11:00:00.000Z",
    });
  });

  it("mensagem mais antiga não faz a conversa voltar no tempo", () => {
    const updates = phoneMessageConversationUpdates(
      {
        last_message_at: "2026-11-14T11:30:00.000Z",
        last_outbound_at: "2026-11-14T11:20:00.000Z",
        first_outbound_at: "2026-11-14T09:00:00.000Z",
      },
      "2026-11-14T11:00:00.000Z",
      now,
    );
    expect(updates.last_message_at).toBe("2026-11-14T11:30:00.000Z");
    expect(updates.last_outbound_at).toBe("2026-11-14T11:20:00.000Z");
    expect(updates).not.toHaveProperty("first_outbound_at");
    expect(updates).not.toHaveProperty("status");
  });
});

describe("mediaExtension", () => {
  it("usa a extensão do nome do arquivo", () => {
    expect(mediaExtension("application/pdf", "boleto.final.PDF")).toBe("PDF");
  });

  it("sem nome, usa o tipo", () => {
    expect(mediaExtension("audio/ogg; codecs=opus")).toBe("ogg");
    expect(mediaExtension("image/jpeg", null)).toBe("jpg");
    expect(mediaExtension(null)).toBe("bin");
  });
});
