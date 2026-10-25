// "Campanha" na tela; no banco continua sendo scheduled_messages
export type ScheduledMessageStatus =
  | "scheduled"
  | "processing"
  | "sent"
  | "partial"
  | "failed"
  | "cancelled";

export type ScheduledRecipientStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type ConversionVia = "button" | "tag";

// Só em falhas: retryable = não saiu, dá para tentar de novo; permanent =
// número sem WhatsApp; uncertain = pode ter chegado (conferir a conversa)
export type FailureKind = "retryable" | "permanent" | "uncertain";

export type ScheduledRecipient = {
  id: string;
  contactId: string | null;
  name: string | null;
  phone: string;
  status: ScheduledRecipientStatus;
  error: string | null;
  failureKind: FailureKind | null;
  sentAt: string | null;
  conversationId: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  repliedAt: string | null;
  convertedAt: string | null;
  convertedVia: ConversionVia | null;
  conversionValue: number | null;
};

export type ScheduledMessage = {
  id: string;
  clinicId: string;
  createdBy: string | null;
  // Programações antigas não têm nome
  name: string | null;
  message: string;
  scheduledAt: string;
  status: ScheduledMessageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Número de WhatsApp (QR Code) por onde sai; null = o conectado mais recente
  channelConnectionId: string | null;
  // Etiqueta que, colocada na conversa, conta como adesão
  conversionTagId: string | null;
  // Dias depois do envio em que resposta e adesão contam para a campanha
  replyWindowDays: number;
  recipients: ScheduledRecipient[];
};

// Números do funil de uma campanha
export type CampaignStats = {
  total: number;
  sent: number;
  failed: number;
  waiting: number;
  cancelled: number;
  delivered: number;
  read: number;
  replied: number;
  converted: number;
  revenue: number;
};

// Linha da lista: a campanha sem os destinatários, com os números já somados
export type CampaignSummary = Omit<ScheduledMessage, "recipients"> & {
  stats: CampaignStats;
  previewNames: string[];
};

// Número de WhatsApp por QR Code que pode enviar campanhas
export type QrWhatsappNumber = {
  id: string;
  label: string;
  connected: boolean;
};

// Destinatário ainda no formulário: cliente da carteira ou número digitado
export type RecipientDraft = {
  contactId: string | null;
  name: string | null;
  phone: string;
};

export type SaveScheduledMessageInput = {
  id: string | null;
  name: string;
  message: string;
  // Ignorado quando sendNow é true
  scheduledAt: Date | null;
  sendNow: boolean;
  recipients: RecipientDraft[];
  channelConnectionId: string | null;
  conversionTagId: string | null;
  replyWindowDays: number;
};

export type WalletContact = {
  id: string;
  name: string | null;
  phone: string;
};

export type CampaignTag = {
  id: string;
  name: string;
  color: string | null;
};

// Campanha de onde veio uma conversa (faixa no chat)
export type ConversationCampaign = {
  recipientId: string;
  campaignId: string;
  campaignName: string | null;
  campaignMessage: string;
  sentAt: string;
  repliedAt: string | null;
  convertedAt: string | null;
  convertedVia: ConversionVia | null;
  conversionValue: number | null;
  conversionTagId: string | null;
};
