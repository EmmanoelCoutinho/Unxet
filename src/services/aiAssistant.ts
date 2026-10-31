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
};

export const AI_SETTINGS_LIMITS = {
  assistant_name: 60,
  business_info: 20000,
  faq: 30000,
  rules: 10000,
} as const;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  assistant_name: "Assistente",
  tone: "friendly",
  use_emojis: false,
  business_info: "",
  faq: "",
  rules: "",
};

const SETTINGS_COLUMNS =
  "assistant_name, tone, use_emojis, business_info, faq, rules";

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
    const { error } = await supabase.from("clinic_ai_settings").upsert(
      {
        clinic_id: clinicId,
        assistant_name: settings.assistant_name.trim() || "Assistente",
        tone: settings.tone,
        use_emojis: settings.use_emojis,
        business_info: settings.business_info.trim(),
        faq: settings.faq.trim(),
        rules: settings.rules.trim(),
        updated_at: new Date().toISOString(),
        updated_by: userId,
      },
      { onConflict: "clinic_id" },
    );
    if (error) throw toError(error);
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
