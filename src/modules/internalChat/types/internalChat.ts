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

export type InternalMessage = {
  id: string;
  threadId: string;
  // null quando o autor foi removido da clínica
  senderId: string | null;
  body: string;
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
