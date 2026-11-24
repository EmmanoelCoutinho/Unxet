// deno-lint-ignore-file
// @ts-nocheck
// Pesquisa de satisfação: envio ao encerrar e captura da resposta.
// A nota é sempre de 0 a 10 e a pesquisa não tem prazo: espera até o cliente
// mandar outra mensagem que não seja nota, até a próxima pesquisa, até a
// conversa reabrir ou até a empresa desligar a pesquisa (os dois últimos por
// gatilho no banco, migration 20261205000000).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";

export const DEFAULT_SCALE_MIN = 0;
export const DEFAULT_SCALE_MAX = 10;

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

// Nota fracionada ("9.9", "9,99", "3.5") vira a inteira mais próxima
// (10, 10, 4). Até 2 dígitos antes da vírgula e até 3 depois.
const roundDecimalScores = (text: string) =>
  text.replace(/(?<![\d.,])(\d{1,2})[.,](\d{1,3})(?![.,]?\d)/g, (_, int, frac) =>
    String(Math.round(Number(`${int}.${frac}`))),
  );

// Palavras de agradecimento/elogio que o cliente costuma mandar junto com a
// nota ("5, obrigado!") ou sozinhas depois do encerramento ("Obrigada 🙏").
// Sem prazo: enquanto a pesquisa espera, não reabrem a conversa.
const COURTESY_WORDS = new Set([
  "ok", "okay", "blz", "beleza", "certo", "certinho", "combinado", "entendi", "joia",
  "obrigado", "obrigada", "obrigados", "obrigadas", "obg", "brigado", "brigada",
  "grato", "grata", "gratidao", "valeu", "vlw", "tmj", "agradeco",
  "tchau", "ate", "mais", "logo", "amem", "deus", "abencoe", "abraco", "abracos", "igualmente",
  "top", "show", "legal", "perfeito", "perfeita", "otimo", "otima", "excelente",
  "maravilha", "maravilhoso", "maravilhosa", "amei", "adorei", "gostei",
  "parabens", "muito", "mto", "mt", "super",
  "nada", "pelo", "pela", "atendimento", "por", "voce", "vc", "voces", "vcs",
  "foi", "ta", "esta",
]);

// Cumprimento ("Bom dia", "Boa tarde, tudo bem"). Junto de agradecimento
// ("Obrigada, boa tarde") segue a regra do agradecimento. Sozinho, só não
// reabre logo depois do encerramento (COURTESY_WINDOW_MS): quem volta mais
// tarde com um "Bom dia" quer ser atendido.
const GREETING_WORDS = new Set(["bom", "boa", "dia", "tarde", "noite", "tudo", "bem"]);

// Só ligam as outras palavras ("obrigado e boa tarde", "boa tarde a você")
const FILLER_WORDS = new Set(["a", "o", "e", "de"]);

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

const isCourtesyWord = (word: string) =>
  COURTESY_WORDS.has(word) || GREETING_WORDS.has(word) || FILLER_WORDS.has(word) || /^(ok+|k{3,}|rs+)$/.test(word);

/**
 * Mensagem só de agradecimento, cumprimento ou emoji ("Obrigado!", "ok 👍",
 * "🙏", "Bom dia"). Enquanto a pesquisa espera a nota, ela fica na conversa
 * encerrada, sem reabrir o atendimento (cumprimento sozinho só por um tempo,
 * ver isGreetingOnly).
 */
export const isCourtesyReply = (raw: unknown): boolean => {
  if (typeof raw !== "string" || !raw.trim() || raw.includes("?")) return false;
  const words = wordsOf(normalizeAnswer(raw));
  if (words.length > 10) return false;
  return words.every(isCourtesyWord);
};

/**
 * Cumprimento sem agradecimento ("Bom dia", "Boa tarde!", "Boa noite, tudo
 * bem"). Só conta como cortesia até COURTESY_WINDOW_MS depois da pesquisa.
 */
export const isGreetingOnly = (raw: unknown): boolean => {
  if (!isCourtesyReply(raw)) return false;
  const words = wordsOf(normalizeAnswer(raw as string));
  return words.some((w) => GREETING_WORDS.has(w)) && words.every((w) => GREETING_WORDS.has(w) || FILLER_WORDS.has(w));
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
  const match = roundDecimalScores(normalizeAnswer(raw)).match(SCORE_PATTERN);
  if (!match) return false;
  const value = wordToNumber(match[1]);
  return value !== undefined && value >= 0 && value <= 10;
};

/**
 * Interpreta a resposta do cliente como nota dentro da escala da pesquisa
 * (padrão 0 a 10). Aceita "5", "nota 4", "4 estrelas", "8/10", "8 de 10",
 * "cinco", "⭐⭐⭐" e nota fracionada, arredondada ("9.9" -> 10, "3,5" -> 4).
 * Nota fora da escala ou qualquer outro texto retorna null (não é resposta
 * da pesquisa).
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

  const text = roundDecimalScores(normalizeAnswer(raw));

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
};

export const getSurveySettings = async (admin, clinicId: string): Promise<SurveySettings | null> => {
  const { data, error } = await admin
    .from("conversation_automation_settings")
    .select(
      "satisfaction_survey_enabled, satisfaction_survey_message, satisfaction_survey_thanks_message, satisfaction_survey_scale_min, satisfaction_survey_scale_max",
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
      .select("id, clinic_id, contact_id, group_id, channel, channel_connection_id, assigned_user_id, department_id")
      .eq("id", conversationId)
      .maybeSingle();

    // Grupo não recebe pesquisa (ela iria para todos os participantes)
    if (error || !conversation?.channel_connection_id || conversation.group_id || !conversation.contact_id) return;

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

    // A nota é sempre de 0 a 10. Texto antigo da empresa que ainda peça outra
    // escala ("de 1 a 5") vale pelo que o cliente lê, até ser corrigido.
    const messageScale = scaleFromMessage(settings.satisfaction_survey_message);
    const scaleMin = messageScale?.min ?? DEFAULT_SCALE_MIN;
    const scaleMax = messageScale?.max ?? DEFAULT_SCALE_MAX;

    const now = new Date();

    const { error: insertError } = await admin.from("satisfaction_surveys").insert({
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
    });
    if (insertError) console.error("[SURVEY] erro ao gravar a pesquisa enviada:", insertError);

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

// Reentregas do webhook chegam em segundos ou minutos (a fila tenta de novo)
const DUPLICATE_ANSWER_WINDOW_MS = 30 * 60_000;

// Cumprimento sozinho ("Bom dia", "Boa tarde") só fica na conversa encerrada
// enquanto o atendimento é recente. A pesquisa não tem prazo, mas o cliente
// que volta depois disso com um "Bom dia" quer ser atendido. Agradecimento
// ("Obrigado!") não tem prazo.
export const COURTESY_WINDOW_MS = 2 * 60 * 60_000;

/**
 * A mesma resposta entregue duas vezes (webhook duplicado ou reenviado pela
 * fila): a primeira entrega já registrou a nota, então a segunda não encontra
 * pesquisa pendente. Sem isto ela seguia como mensagem comum e reabria a
 * conversa encerrada. Retorna a pesquisa já respondida com duplicate: true.
 */
const findDuplicateAnswer = async (admin, params: {
  clinicId: string;
  contactId: string;
  channelConnectionId: string;
  text: unknown;
}) => {
  if (typeof params.text !== "string" || !params.text.trim()) return null;

  const { data: answered, error } = await admin
    .from("satisfaction_surveys")
    .select("id, conversation_id, score, raw_answer")
    .eq("clinic_id", params.clinicId)
    .eq("contact_id", params.contactId)
    .eq("channel_connection_id", params.channelConnectionId)
    .eq("status", "answered")
    .gt("answered_at", new Date(Date.now() - DUPLICATE_ANSWER_WINDOW_MS).toISOString())
    .order("answered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) console.error("[SURVEY] erro ao buscar resposta repetida:", error);
  if (!answered || answered.raw_answer !== params.text.slice(0, 500)) return null;

  return {
    surveyId: answered.id,
    conversationId: answered.conversation_id,
    score: answered.score,
    duplicate: true,
  };
};

/**
 * Verifica se a mensagem recebida responde a uma pesquisa pendente.
 * - Nota válida: registra, envia agradecimento e retorna a pesquisa
 *   (o chamador grava a mensagem na conversa encerrada e NÃO a reabre).
 * - Nota dentro da escala que a mensagem da pesquisa pede, mesmo que a
 *   escala gravada seja outra: registra e corrige a escala da pesquisa.
 * - Só agradecimento/emoji ("Obrigado!", "👍"), cumprimento ("Bom dia") até 2
 *   horas depois do envio, ou nota fora da escala ("8" em 1 a 5): mantém a
 *   pesquisa pendente e retorna a pesquisa com score null (o chamador grava
 *   na conversa encerrada sem reabrir). Depois das 2 horas, cumprimento
 *   sozinho é mensagem comum.
 * - Mesma nota entregue de novo (webhook duplicado): retorna a pesquisa já
 *   respondida com duplicate: true, sem registrar nem agradecer outra vez.
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
    .select("id, conversation_id, channel, channel_connection_id, scale_min, scale_max, sent_at")
    .eq("clinic_id", params.clinicId)
    .eq("contact_id", params.contactId)
    .eq("channel_connection_id", params.channelConnectionId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) console.error("[SURVEY] erro ao buscar pesquisa pendente:", error);
  // Sem pesquisa pendente: pode ser a mesma resposta entregue de novo
  if (error || !survey) return findDuplicateAnswer(admin, params);

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
    // "Obrigado!", "ok 👍", "Bom dia" logo depois do encerramento ou nota fora
    // da escala: a pesquisa continua valendo e a conversa não reabre
    const sentAt = Date.parse(survey.sent_at ?? "");
    const greetingStillCounts = Number.isFinite(sentAt) && Date.now() - sentAt <= COURTESY_WINDOW_MS;
    const courtesy =
      isCourtesyReply(params.text) && (greetingStillCounts || !isGreetingOnly(params.text));
    if (courtesy || isScoreAttempt(params.text)) {
      return { surveyId: survey.id, conversationId: survey.conversation_id, score: null };
    }
    await admin.from("satisfaction_surveys").update({ status: "skipped" }).eq("id", survey.id);
    return null;
  }

  // Atualização condicional evita registrar a nota duas vezes (webhooks duplicados)
  const { data: updated, error: updateError } = await admin
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

  if (updateError) {
    // A resposta é uma nota válida: mesmo sem conseguir gravar, não reabre
    console.error("[SURVEY] erro ao registrar a nota:", updateError);
    return { surveyId: survey.id, conversationId: survey.conversation_id, score: null };
  }

  // Outra entrega da mesma mensagem registrou a nota primeiro
  if (!updated) return findDuplicateAnswer(admin, params);

  await admin.from("conversation_events").insert({
    conversation_id: survey.conversation_id,
    event_type: "satisfaction_survey_answered",
    performed_by: null,
    metadata: { score, scale_min: scaleMin, scale_max: scaleMax },
  });

  if (settings === undefined) settings = await getSurveySettings(admin, params.clinicId);
  const thanks = settings?.satisfaction_survey_thanks_message?.trim();
  if (thanks) {
    // Em segundo plano: a resposta do cliente é gravada na conversa sem esperar
    // o envio (uma reentrega nesse intervalo reabria a conversa)
    const thanksTask = sendAutomatedText({
      clinicId: params.clinicId,
      conversationId: survey.conversation_id,
      channelConnectionId: survey.channel_connection_id,
      channel: survey.channel,
      text: thanks,
    });
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(thanksTask);
    } else {
      await thanksTask;
    }
  }

  return { surveyId: survey.id, conversationId: survey.conversation_id, score };
};
