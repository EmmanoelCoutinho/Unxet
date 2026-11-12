import { describe, expect, it, vi } from "vitest";
import {
  MAX_QUEUE_MESSAGE_BYTES,
  deliveryOutcome,
  evolutionHistorySummary,
  evolutionSkipReason,
  fromBase64,
  functionUrl,
  retryDelaySeconds,
  targetFromPath,
  toBase64,
  type QueuedWebhook,
} from "./gateway";
import { handleBatch, handleRequest, type Env, type QueueMessage } from "./index";

const BASE = "https://proj.supabase.co/functions/v1";

const makeEnv = (send = vi.fn().mockResolvedValue(undefined)): Env & { send: typeof send } => ({
  INBOUND: { send },
  SUPABASE_FUNCTIONS_URL: BASE,
  ENVIRONMENT: "test",
  send,
});

const evolutionRequest = (body: string, extra: Record<string, string> = {}) =>
  new Request("https://gw.test/evolution-in?token=SECRET", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "não repassa", ...extra },
    body,
  });

describe("gateway: regras", () => {
  it("só aceita as funções de entrada", () => {
    expect(targetFromPath("/evolution-in")).toBe("evolution-in");
    expect(targetFromPath("/meta-webhook/")).toBe("meta-webhook");
    expect(targetFromPath("/meta-in")).toBe("meta-in");
    expect(targetFromPath("/bot-engine")).toBeNull();
    expect(targetFromPath("/")).toBeNull();
  });

  it("monta o endereço com a query string original", () => {
    expect(functionUrl(`${BASE}/`, "evolution-in", "?token=a%2Fb")).toBe(
      `${BASE}/evolution-in?token=a%2Fb`,
    );
  });

  it("guarda o corpo byte a byte (assinatura da Meta)", () => {
    const original = new TextEncoder().encode('{"texto":"ação ✅ \\u00e9"}');
    expect(fromBase64(toBase64(original))).toEqual(original);
  });

  it.each([
    [200, "delivered"],
    [204, "delivered"],
    [500, "retry"],
    [503, "retry"],
    [546, "retry"],
    [429, "retry"],
    [408, "retry"],
    [400, "rejected"],
    [401, "rejected"],
    [404, "rejected"],
  ])("status %i → %s", (status, expected) => {
    expect(deliveryOutcome(status)).toBe(expected);
  });

  it("espera cada vez mais entre as tentativas, até 15 min", () => {
    expect([1, 2, 3, 4, 7, 8, 100].map(retryDelaySeconds)).toEqual([15, 30, 60, 120, 900, 900, 900]);
    // 100 tentativas cobrem perto das 24 h do plano grátis
    const total = Array.from({ length: 100 }, (_, i) => retryDelaySeconds(i + 1)).reduce((a, b) => a + b);
    expect(total / 3600).toBeGreaterThan(22);
    expect(total / 3600).toBeLessThan(25);
  });
});

describe("gateway: recebimento", () => {
  it("guarda na fila e responde na hora, sem chamar o Supabase", async () => {
    const env = makeEnv();
    const fetchImpl = vi.fn();
    const res = await handleRequest(
      evolutionRequest('{"event":"messages.upsert"}', { "x-webhook-secret": "s" }),
      env,
      fetchImpl,
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
    const queued: QueuedWebhook = env.send.mock.calls[0][0];
    expect(queued.target).toBe("evolution-in");
    expect(queued.search).toBe("?token=SECRET");
    expect(queued.headers).toEqual({ "content-type": "application/json", "x-webhook-secret": "s" });
    expect(new TextDecoder().decode(fromBase64(queued.body))).toBe('{"event":"messages.upsert"}');
  });

  it("repassa direto quando a fila falha", async () => {
    const env = makeEnv(vi.fn().mockRejectedValue(new Error("queue down")));
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const res = await handleRequest(evolutionRequest("{}"), env, fetchImpl);
    expect(res.status).toBe(200);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/evolution-in?token=SECRET`);
  });

  it("repassa direto quando a mensagem passa do limite da fila", async () => {
    const env = makeEnv();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const big = JSON.stringify({ data: "x".repeat(MAX_QUEUE_MESSAGE_BYTES) });
    await handleRequest(evolutionRequest(big), env, fetchImpl);
    expect(env.send).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("responde 503 quando nem a fila nem o Supabase respondem", async () => {
    const env = makeEnv(vi.fn().mockRejectedValue(new Error("queue down")));
    const fetchImpl = vi.fn().mockRejectedValue(new Error("supabase down"));
    const res = await handleRequest(evolutionRequest("{}"), env, fetchImpl);
    expect(res.status).toBe(503);
  });

  it("verificação da Meta (GET) vai direto para a função", async () => {
    const env = makeEnv();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("12345", { status: 200 }));
    const res = await handleRequest(
      new Request("https://gw.test/meta-webhook?hub.mode=subscribe&hub.challenge=12345"),
      env,
      fetchImpl,
    );
    expect(await res.text()).toBe("12345");
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/meta-webhook?hub.mode=subscribe&hub.challenge=12345`);
    expect(env.send).not.toHaveBeenCalled();
  });

  it("recusa caminhos desconhecidos e responde ao monitor", async () => {
    const env = makeEnv();
    expect((await handleRequest(new Request("https://gw.test/bot-engine", { method: "POST" }), env)).status).toBe(404);
    expect((await handleRequest(new Request("https://gw.test/health"), env)).status).toBe(200);
  });
});

describe("gateway: entrega da fila", () => {
  const queued: QueuedWebhook = {
    target: "meta-webhook",
    search: "",
    headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=abc" },
    body: toBase64(new TextEncoder().encode('{"entry":[]}')),
    receivedAt: "2026-11-04T12:00:00.000Z",
  };
  const message = (attempts = 1): QueueMessage & { ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> } => ({
    body: queued,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  });

  it("entrega com o corpo e a assinatura originais", async () => {
    const msg = message();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    await handleBatch({ queue: "q", messages: [msg] }, makeEnv(), fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}/meta-webhook`);
    expect(init.headers["x-hub-signature-256"]).toBe("sha256=abc");
    expect(init.headers["x-unxet-received-at"]).toBe(queued.receivedAt);
    expect(new TextDecoder().decode(init.body)).toBe('{"entry":[]}');
    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("tenta de novo, com espera, quando o Supabase está fora", async () => {
    const down = message(3);
    const error = message(1);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockRejectedValueOnce(new Error("timeout"));
    await handleBatch({ queue: "q", messages: [down, error] }, makeEnv(), fetchImpl);
    expect(down.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(error.retry).toHaveBeenCalledWith({ delaySeconds: 15 });
    expect(down.ack).not.toHaveBeenCalled();
  });

  it("descarta o que a função recusou", async () => {
    const msg = message();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await handleBatch({ queue: "q", messages: [msg] }, makeEnv(), fetchImpl);
    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
  });
});

describe("gateway: filtro da Evolution", () => {
  const skip = (payload: unknown) =>
    evolutionSkipReason(new TextEncoder().encode(typeof payload === "string" ? payload : JSON.stringify(payload)));
  const upsert = (remoteJid: string, fromMe = false) => ({
    event: "messages.upsert",
    data: { key: { remoteJid, fromMe } },
  });

  it.each(["contacts.update", "presence.update", "chats.update", "send.message", "messages.edited", "labels.edit"])(
    "descarta %s, que o app não usa",
    (event) => {
      expect(skip({ event, data: {} })).toBe(`event:${event}`);
    },
  );

  it("deixa passar mensagens de conversas, inclusive as enviadas pelo celular", () => {
    expect(skip(upsert("5511999998888@s.whatsapp.net"))).toBeNull();
    expect(skip(upsert("123456789@lid", true))).toBeNull();
  });

  it("descarta grupos, Status, canais e listas de transmissão", () => {
    expect(skip(upsert("1203630@g.us"))).toBe("jid");
    expect(skip(upsert("status@broadcast"))).toBe("jid");
    expect(skip(upsert("1203630@newsletter"))).toBe("jid");
  });

  it("deixa passar entregue/lido só das mensagens enviadas (v1 e v2)", () => {
    expect(skip({ event: "messages.update", data: { keyId: "A", fromMe: true, status: "READ" } })).toBeNull();
    expect(skip({ event: "messages.update", data: [{ key: { id: "A", fromMe: true }, update: { status: 3 } }] })).toBeNull();
    expect(skip({ event: "messages.update", data: { keyId: "A", fromMe: false, status: "READ" } })).toBe(
      "update_not_from_me",
    );
  });

  it("descarta status que o app não grava (enviada ao servidor, pendente, erro)", () => {
    expect(skip({ event: "messages.update", data: { keyId: "A", fromMe: true, status: "SERVER_ACK" } })).toBe(
      "update_status",
    );
    expect(skip({ event: "messages.update", data: [{ key: { id: "A", fromMe: true }, update: { status: 2 } }] })).toBe(
      "update_status",
    );
    expect(skip({ event: "messages.update", data: { keyId: "A", fromMe: true, status: "PLAYED" } })).toBeNull();
    // Status ausente ou desconhecido: quem decide é o evolution-in
    expect(skip({ event: "messages.update", data: { keyId: "A", fromMe: true } })).toBeNull();
    expect(skip({ event: "messages.update", data: { keyId: "A", fromMe: true, status: "NOVO" } })).toBeNull();
  });

  it("aceita os nomes em maiúsculas e deixa passar conexão e QR code", () => {
    expect(skip({ event: "CONNECTION_UPDATE", data: {} })).toBeNull();
    expect(skip({ event: "QRCODE_UPDATED", data: {} })).toBeNull();
    expect(skip({ event: "PRESENCE_UPDATE", data: {} })).toBe("event:presence.update");
  });

  it("na dúvida, deixa passar", () => {
    expect(skip("não é json")).toBeNull();
    expect(skip({})).toBeNull();
  });

  it("evento descartado responde 200 sem usar a fila nem o Supabase", async () => {
    const env = makeEnv();
    const fetchImpl = vi.fn();
    const res = await handleRequest(evolutionRequest('{"event":"presence.update","data":{}}'), env, fetchImpl);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true, reason: "event:presence.update" });
    expect(env.send).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("não filtra os webhooks da Meta", async () => {
    const env = makeEnv();
    await handleRequest(
      new Request("https://gw.test/meta-webhook", { method: "POST", body: '{"event":"presence.update"}' }),
      env,
    );
    expect(env.send).toHaveBeenCalledTimes(1);
  });
});

describe("gateway: resumo do histórico do pareamento", () => {
  const summary = (payload: unknown) =>
    evolutionHistorySummary(new TextEncoder().encode(typeof payload === "string" ? payload : JSON.stringify(payload)));
  const message = (remoteJid: string, fromMe: boolean, messageTimestamp: unknown) => ({
    key: { remoteJid, fromMe, id: "X" },
    message: { conversation: "texto que não pode ir para o log" },
    messageTimestamp,
  });

  it("ignora os outros eventos e JSON inválido", () => {
    expect(summary({ event: "messages.upsert", data: {} })).toBeNull();
    expect(summary("não é json")).toBeNull();
  });

  it("conta só mensagens de clientes em conversas individuais", () => {
    const result = summary({
      event: "MESSAGES_SET",
      instance: "loja",
      data: [
        message("5511999998888@s.whatsapp.net", false, 1794490000),
        message("5511999998888@s.whatsapp.net", false, "1794493600"),
        message("5511888887777@s.whatsapp.net", false, { low: 1794480000, high: 0 }),
        message("5511999998888@s.whatsapp.net", true, 1794499999),
        message("123@g.us", false, 1794400000),
        message("status@broadcast", false, 1794400000),
      ],
    });
    expect(result).toEqual({
      instance: "loja",
      total: 6,
      fromCustomers: 3,
      customerChats: 2,
      oldest: new Date(1794480000 * 1000).toISOString(),
      newest: new Date(1794493600 * 1000).toISOString(),
    });
    expect(JSON.stringify(result)).not.toContain("5511");
  });

  it("aceita o pacote dentro de data.messages e um pacote vazio", () => {
    expect(
      summary({ event: "messages.set", data: { messages: [message("5511@s.whatsapp.net", false, 1794490000)] } })
        ?.fromCustomers,
    ).toBe(1);
    expect(summary({ event: "messages.set", data: [] })).toMatchObject({ total: 0, oldest: null });
  });

  it("registra o resumo e continua descartando o evento", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const env = makeEnv();
    const res = await handleRequest(
      new Request("https://gw.test/evolution-in?token=abc", {
        method: "POST",
        body: JSON.stringify({ event: "messages.set", instance: "loja", data: [] }),
      }),
      env,
    );
    expect(await res.json()).toEqual({ ignored: true, reason: "event:messages.set" });
    expect(env.send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[GATEWAY_HISTORY_SET]", expect.objectContaining({ instance: "loja" }));
    log.mockRestore();
  });
});
