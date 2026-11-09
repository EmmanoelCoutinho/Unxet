// Texto para o atendente quando o envio de uma mensagem falha. As edge
// functions de envio devolvem o motivo no corpo; aqui ele vira uma frase
// clara em vez do genérico "Não foi possível enviar".

export const GENERIC_SEND_ERROR = "Não foi possível enviar a mensagem.";

const BY_REASON: Record<string, string> = {
  number_removed:
    "O número de WhatsApp desta conversa foi removido da empresa. Não é possível responder por aqui.",
  rate_limited:
    "Muitas mensagens em pouco tempo nesta conversa. Aguarde um minuto e tente de novo.",
  "Not allowed":
    "Você não pode responder esta conversa: ela está com outro atendente.",
  assigned_not_owner:
    "Você não pode responder esta conversa: ela está com outro atendente.",
  not_in_department:
    "Você não pode responder esta conversa: ela é de outro setor.",
  not_dept_member:
    "Você não pode responder esta conversa: ela é de outro setor.",
  clinic_suspended: "O acesso da empresa está suspenso.",
};

/**
 * `status` é o HTTP da função; `payload` o corpo JSON (pode faltar).
 * Erro 5xx e motivos técnicos ficam com o texto genérico.
 */
export function sendErrorMessage(
  status: number | null | undefined,
  payload: { error?: unknown; code?: unknown; reason?: unknown } | null | undefined,
): string {
  if (status === 429) return BY_REASON.rate_limited;
  if (!payload) return GENERIC_SEND_ERROR;

  for (const key of [payload.code, payload.reason, payload.error]) {
    if (typeof key === "string" && BY_REASON[key]) return BY_REASON[key];
  }

  // Frase já pensada para o atendente (português, com espaço): mostra como veio
  const text = typeof payload.error === "string" ? payload.error.trim() : "";
  if (status && status < 500 && /\s/.test(text) && /[à-úÀ-Ú]|ç|ã|é|ó/.test(text)) {
    return text;
  }
  return GENERIC_SEND_ERROR;
}
