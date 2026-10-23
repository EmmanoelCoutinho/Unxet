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
  departmentName?: string;
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
  // Mensagem exibida na prévia (para atualizá-la se for apagada)
  lastMessageId?: string;
  lastTimestamp: string;
  unreadCount: number;
  tags?: Tag[];
  assignedTo?: string;
  status: "open" | "pending" | "closed";
  // O bot ainda conduz a conversa: fica na aba "No bot", fora da fila
  inBotFlow?: boolean;
  provider?: "meta" | "evolution";
  // Número de WhatsApp da empresa por onde a conversa acontece
  connectionId?: string;
  connectionLabel?: string;
  // Última mensagem do cliente (janela de 24h do WhatsApp oficial)
  lastInboundAt?: string;
  // Cliente ainda aguarda a 1ª resposta e o prazo de SLA da clínica já passou
  slaBreached?: boolean;
};

/**
 * O SLA de 1ª resposta está estourado enquanto o cliente segue sem resposta
 * desde a mensagem que gerou a violação. Depois que alguém responde (o banco
 * zera first_unanswered_inbound_at) o alerta some; uma mensagem nova do
 * cliente não o traz de volta, porque o prazo vale só para a 1ª resposta.
 */
export const isSlaBreached = (row: {
  sla_breached_at?: string | null;
  first_unanswered_inbound_at?: string | null;
  status?: string | null;
}) => {
  if (!row.sla_breached_at || !row.first_unanswered_inbound_at) return false;
  if (row.status === "closed") return false;
  return (
    new Date(row.sla_breached_at).getTime() >=
    new Date(row.first_unanswered_inbound_at).getTime()
  );
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
    type: "text" | "image" | "audio" | "document" | "contact";
    text?: string;
    mediaUrl?: string;
    mediaMimeType?: string;
    filename?: string;
    fileSize?: number;
    contact?: { name: string; phone: string };
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
