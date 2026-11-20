// Quando o atendente pode editar uma mensagem enviada. Mesmas regras de
// supabase/functions/_shared/outboundEdit.ts (a edge function confere de novo).
import type { Message } from "../types";

/** O WhatsApp só aceita editar até 15 minutos depois do envio. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_EDIT_TEXT_LENGTH = 4096;

/** Localização e contato também ficam como texto no Unxet, mas não no WhatsApp. */
function isPlainTextPayload(payload: unknown): boolean {
  const message = (payload as { message?: unknown } | null | undefined)?.message;
  if (!message || typeof message !== "object") return true;
  const keys = Object.keys(message).filter((key) => key !== "messageContextInfo");
  return (
    keys.length === 0 ||
    keys.every((key) => key === "conversation" || key === "extendedTextMessage")
  );
}

export function canEditMessage(
  message: Pick<
    Message,
    "id" | "direction" | "type" | "deletedAt" | "mediaUrl" | "payload" | "createdAt" | "senderUserId"
  >,
  opts: { provider?: string | null; currentUserId?: string | null; now: number },
): boolean {
  if (message.direction !== "outbound" || message.deletedAt) return false;
  if (message.id.startsWith("local-")) return false;
  if (opts.provider !== "evolution") return false;
  if (!opts.currentUserId || message.senderUserId !== opts.currentUserId) return false;
  if ((message.type ?? "text") !== "text" || message.mediaUrl) return false;
  if (!isPlainTextPayload(message.payload)) return false;
  const sentAt = new Date(message.createdAt).getTime();
  return Number.isFinite(sentAt) && opts.now - sentAt <= EDIT_WINDOW_MS;
}
