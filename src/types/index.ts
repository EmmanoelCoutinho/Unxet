export type Channel = "whatsapp" | "instagram" | "messenger";

export type Tag = {
  id: string;
  name: string;
  color: string;
  clinicId?: string;
  createdAt?: string;
};

export type QuickMessage = {
  id: string;
  clinicId: string;
  message: string;
  createdAt?: string;
  updatedAt?: string;
};

export type MessageDirection = "inbound" | "outbound";

export type MessageSendStatus = "sending" | "failed" | "sent";
export type TranscriptStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";
// Ticks do WhatsApp para mensagens enviadas: ✓ enviada, ✓✓ entregue, ✓✓ verde lida
export type MessageDeliveryStatus = "sent" | "delivered" | "read";

export type Conversation = {
  id: string;
  clinicId?: string;
  departmentId?: string;
  channel: Channel;
  contactName: string;
  contactNumber?: string;
  contactAvatar?: string;
  lastMessage: string;
  lastMessageType?:
    | "text"
    | "image"
    | "audio"
    | "sticker"
    | "video"
    | "document"
    | "other";
  lastTimestamp: string;
  unreadCount: number;
  tags?: Tag[];
  assignedTo?: string;
  status: "open" | "pending" | "closed";
  provider?: "meta" | "evolution";
  // Última mensagem do cliente (janela de 24h do WhatsApp oficial)
  lastInboundAt?: string;
};
export type Message = {
  id: string;
  conversationId: string;
  author: "cliente" | "atendente";
  text?: string;
  type?: string;
  mediaUrl?: string;
  image_url?: string;
  direction?: MessageDirection;
  mediaMimeType?: string;
  filename?: string;
  fileSize?: number;
  payload?: any;
  caption?: string;
  transcriptStatus?: TranscriptStatus;
  transcriptText?: string;
  deletedAt?: string;
  deletedForEveryone?: boolean;
  deliveryStatus?: MessageDeliveryStatus;
  createdAt: string;

  localStatus?: MessageSendStatus;
  localError?: string | null;
  localPayload?: {
    type: "text" | "image" | "audio" | "document";
    text?: string;
    mediaUrl?: string;
    mediaMimeType?: string;
    filename?: string;
    fileSize?: number;
  };
};

export type ConversationEvent = {
  id: string;
  conversationId: string;
  type: string;
  createdAt: string;
  performedBy?: string | null;
  performedByName?: string | null;
  metadata?: Record<string, any> | null;
};
export type Metrics = {
  avgFirstResponseMin: number;
  avgResolutionMin: number;
  totalConversations: number;
  conversionRate: number;
  perAgent: Array<{
    agent: string;
    firstResponseMin: number;
    count: number;
    conversionRate: number;
  }>;
};
export type User = {
  id: string;
  name: string;
  email: string;
  role: "Atendente" | "Gestor";
  avatar?: string;
};
