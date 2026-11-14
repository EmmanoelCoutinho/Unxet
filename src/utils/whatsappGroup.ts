// Conversas de grupo do WhatsApp (QR Code).
//
// A conversa de grupo não tem contato (contact_id nulo): ela aponta para
// whatsapp_groups pelo group_id. Na tela, o grupo ocupa o lugar do contato
// (nome e foto) e as ações de contato (bloquear, funil, ficha) somem
// sozinhas, porque contactId fica vazio.

/** Trecho do select de conversations que traz o grupo. */
export const CONVERSATION_GROUP_SELECT = "whatsapp_groups:group_id (id, name, image_url)";

export const GROUP_FALLBACK_NAME = "Grupo do WhatsApp";

export type ConversationGroupRow = {
  id: string;
  name: string | null;
  image_url: string | null;
};

/** Grupo da linha de conversations (o embed pode vir como objeto ou lista). */
export function conversationGroupOf(row: unknown): ConversationGroupRow | null {
  const raw = (row as { whatsapp_groups?: unknown } | null)?.whatsapp_groups;
  const group = Array.isArray(raw) ? raw[0] : raw;
  if (!group || typeof group !== "object" || !(group as ConversationGroupRow).id) {
    return null;
  }
  return group as ConversationGroupRow;
}

/** Campos da Conversation que o grupo preenche no lugar do contato. */
export function groupConversationFields(group: ConversationGroupRow) {
  return {
    isGroup: true as const,
    groupId: group.id,
    contactId: undefined,
    contactBlocked: false,
    contactName: group.name?.trim() || GROUP_FALLBACK_NAME,
    contactNumber: "",
    contactAvatar: group.image_url ?? undefined,
  };
}
