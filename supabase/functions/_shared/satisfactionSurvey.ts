// deno-lint-ignore-file
// @ts-nocheck
// Pesquisa de satisfação (CSAT 1 a 5): envio ao encerrar e captura da resposta.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";

const SCORE_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
};

/**
 * Interpreta a resposta do cliente como nota de 1 a 5.
 * Aceita "5", "nota 4", "4 estrelas", "cinco", "⭐⭐⭐". Qualquer outro texto
 * retorna null (não é resposta da pesquisa).
 */
export const parseSurveyScore = (raw: unknown): number | null => {
  if (typeof raw !== "string") return null;

  const stars = (raw.match(/⭐|★/g) ?? []).length;
  if (stars >= 1 && stars <= 5 && raw.replace(/⭐|★|\s/g, "") === "") {
    return stars;
  }

  const text = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

  const numeric = text.match(/^(?:nota\s*)?([1-5])(?:\s*(?:estrelas?|pontos?))?[\s.!]*$/);
  if (numeric) return Number(numeric[1]);

  const word = text.match(/^(?:nota\s*)?([a-z]+)[\s.!]*$/);
  if (word && SCORE_WORDS[word[1]]) return SCORE_WORDS[word[1]];

  return null;
};

export type SurveySettings = {
  satisfaction_survey_enabled: boolean;
  satisfaction_survey_message: string;
  satisfaction_survey_thanks_message: string | null;
  satisfaction_survey_window_minutes: number;
};

export const getSurveySettings = async (admin, clinicId: string): Promise<SurveySettings | null> => {
  const { data, error } = await admin
    .from("conversation_automation_settings")
    .select(
      "satisfaction_survey_enabled, satisfaction_survey_message, satisfaction_survey_thanks_message, satisfaction_survey_window_minutes",
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
    .select("id, conversation_id, channel, channel_connection_id")
    .eq("clinic_id", params.clinicId)
    .eq("contact_id", params.contactId)
    .eq("channel_connection_id", params.channelConnectionId)
    .eq("status", "sent")
    .gt("expires_at", new Date().toISOString())
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !survey) return null;

  const score = parseSurveyScore(params.text);
  if (!score) {
    await admin.from("satisfaction_surveys").update({ status: "skipped" }).eq("id", survey.id);
    return null;
  }

  // Atualização condicional evita registrar a nota duas vezes (webhooks duplicados)
  const { data: updated } = await admin
    .from("satisfaction_surveys")
    .update({
      status: "answered",
      score,
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
    metadata: { score },
  });

  const settings = await getSurveySettings(admin, params.clinicId);
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
