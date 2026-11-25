export type InternalThreadKind = "general" | "direct";

export type InternalThread = {
  id: string;
  kind: InternalThreadKind;
  // Só nas conversas diretas: a outra pessoa
  otherUserId: string | null;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  lastMessageSenderId: string | null;
  unreadCount: number;
};

export type InternalAttachmentKind = "image" | "audio" | "file" | "sticker";

export type InternalAttachment = {
  kind: InternalAttachmentKind;
  /** Caminho no bucket whatsapp-media (<empresa>/internal-chat/<conversa>/... ou figurinha). */
  path: string;
  name: string | null;
  mime: string | null;
  size: number | null;
  /** Só no envio: arquivo local exibido enquanto sobe. */
  localUrl?: string;
};

export type InternalMessage = {
  id: string;
  threadId: string;
  // null quando o autor foi removido da clínica
  senderId: string | null;
  body: string;
  attachment: InternalAttachment | null;
  createdAt: string;
  // Estado local do envio (mensagens ainda não confirmadas pelo servidor)
  pending?: boolean;
  failed?: boolean;
};

export type InternalMessagesPage = {
  messages: InternalMessage[];
  hasMore: boolean;
};

export type TeamMember = {
  userId: string;
  name: string;
  role: string;
};
