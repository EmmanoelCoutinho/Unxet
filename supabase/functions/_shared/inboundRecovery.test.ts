import { describe, expect, it, vi } from "vitest";
import {
  fetchLidPhone,
  fetchStoredMessages,
  importOutcome,
  lidPhoneMap,
  unresolvedLids,
  withPhone,
  pickRecoverable,
  recoveredWebhookBody,
  recoveryPhase,
  recoveryWindow,
} from "./inboundRecovery";

const now = new Date("2026-11-12T23:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60000).toISOString();

const record = (id: string, timestamp: number, extra: Record<string, unknown> = {}) => ({
  id: `db-${id}`,
  key: { id, fromMe: false, remoteJid: "123@lid", remoteJidAlt: "5511999998888@s.whatsapp.net", ...extra },
  pushName: "Cliente",
  messageType: "conversation",
  message: { conversation: "oi" },
  messageTimestamp: timestamp,
  MessageUpdate: [{ status: "READ" }],
});

describe("recoveryPhase", () => {
  it("espera o histórico chegar, roda e encerra", () => {
    expect(recoveryPhase(minutesAgo(1), now)).toBe("wait");
    expect(recoveryPhase(minutesAgo(3), now)).toBe("run");
    expect(recoveryPhase(minutesAgo(29), now)).toBe("run");
    expect(recoveryPhase(minutesAgo(31), now)).toBe("last");
    expect(recoveryPhase("data inválida", now)).toBe("last");
  });
});

describe("recoveryWindow", () => {
  it("vai da última mensagem recebida (com folga) até agora", () => {
    expect(recoveryWindow(minutesAgo(60), now)).toEqual({ gte: minutesAgo(65), lte: now.toISOString() });
  });

  it("não volta mais de 7 dias", () => {
    expect(recoveryWindow(minutesAgo(60 * 24 * 30), now)?.gte).toBe(minutesAgo(60 * 24 * 7));
  });

  it("não busca nada para número que nunca recebeu mensagem", () => {
    expect(recoveryWindow(null, now)).toBeNull();
    expect(recoveryWindow("data inválida", now)).toBeNull();
  });
});

describe("pickRecoverable", () => {
  it("fica só com mensagens de clientes em conversas individuais, da mais antiga para a mais nova", () => {
    const picked = pickRecoverable([
      record("C", 300),
      record("ENVIADA", 250, { fromMe: true }),
      record("A", 100),
      record("GRUPO", 150, { remoteJid: "123@g.us" }),
      record("STATUS", 160, { remoteJid: "status@broadcast" }),
      record("B", 200, { remoteJid: "5511988887777@s.whatsapp.net" }),
      record("A", 100),
      { ...record("SEM_CONTEUDO", 170), message: null },
      { key: { fromMe: false, remoteJid: "123@lid" }, message: {} },
    ]);
    expect(picked.map((r) => r.key.id)).toEqual(["A", "B", "C"]);
  });

  it("aceita resposta vazia ou fora do formato", () => {
    expect(pickRecoverable(null)).toEqual([]);
    expect(pickRecoverable({})).toEqual([]);
  });
});

describe("recoveredWebhookBody", () => {
  it("monta o webhook no formato do messages.upsert, marcado como recuperado", () => {
    const body = recoveredWebhookBody("loja", record("A", 100));
    expect(body).toEqual({
      event: "messages.upsert",
      instance: "loja",
      recovered: true,
      data: {
        key: { id: "A", fromMe: false, remoteJid: "123@lid", remoteJidAlt: "5511999998888@s.whatsapp.net" },
        pushName: "Cliente",
        message: { conversation: "oi" },
        messageType: "conversation",
        messageTimestamp: 100,
      },
    });
  });
});

describe("fetchStoredMessages", () => {
  const window = { gte: minutesAgo(60), lte: now.toISOString() };
  const page = (records: unknown[], pages: number) => ({
    ok: true,
    status: 200,
    json: async () => ({ messages: { total: 3, pages, currentPage: 1, records } }),
  });

  it("busca todas as páginas do intervalo", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page([record("A", 1), record("B", 2)], 2))
      .mockResolvedValueOnce(page([record("C", 3)], 2));
    const result = await fetchStoredMessages("https://evo.test/", "key", "loja 1", window, { fetchImpl });
    expect(result?.records.map((r) => r.key.id)).toEqual(["A", "B", "C"]);
    expect(result?.truncated).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://evo.test/chat/findMessages/loja%201");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      where: { messageTimestamp: window },
      page: 2,
      offset: 250,
    });
  });

  it("avisa quando havia mais páginas que o teto", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([record("A", 1)], 5));
    const result = await fetchStoredMessages("https://evo.test", "key", "loja", window, { fetchImpl, maxPages: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result?.truncated).toBe(true);
  });

  it("devolve null quando a Evolution falha, sem lançar", async () => {
    const failing = vi.fn().mockResolvedValue({ ok: false, status: 500, body: null });
    expect(await fetchStoredMessages("https://evo.test", "key", "loja", window, { fetchImpl: failing })).toBeNull();
    const offline = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await fetchStoredMessages("https://evo.test", "key", "loja", window, { fetchImpl: offline })).toBeNull();
  });
});

describe("telefone das mensagens com @lid", () => {
  const live = record("VIVO", 500, { remoteJid: "111@lid", remoteJidAlt: "5511999998888@s.whatsapp.net" });
  const fromHistory = (id: string, remoteJid = "111@lid") => {
    const r = record(id, 400, { remoteJid });
    delete (r.key as Record<string, unknown>).remoteJidAlt;
    return r;
  };

  it("monta o mapa a partir das mensagens que trazem os dois", () => {
    const map = lidPhoneMap([fromHistory("A"), live, record("X", 1, { remoteJid: "222@lid", remoteJidAlt: "222@lid" })]);
    expect([...map]).toEqual([["111@lid", "5511999998888@s.whatsapp.net"]]);
  });

  it("lista os @lid que ainda estão sem telefone", () => {
    const map = lidPhoneMap([live]);
    const pn = record("PN", 1, { remoteJid: "5511988887777@s.whatsapp.net" });
    delete (pn.key as Record<string, unknown>).remoteJidAlt;
    expect(unresolvedLids([fromHistory("A"), fromHistory("B", "333@lid"), fromHistory("C", "333@lid"), pn], map)).toEqual([
      "333@lid",
    ]);
  });

  it("completa o telefone ou devolve null", () => {
    const map = lidPhoneMap([live]);
    expect(withPhone(fromHistory("A"), map)?.key.remoteJidAlt).toBe("5511999998888@s.whatsapp.net");
    expect(withPhone(live, new Map())).toBe(live);
    expect(withPhone(fromHistory("B", "333@lid"), map)).toBeNull();
  });

  it("procura o telefone na Evolution pelas mensagens do contato", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: { records: [fromHistory("A"), live] } }),
    });
    expect(await fetchLidPhone("https://evo.test", "key", "loja", "111@lid", { fetchImpl })).toBe(
      "5511999998888@s.whatsapp.net",
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      where: { key: { remoteJid: "111@lid" } },
      page: 1,
      offset: 50,
    });
    const offline = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await fetchLidPhone("https://evo.test", "key", "loja", "111@lid", { fetchImpl: offline })).toBeNull();
  });
});

describe("importOutcome", () => {
  it("separa importada, descartada e falha", () => {
    expect(importOutcome(200, '{"success":true}')).toBe("imported");
    expect(importOutcome(200, '{"ignored":true,"reason":"lid_unresolvable"}')).toBe("ignored:lid_unresolvable");
    expect(importOutcome(200, "OK")).toBe("imported");
    expect(importOutcome(502, "Upstream error")).toBe("failed");
  });
});
