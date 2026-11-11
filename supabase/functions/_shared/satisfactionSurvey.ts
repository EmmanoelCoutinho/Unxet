// deno-lint-ignore-file
// @ts-nocheck
// Pesquisa de satisfação: envio ao encerrar e captura da resposta.
// A escala da nota (ex.: 1 a 5, 0 a 10) é escolhida por cada empresa.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";

export const DEFAULT_SCALE_MIN = 1;
export const DEFAULT_SCALE_MAX = 5;

const SCORE_WORDS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

// "8", "nota 8", "oito", "8/10", "8 de 10", "4 estrelas"
const SCORE_PATTERN =
  /^(?:nota\s*)?(\d{1,2}|[a-z]+)(?:\s*(?:\/|de)\s*(\d{1,2}|[a-z]+))?(?:\s*(?:estrelas?|pontos?))?[\s.!]*$/;

const wordToNumber = (value: string): number | undefined =>
  /^\d+$/.test(value) ? Number(value) : SCORE_WORDS[value];

// Palavras de agradecimento/elogio que o cliente costuma mandar junto com a
// nota ("5, obrigado!") ou sozinhas depois do encerramento ("Obrigada 🙏").
const COURTESY_WORDS = new Set([
  "ok", "okay", "blz", "beleza", "certo", "certinho", "combinado", "entendi", "joia",
  "obrigado", "obrigada", "obrigados", "obrigadas", "obg", "brigado", "brigada",
  "grato", "grata", "gratidao", "valeu", "vlw", "tmj", "agradeco",
  "tchau", "ate", "mais", "logo", "amem", "deus", "abencoe", "abraco", "abracos", "igualmente",
  "top", "show", "legal", "perfeito", "perfeita", "otimo", "otima", "excelente",
  "maravilha", "maravilhoso", "maravilhosa", "bom", "boa", "amei", "adorei", "gostei",
  "parabens", "muito", "mto", "mt", "super", "tudo", "bem", "dia", "tarde", "noite",
  "de", "nada", "pelo", "pela", "atendimento", "por", "voce", "vc", "voces", "vcs",
  "a", "o", "e", "foi", "ta", "esta",
]);

// Palavras que só fazem sentido junto da nota ("minha nota é 5", "dou 5 estrelas")
const SCORE_CONTEXT_WORDS = new Set([
  "nota", "minha", "dou", "estrela", "estrelas", "ponto", "pontos",
]);

const normalizeAnswer = (raw: string) =>
  raw
    .replace(/🔟/g, " 10 ")
    // emojis de número do teclado (5️⃣) viram o próprio dígito
    .replace(/([0-9])️?⃣/g, " $1 ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

const wordsOf = (text: string) => text.split(/[^a-z0-9]+/).filter(Boolean);

const isCourtesyWord = (word: string) => COURTESY_WORDS.has(word) || /^(ok+|k{3,}|rs+)$/.test(word);

/**
 * Mensagem só de agradecimento, cumprimento ou emoji ("Obrigado!", "ok 👍",
 * "🙏"). Enquanto a pesquisa espera a nota, ela fica na conversa encerrada,
 * sem reabrir o atendimento.
 */
export const isCourtesyReply = (raw: unknown): boolean => {
  if (typeof raw !== "string" || !raw.trim() || raw.includes("?")) return false;
  const words = wordsOf(normalizeAnswer(raw));
  if (words.length > 10) return false;
  return words.every(isCourtesyWord);
};

/**
 * Escala que o texto da pesquisa pede ao cliente ("nota de 1 a 10" -> 1 a 10).
 * É o que o cliente lê, então vale mais que a escala configurada quando as
 * duas divergem (mensagem escrita à mão com "1 a 10" e escala ainda em 1 a 5).
 * Retorna null se o texto não cita uma escala válida (0 a 10, mínima < máxima).
 */
export const scaleFromMessage = (message: unknown): { min: number; max: number } | null => {
  if (typeof message !== "string") return null;
  const ranges = normalizeAnswer(message).matchAll(/(?<![\d:,.h])(\d{1,2})\s*(?:a|ate|ao|-|–)\s*(\d{1,2})(?![\d:h])/g);
  for (const range of ranges) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min >= 0 && max <= 10 && min < max) return { min, max };
  }
  return null;
};

/**
 * Resposta que é só uma nota ("8", "nota 8", "8/10"), ainda que fora da
 * escala. Não é pedido de atendimento: não reabre a conversa.
 */
export const isScoreAttempt = (raw: unknown): boolean => {
  if (typeof raw !== "string") return false;
  const match = normalizeAnswer(raw).match(SCORE_PATTERN);
  if (!match) return false;
  const value = wordToNumber(match[1]);
  return value !== undefined && value >= 0 && value <= 10;
};

/**
 * Interpreta a resposta do cliente como nota dentro da escala da pesquisa
 * (padrão 1 a 5). Aceita "5", "nota 4", "4 estrelas", "8/10", "8 de 10",
 * "cinco", "⭐⭐⭐". Nota fora da escala ou qualquer outro texto retorna null
 * (não é resposta da pesquisa).
 */
export const parseSurveyScore = (
  raw: unknown,
  scaleMin: number = DEFAULT_SCALE_MIN,
  scaleMax: number = DEFAULT_SCALE_MAX,
): number | null => {
  if (typeof raw !== "string") return null;

  const inScale = (n: number | undefined) =>
    n !== undefined && Number.isInteger(n) && n >= scaleMin && n <= scaleMax ? n : null;

  const stars = (raw.match(/⭐|★/g) ?? []).length;
  const withoutStars = raw.replace(/⭐|★/g, " ");
  if (stars >= 1 && (withoutStars.trim() === "" || isCourtesyReply(withoutStars))) {
    return inScale(stars);
  }

  const text = normalizeAnswer(raw);

  const match = text.match(SCORE_PATTERN);
  if (match) {
    // "8 de 10" só vale quando o 10 é o máximo da escala
    if (match[2] !== undefined && wordToNumber(match[2]) !== scaleMax) return null;
    return inScale(wordToNumber(match[1]));
  }

  // Nota acompanhada de agradecimento ou elogio: "5, obrigado!", "Nota: 10 👏",
  // "5️⃣ excelente atendimento". Vale quando há um único número e todo o resto
  // é cortesia; "5 consultas" ou "1 minuto" continuam fora. "um"/"uma" não
  // contam como número aqui ("obrigado, um ótimo dia").
  if (raw.includes("?")) return null;
  const words = wordsOf(text);
  if (words.length > 12) return null;
  const numbers = words.filter(
    (w) => /^\d{1,2}$/.test(w) || (w !== "um" && w !== "uma" && SCORE_WORDS[w] !== undefined),
  );
  if (numbers.length !== 1) return null;
  const others = words.filter((w) => w !== numbers[0]);
  if (!others.every((w) => isCourtesyWord(w) || SCORE_CONTEXT_WORDS.has(w))) return null;

  return inScale(wordToNumber(numbers[0]));
};

export type SurveySettings = {
  satisfaction_survey_enabled: boolean;
  satisfaction_survey_scale_min: number | null;
  satisfaction_survey_scale_max: number | null;
  satisfaction_survey_message: string;
  satisfaction_survey_thanks_message: string | null;
  satisfaction_survey_window_minutes: number;
};

export const getSurveySettings = async (admin, clinicId: string): Promise<SurveySettings | null> => {
  const { data, error } = await admin
    .from("conversation_automation_settings")
    .select(
      "satisfaction_survey_enabled, satisfaction_survey_message, satisfaction_survey_thanks_message, satisfaction_survey_window_minutes, satisfaction_survey_scale_min, satisfaction_survey_scale_max",
    )
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    console.error("[SURVEY] erro ao ler configurações:", error);
    return null;
  }
  return data ?? null;
};

/**
 * Envia texto automático ao cliente reaproveitando os senders internos
 * (WhatsApp oficial/Evolution via bot-sender-whatsapp; Instagram/Messenger via
 * bot-sender-meta). Retorna null em caso de sucesso ou a mensagem de erro.
 */
export const sendAutomatedText = async (params: {
  clinicId: string;
  conversationId: string;
  channelConnectionId: string;
  channel: string;
  text: string;
}): Promise<string | null> => {
  const fn = params.channel === "whatsapp" ? "bot-sender-whatsapp" : "bot-sender-meta";

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_BOT_SECRET,
        // bot-sender-meta é publicado com verify_jwt = true
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        clinicId: params.clinicId,
        conversationId: params.conversationId,
        channelConnectionId: params.channelConnectionId,
        type: "text",
        messageType: "text",
        text: params.text,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error(`[SURVEY] ${fn} falhou:`, resp.status, detail);
      return `${fn} ${resp.status}`;
    }
    return null;
  } catch (error) {
    console.error(`[SURVEY] erro chamando ${fn}:`, error);
    return error instanceof Error ? error.message : "send error";
  }
};

/**
 * Envia a pesquisa após o encerramento de uma conversa (se ativa na clínica).
 * Nunca lança erro: falhas ficam registradas com status "failed".
 */
export const sendSatisfactionSurvey = async (admin, conversationId: string) => {
  try {
    const { data: conversation, error } = await admin
      .from("conversations")
      .select("id, clinic_id, contact_id, channel, channel_connection_id, assigned_user_id, department_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (error || !conversation?.channel_connection_id) return;

    const settings = await getSurveySettings(admin, conversation.clinic_id);
    if (!settings?.satisfaction_survey_enabled) return;

    // Pesquisas anteriores ainda pendentes deste contato/canal deixam de valer
    await admin
      .from("satisfaction_surveys")
      .update({ status: "expired" })
      .eq("clinic_id", conversation.clinic_id)
      .eq("contact_id", conversation.contact_id)
      .eq("channel_connection_id", conversation.channel_connection_id)
      .eq("status", "sent");

    const sendError = await sendAutomatedText({
      clinicId: conversation.clinic_id,
      conversationId: conversation.id,
      channelConnectionId: conversation.channel_connection_id,
      channel: conversation.channel,
      text: settings.satisfaction_survey_message,
    });

    // A escala que vale é a que o cliente lê na mensagem
    const messageScale = scaleFromMessage(settings.satisfaction_survey_message);
    const scaleMin = messageScale?.min ?? settings.satisfaction_survey_scale_min ?? DEFAULT_SCALE_MIN;
    const scaleMax = messageScale?.max ?? settings.satisfaction_survey_scale_max ?? DEFAULT_SCALE_MAX;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + settings.satisfaction_survey_window_minutes * 60_000);

    await admin.from("satisfaction_surveys").insert({
      clinic_id: conversation.clinic_id,
      conversation_id: conversation.id,
      contact_id: conversation.contact_id,
      channel_connection_id: conversation.channel_connection_id,
      channel: conversation.channel,
      agent_user_id: conversation.assigned_user_id,
      department_id: conversation.department_id,
      scale_min: scaleMin,
      scale_max: scaleMax,
      status: sendError ? "failed" : "sent",
      error: sendError,
      sent_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    if (!sendError) {
      await admin.from("conversation_events").insert({
        conversation_id: conversation.id,
        event_type: "satisfaction_survey_sent",
        performed_by: null,
        metadata: { channel: conversation.channel },
      });
    }
  } catch (error) {
    console.error("[SURVEY] erro inesperado ao enviar pesquisa:", error);
  }
};

/**
 * Verifica se a mensagem recebida responde a uma pesquisa pendente.
 * - Nota válida: registra, envia agradecimento e retorna a pesquisa
 *   (o chamador grava a mensagem na conversa encerrada e NÃO a reabre).
 * - Nota dentro da escala que a mensagem da pesquisa pede, mesmo que a
 *   escala gravada seja outra: registra e corrige a escala da pesquisa.
 * - Só agradecimento/emoji ("Obrigado!", "👍") ou nota fora da escala ("8" em
 *   1 a 5): mantém a pesquisa pendente e retorna a pesquisa com score null (o
 *   chamador grava na conversa encerrada sem reabrir).
 * - Outro texto: marca a pesquisa como "skipped" e retorna null.
 */
export const matchSurveyAnswer = async (admin, params: {
  clinicId: string;
  contactId: string;
  channelConnectionId: string;
  text: unknown;
}) => {
  const { data: survey, error } = await admin
    .from("satisfaction_surveys")
    .select("id, conversation_id, channel, channel_connection_id, scale_min, scale_max")
    .eq("clinic_id", params.clinicId)
    .eq("contact_id", params.contactId)
    .eq("channel_connection_id", params.channelConnectionId)
    .eq("status", "sent")
    .gt("expires_at", new Date().toISOString())
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !survey) return null;

  let scaleMin = survey.scale_min ?? DEFAULT_SCALE_MIN;
  let scaleMax = survey.scale_max ?? DEFAULT_SCALE_MAX;
  let score = parseSurveyScore(params.text, scaleMin, scaleMax);
  let settings: SurveySettings | null | undefined;

  if (score === null) {
    // A mensagem enviada pede outra escala ("nota de 1 a 10" com a escala
    // gravada em 1 a 5): vale a escala que o cliente leu.
    settings = await getSurveySettings(admin, params.clinicId);
    const messageScale = scaleFromMessage(settings?.satisfaction_survey_message);
    if (messageScale && (messageScale.min !== scaleMin || messageScale.max !== scaleMax)) {
      score = parseSurveyScore(params.text, messageScale.min, messageScale.max);
      if (score !== null) {
        scaleMin = messageScale.min;
        scaleMax = messageScale.max;
      }
    }
  }

  if (score === null) {
    // "Obrigado!", "ok 👍" ou nota fora da escala: a pesquisa continua valendo
    // e a conversa não reabre
    if (isCourtesyReply(params.text) || isScoreAttempt(params.text)) {
      return { surveyId: survey.id, conversationId: survey.conversation_id, score: null };
    }
    await admin.from("satisfaction_surveys").update({ status: "skipped" }).eq("id", survey.id);
    return null;
  }

  // Atualização condicional evita registrar a nota duas vezes (webhooks duplicados)
  const { data: updated } = await admin
    .from("satisfaction_surveys")
    .update({
      status: "answered",
      score,
      scale_min: scaleMin,
      scale_max: scaleMax,
      raw_answer: String(params.text).slice(0, 500),
      answered_at: new Date().toISOString(),
    })
    .eq("id", survey.id)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();

  if (!updated) return null;

  await admin.from("conversation_events").insert({
    conversation_id: survey.conversation_id,
    event_type: "satisfaction_survey_answered",
    performed_by: null,
    metadata: { score, scale_min: scaleMin, scale_max: scaleMax },
  });

  if (settings === undefined) settings = await getSurveySettings(admin, params.clinicId);
  const thanks = settings?.satisfaction_survey_thanks_message?.trim();
  if (thanks) {
    await sendAutomatedText({
      clinicId: params.clinicId,
      conversationId: survey.conversation_id,
      channelConnectionId: survey.channel_connection_id,
      channel: survey.channel,
      text: thanks,
    });
  }

  return { surveyId: survey.id, conversationId: survey.conversation_id, score };
};
