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

export type ScheduledRecipient = {
  id: string;
  contactId: string | null;
  name: string | null;
  phone: string;
  status: ScheduledRecipientStatus;
  error: string | null;
  sentAt: string | null;
  conversationId: string | null;
};

export type ScheduledMessage = {
  id: string;
  clinicId: string;
  createdBy: string | null;
  message: string;
  scheduledAt: string;
  status: ScheduledMessageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Número de WhatsApp (QR Code) por onde sai; null = o conectado mais recente
  channelConnectionId: string | null;
  recipients: ScheduledRecipient[];
};

// Número de WhatsApp por QR Code que pode enviar programadas
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
  message: string;
  scheduledAt: Date;
  recipients: RecipientDraft[];
  channelConnectionId: string | null;
};

export type WalletContact = {
  id: string;
  name: string | null;
  phone: string;
};
