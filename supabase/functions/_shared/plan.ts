// deno-lint-ignore-file
// @ts-nocheck
// Consultas ao plano da empresa (migração subscription_plans).
//
// Falha na consulta libera o recurso: o banco também trava o que importa
// (clinic_users, channel_connections, bots...) e um erro de leitura não pode
// derrubar o atendimento.

export type PlanFeature =
  | "social_channels"
  | "bots"
  | "departments"
  | "scheduled_messages"
  | "analytics"
  | "audio_transcription"
  | "internal_chat";

const callBoolean = async (admin, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    console.error(`[PLAN] erro em ${fn}:`, error.message ?? error);
    return true;
  }
  return data !== false;
};

export const clinicHasFeature = (admin, clinicId: string, feature: PlanFeature) =>
  callBoolean(admin, "clinic_has_feature", {
    p_clinic_id: clinicId,
    p_feature: feature,
  });

export const clinicCanAddAttendant = (admin, clinicId: string, email?: string | null) =>
  callBoolean(admin, "clinic_can_add_attendant", {
    p_clinic_id: clinicId,
    p_email: email ?? null,
  });

export const clinicCanUseWhatsappNumber = (
  admin,
  clinicId: string,
  connectionId?: string | null,
) =>
  callBoolean(admin, "clinic_can_use_whatsapp_number", {
    p_clinic_id: clinicId,
    p_connection_id: connectionId ?? null,
  });

export const PLAN_LIMIT_MESSAGES = {
  attendants:
    "A empresa atingiu o limite de atendentes do plano. Fale com a Unxet para mudar de plano.",
  whatsapp:
    "O plano da empresa permite apenas um número de WhatsApp em uso. Desconecte o outro número ou fale com a Unxet para mudar de plano.",
  departments:
    "Departamentos e transferências não fazem parte do plano da empresa.",
};

// Empresa suspensa: o app fica travado e os envios são recusados (as
// mensagens recebidas continuam entrando normalmente)
export const clinicIsSuspended = async (admin, clinicId: string) => {
  const { data, error } = await admin.rpc("clinic_is_suspended", {
    p_clinic_id: clinicId,
  });
  if (error) {
    console.error("[PLAN] erro em clinic_is_suspended:", error.message ?? error);
    return false;
  }
  return data === true;
};
