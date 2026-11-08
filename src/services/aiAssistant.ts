import { supabase } from "../lib/supabaseClient";

// Configuração da IA que a empresa edita (camada 2). As instruções sob medida
// ficam no banco mas só a Unxet lê e escreve (painel).
export type AiTone = "friendly" | "formal";

export type AiSettings = {
  assistant_name: string;
  tone: AiTone;
  use_emojis: boolean;
  business_info: string;
  faq: string;
  rules: string;
  /** Respostas da IA para o mesmo cliente num atendimento */
  max_replies_per_conversation: number;
};

export const AI_SETTINGS_LIMITS = {
  assistant_name: 60,
  business_info: 20000,
  faq: 30000,
  rules: 10000,
  // Mesma regra do banco (clinic_ai_settings)
  max_replies_min: 1,
  max_replies_max: 200,
} as const;

export const isValidMaxReplies = (value: number) =>
  Number.isInteger(value) &&
  value >= AI_SETTINGS_LIMITS.max_replies_min &&
  value <= AI_SETTINGS_LIMITS.max_replies_max;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  assistant_name: "Assistente",
  tone: "friendly",
  use_emojis: false,
  business_info: "",
  faq: "",
  rules: "",
  max_replies_per_conversation: 20,
};

const SETTINGS_COLUMNS =
  "assistant_name, tone, use_emojis, business_info, faq, rules, max_replies_per_conversation";

// Mês de consumo no horário de Brasília (o mesmo do banco), "AAAA-MM-01"
export const currentAiMonth = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}-01`;
};

export { aiUsageLevel, aiWarningThreshold, type AiUsageLevel } from "../lib/aiUsage";

const toError = (error: { message?: string } | null) =>
  new Error(error?.message || "Não foi possível concluir a operação.");

export const aiAssistantService = {
  async getSettings(clinicId: string): Promise<AiSettings> {
    const { data, error } = await supabase
      .from("clinic_ai_settings")
      .select(SETTINGS_COLUMNS)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (error) throw toError(error);
    return data ? { ...DEFAULT_AI_SETTINGS, ...(data as AiSettings) } : DEFAULT_AI_SETTINGS;
  },

  async saveSettings(
    clinicId: string,
    settings: AiSettings,
    userId: string | null,
  ): Promise<void> {
    const values = {
      assistant_name: settings.assistant_name.trim() || "Assistente",
      tone: settings.tone,
      use_emojis: settings.use_emojis,
      business_info: settings.business_info.trim(),
      faq: settings.faq.trim(),
      rules: settings.rules.trim(),
      max_replies_per_conversation: settings.max_replies_per_conversation,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };

    // Sem upsert: o ON CONFLICT DO UPDATE regrava o clinic_id, e a empresa
    // não tem permissão de alterar essa coluna. Atualiza e, se a empresa
    // ainda não tem configuração, insere.
    const { data: updated, error: updateError } = await supabase
      .from("clinic_ai_settings")
      .update(values)
      .eq("clinic_id", clinicId)
      .select("clinic_id");
    if (updateError) throw toError(updateError);
    if (updated && updated.length > 0) return;

    const { error: insertError } = await supabase
      .from("clinic_ai_settings")
      .insert({ clinic_id: clinicId, ...values });
    if (insertError) throw toError(insertError);
  },

  // Respostas da IA usadas no mês atual
  async getRepliesThisMonth(clinicId: string): Promise<number> {
    const { data, error } = await supabase
      .from("clinic_ai_usage")
      .select("replies")
      .eq("clinic_id", clinicId)
      .eq("month", currentAiMonth())
      .maybeSingle();
    if (error) throw toError(error);
    return (data as { replies?: number } | null)?.replies ?? 0;
  },
};
