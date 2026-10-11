// Testes dos helpers das edge functions (código Deno) rodando no Vitest:
// o objeto global Deno é simulado antes de importar os módulos.
import { beforeAll, describe, expect, it, vi } from "vitest";

const SUPABASE_URL = "https://abc.supabase.co";

let parseSurveyScore: (raw: unknown) => number | null;
let mediaPathFromUrl: (url: unknown) => string | null;

beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => (name === "SUPABASE_URL" ? SUPABASE_URL : "") },
  });
  ({ parseSurveyScore } = await import("./satisfactionSurvey"));
  ({ mediaPathFromUrl } = await import("./media"));
});

describe("parseSurveyScore (pesquisa de satisfação)", () => {
  it.each([
    ["5", 5],
    ["nota 4", 4],
    ["4 estrelas", 4],
    ["cinco", 5],
    ["Três", 3],
    ["⭐⭐⭐", 3],
    ["3.", 3],
    ["  2 ! ", 2],
  ])("aceita %j como nota %i", (input, expected) => {
    expect(parseSurveyScore(input)).toBe(expected);
  });

  it.each(["10", "0", "6", "5 consultas", "1 minuto", "obrigado", "nota dez", "", null])(
    "rejeita %j",
    (input) => {
      expect(parseSurveyScore(input)).toBeNull();
    },
  );
});

describe("mediaPathFromUrl (bucket privado)", () => {
  const object = `${SUPABASE_URL}/storage/v1/object`;

  it("extrai o caminho de URLs do bucket", () => {
    expect(mediaPathFromUrl(`${object}/public/whatsapp-media/c/5511/inbound-audios/a.ogg`)).toBe(
      "c/5511/inbound-audios/a.ogg",
    );
    expect(mediaPathFromUrl(`${object}/public/whatsapp-media/c/outbound-images/x%20y.jpg`)).toBe(
      "c/outbound-images/x y.jpg",
    );
    expect(mediaPathFromUrl(`${object}/sign/whatsapp-media/c/a.ogg?token=t`)).toBe("c/a.ogg");
  });

  it.each([
    [`${object}/public/outro-bucket/a.jpg`, "outro bucket"],
    ["https://evil.com/storage/v1/object/public/whatsapp-media/a.jpg", "outro domínio"],
    ["https://abc.supabase.co.evil.com/storage/v1/object/public/whatsapp-media/a.jpg", "domínio parecido"],
    [`${object}/public/whatsapp-media/c/..%2F..%2Fsecret`, "caminho relativo"],
    [`${object}/public/whatsapp-media/`, "sem arquivo"],
    ["https://scontent.cdninstagram.com/v/a.mp4", "CDN externo"],
    [null, "vazio"],
  ])("rejeita %s (%s)", (url) => {
    expect(mediaPathFromUrl(url)).toBeNull();
  });
});

describe("webhook da Evolution", () => {
  let stripWebhookEventSuffix: (provided: string, secret: string) => string;
  let redactWebhookSecrets: (body: unknown) => any;
  let reconcileConnectionStatus: (
    currentStatus: string,
    evolutionState: string | null,
    instanceExists: boolean,
  ) => string | null;

  beforeAll(async () => {
    ({ stripWebhookEventSuffix, redactWebhookSecrets, reconcileConnectionStatus } = await import(
      "./evolutionWebhook"
    ));
  });

  it("remove o nome do evento colado no token (Webhook by Events)", () => {
    expect(stripWebhookEventSuffix("abc123/messages-upsert", "abc123")).toBe("abc123");
    expect(stripWebhookEventSuffix("abc123/connection-update", "abc123")).toBe("abc123");
    expect(stripWebhookEventSuffix("abc123", "abc123")).toBe("abc123");
  });

  it("não transforma um token errado em válido", () => {
    expect(stripWebhookEventSuffix("abc1234/messages-upsert", "abc123")).not.toBe("abc123");
    expect(stripWebhookEventSuffix("xyz/messages-upsert", "abc123")).not.toBe("abc123");
    expect(stripWebhookEventSuffix("", "abc123")).toBe("");
  });

  it("mascara apikey e token antes de logar, sem alterar o payload original", () => {
    const body = {
      event: "messages.set",
      apikey: "KEY",
      destination: "https://x.supabase.co/functions/v1/evolution-in?token=SECRET/messages-set",
    };
    const redacted = redactWebhookSecrets(body);
    expect(JSON.stringify(redacted)).not.toMatch(/KEY|SECRET/);
    expect(redacted.event).toBe("messages.set");
    expect(body.apikey).toBe("KEY");
  });

  it.each([
    ["connected", "close", true, "disconnected"],
    ["connected", null, false, "disconnected"],
    ["connected", "open", true, null],
    ["connected", "connecting", true, null],
    ["disconnected", "open", true, "connected"],
    ["disconnected", "close", true, null],
    ["disconnected", null, false, null],
  ])("status %s + estado %j (instância existe: %s) → %j", (status, state, exists, expected) => {
    expect(reconcileConnectionStatus(status, state, exists)).toBe(expected);
  });
});
