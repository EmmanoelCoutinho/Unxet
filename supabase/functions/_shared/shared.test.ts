// Testes dos helpers das edge functions (código Deno) rodando no Vitest:
// o objeto global Deno é simulado antes de importar os módulos.
import { beforeAll, describe, expect, it, vi } from "vitest";

const SUPABASE_URL = "https://abc.supabase.co";

let parseSurveyScore: (raw: unknown, scaleMin?: number, scaleMax?: number) => number | null;
let isCourtesyReply: (raw: unknown) => boolean;
let isScoreAttempt: (raw: unknown) => boolean;
let scaleFromMessage: (message: unknown) => { min: number; max: number } | null;
let matchSurveyAnswer: (admin: unknown, params: Record<string, unknown>) => Promise<any>;
let mediaPathFromUrl: (url: unknown) => string | null;
let isClinicMediaUrl: (url: string | null | undefined, clinicId: string) => boolean;

beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => (name === "SUPABASE_URL" ? SUPABASE_URL : "") },
  });
  ({ parseSurveyScore, isCourtesyReply, isScoreAttempt, scaleFromMessage, matchSurveyAnswer } = await import("./satisfactionSurvey"));
  ({ mediaPathFromUrl, isClinicMediaUrl } = await import("./media"));
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
    ["5, obrigado!", 5],
    ["Nota: 4", 4],
    ["nota 5 😊", 5],
    ["5️⃣", 5],
    ["4 excelente atendimento", 4],
    ["Obrigada pelo atendimento, nota 5", 5],
    ["Minha nota é 5", 5],
    ["⭐⭐⭐⭐⭐ obrigado", 5],
    ["Dou 5 estrelas", 5],
  ])("aceita %j como nota %i", (input, expected) => {
    expect(parseSurveyScore(input)).toBe(expected);
  });

  it.each([
    "10", "0", "6", "5 consultas", "1 minuto", "obrigado", "nota dez", "4/10", "⭐⭐⭐⭐⭐⭐", "", null,
    "obrigado, um ótimo dia", "5 ou 4?", "quero marcar 2 consultas", "3 e 4",
  ])(
    "rejeita %j",
    (input) => {
      expect(parseSurveyScore(input)).toBeNull();
    },
  );

  describe("escala escolhida pela empresa", () => {
    it.each([
      ["10", 0, 10, 10],
      ["0", 0, 10, 0],
      ["zero", 0, 10, 0],
      ["nota dez", 1, 10, 10],
      ["8/10", 1, 10, 8],
      ["8 de 10", 1, 10, 8],
      ["Sete.", 1, 10, 7],
      ["4/5", 1, 5, 4],
    ])("aceita %j em %i a %i como nota %i", (input, min, max, expected) => {
      expect(parseSurveyScore(input, min, max)).toBe(expected);
    });

    it.each([
      ["0", 1, 10],
      ["11", 0, 10],
      ["8/5", 1, 10],
      ["1", 2, 7],
      ["100", 0, 10],
    ])("rejeita %j em %i a %i", (input, min, max) => {
      expect(parseSurveyScore(input, min, max)).toBeNull();
    });

    it("aceita 🔟 em 0 a 10", () => {
      expect(parseSurveyScore("🔟", 0, 10)).toBe(10);
    });
  });
});

describe("scaleFromMessage (escala que a mensagem pede)", () => {
  it.each([
    ["Como você avalia o nosso atendimento? Responda com uma nota de 1 a 10, sendo 1 pouco satisfeito e 10 muito satisfeito.", 1, 10],
    ["Dê uma nota de 0 a 10", 0, 10],
    ["Avalie de 1 até 5 ⭐", 1, 5],
    ["Nota 1-5, por favor", 1, 5],
    ["Atendemos das 8 a 18h. De 1 a 5, como foi?", 1, 5],
  ])("lê %j como %i a %i", (message, min, max) => {
    expect(scaleFromMessage(message)).toEqual({ min, max });
  });

  it.each(["Como foi o atendimento?", "Atendemos das 8:00 a 10:00", "Nota de 5 a 1", "", null])(
    "não acha escala em %j",
    (message) => {
      expect(scaleFromMessage(message)).toBeNull();
    },
  );

  it("a nota 8 vale na escala da mensagem mesmo com a configurada em 1 a 5", () => {
    const scale = scaleFromMessage("Responda com uma nota de 1 a 10");
    expect(parseSurveyScore("8")).toBeNull();
    expect(parseSurveyScore("8", scale!.min, scale!.max)).toBe(8);
  });
});

describe("isScoreAttempt (nota fora da escala não reabre)", () => {
  it.each(["8", "nota 9", "10", "8/10", "dez", "0"])("%j é tentativa de nota", (input) => {
    expect(isScoreAttempt(input)).toBe(true);
  });

  it.each(["obrigado", "5 consultas", "15", "quero remarcar", "", null])("%j não é", (input) => {
    expect(isScoreAttempt(input)).toBe(false);
  });
});

describe("matchSurveyAnswer (mesma nota entregue duas vezes)", () => {
  // Banco em memória com o mínimo que a função usa
  const makeAdmin = () => {
    const tables: Record<string, any[]> = {
      satisfaction_surveys: [
        {
          id: "s1", clinic_id: "c1", contact_id: "p1", channel_connection_id: "ch1",
          conversation_id: "conv1", channel: "whatsapp", status: "sent", scale_min: 1, scale_max: 10,
          sent_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ],
      conversation_events: [],
      conversation_automation_settings: [
        { clinic_id: "c1", satisfaction_survey_message: "Nota de 1 a 10", satisfaction_survey_thanks_message: null },
      ],
    };
    const from = (table: string) => {
      const filters: ((row: any) => boolean)[] = [];
      let patch: any = null;
      const run = () => {
        const rows = tables[table].filter((row) => filters.every((f) => f(row)));
        if (patch) rows.forEach((row) => Object.assign(row, patch));
        return rows;
      };
      const query: any = {
        select: () => query,
        update: (values: any) => ((patch = values), query),
        insert: async (row: any) => (tables[table].push(row), { error: null }),
        eq: (col: string, value: any) => (filters.push((row) => row[col] === value), query),
        gt: (col: string, value: any) => (filters.push((row) => row[col] > value), query),
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: any) => resolve({ data: run(), error: null }),
      };
      return query;
    };
    return { from, tables };
  };
  const params = { clinicId: "c1", contactId: "p1", channelConnectionId: "ch1", text: "8" };

  it("a segunda entrega não reabre a conversa nem registra a nota de novo", async () => {
    const admin = makeAdmin();
    const first = await matchSurveyAnswer(admin, params);
    expect(first).toMatchObject({ conversationId: "conv1", score: 8 });
    expect(first.duplicate).toBeUndefined();

    const second = await matchSurveyAnswer(admin, params);
    expect(second).toMatchObject({ conversationId: "conv1", score: 8, duplicate: true });
    expect(admin.tables.conversation_events).toHaveLength(1);
  });

  it("sem pesquisa pendente, outra mensagem segue como mensagem normal", async () => {
    const admin = makeAdmin();
    await matchSurveyAnswer(admin, params);
    expect(await matchSurveyAnswer(admin, { ...params, text: "Quero remarcar" })).toBeNull();
    expect(await matchSurveyAnswer(admin, { ...params, text: "9" })).toBeNull();
  });
});

describe("isCourtesyReply (agradecimento depois do encerramento)", () => {
  it.each(["Obrigado!", "ok 👍", "🙏", "Muito obrigada pelo atendimento", "Valeu, tchau", "Bom dia"])(
    "não reabre com %j",
    (input) => {
      expect(isCourtesyReply(input)).toBe(true);
    },
  );

  it.each(["Quero remarcar", "obrigado, pode me ajudar?", "5", "", null])("trata %j como mensagem normal", (input) => {
    expect(isCourtesyReply(input)).toBe(false);
  });
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

describe("isClinicMediaUrl (envio só de arquivos da própria empresa)", () => {
  const object = `${SUPABASE_URL}/storage/v1/object/public/whatsapp-media`;

  it("aceita arquivo da pasta da empresa", () => {
    expect(isClinicMediaUrl(`${object}/emp-1/library/a.pdf`, "emp-1")).toBe(true);
    expect(isClinicMediaUrl(`${object}/emp-1/5511/inbound-documents/m/a.pdf`, "emp-1")).toBe(true);
  });

  it("recusa arquivo de outra empresa", () => {
    expect(isClinicMediaUrl(`${object}/emp-2/library/a.pdf`, "emp-1")).toBe(false);
    expect(isClinicMediaUrl(`${object}/emp-10/library/a.pdf`, "emp-1")).toBe(false);
    expect(isClinicMediaUrl(`${object}/emp-1/a.pdf`, "")).toBe(false);
  });

  it("não se aplica a links de fora do nosso Storage", () => {
    expect(isClinicMediaUrl("https://cdn.exemplo.com/a.pdf", "emp-1")).toBe(true);
    expect(isClinicMediaUrl(null, "emp-1")).toBe(true);
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
