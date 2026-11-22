// Regras para editar uma mensagem enviada pelo atendente (edit-message).
// O app usa as mesmas regras em src/lib/messageEdit.ts para mostrar "Editar".

/** O WhatsApp só aceita editar até 15 minutos depois do envio. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
/** Limite de texto do WhatsApp. */
export const MAX_EDIT_TEXT_LENGTH = 4096;

/** Motivo para não editar, ou null se pode. */
export function editBlockReason(params: {
  direction: string | null;
  type: string | null;
  deletedAt: string | null;
  hasMedia: boolean;
  /** payload gravado no envio (resposta da Evolution, com .message) */
  payload?: any;
  sentAt: string | null;
  provider: string | null;
  now: number;
}): string | null {
  if (params.direction !== "outbound") return "Só dá para editar mensagens enviadas pela empresa.";
  if (params.deletedAt) return "A mensagem foi apagada.";
  if (params.provider !== "evolution") {
    return "Este canal não permite editar mensagens enviadas.";
  }
  if ((params.type ?? "text") !== "text" || params.hasMedia || !isPlainTextPayload(params.payload)) {
    return "Só dá para editar mensagens de texto.";
  }
  const sentAt = params.sentAt ? new Date(params.sentAt).getTime() : NaN;
  if (!Number.isFinite(sentAt) || params.now - sentAt > EDIT_WINDOW_MS) {
    return "O WhatsApp só permite editar até 15 minutos depois do envio.";
  }
  return null;
}

/** Localização e contato também ficam como texto no Unxet, mas não no WhatsApp. */
export function isPlainTextPayload(payload: any): boolean {
  const message = payload?.message;
  if (!message || typeof message !== "object") return true;
  const keys = Object.keys(message).filter((key) => key !== "messageContextInfo");
  return keys.length === 0 || keys.every((key) => key === "conversation" || key === "extendedTextMessage");
}
