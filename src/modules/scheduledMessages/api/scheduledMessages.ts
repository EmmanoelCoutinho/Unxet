import { supabase } from "../../../lib/supabaseClient";
import { whatsappConnectionLabel } from "../../../lib/whatsappConnections";
import type {
  CampaignSummary,
  CampaignTag,
  ConversationCampaign,
  QrWhatsappNumber,
  SaveScheduledMessageInput,
  ScheduledMessage,
  ScheduledRecipient,
  WalletContact,
} from "../types/scheduledMessages";

type RecipientRow = {
  id: string;
  position: number;
  contact_id: string | null;
  name: string | null;
  phone: string;
  status: ScheduledRecipient["status"];
  error: string | null;
  failure_kind: ScheduledRecipient["failureKind"];
  sent_at: string | null;
  conversation_id: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  converted_at: string | null;
  converted_via: ScheduledRecipient["convertedVia"];
  conversion_value: number | string | null;
};

type CampaignBaseRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  name: string | null;
  message: string;
  scheduled_at: string;
  status: ScheduledMessage["status"];
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  channel_connection_id: string | null;
  conversion_tag_id: string | null;
  reply_window_days: number | null;
};

type ScheduledMessageRow = CampaignBaseRow & {
  recipients: RecipientRow[] | null;
};

type SummaryRow = CampaignBaseRow & {
  total_count: number;
  sent_count: number;
  failed_count: number;
  waiting_count: number;
  cancelled_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  converted_count: number;
  conversion_revenue: number | string | null;
  preview_names: string[] | null;
};

const BASE_COLUMNS =
  "id, clinic_id, created_by, name, message, scheduled_at, status, started_at, finished_at, created_at, updated_at, channel_connection_id, conversion_tag_id, reply_window_days";

const SELECT =
  `${BASE_COLUMNS}, ` +
  "recipients:scheduled_message_recipients(id, position, contact_id, name, phone, status, error, failure_kind, sent_at, conversation_id, delivered_at, read_at, replied_at, converted_at, converted_via, conversion_value)";

const SUMMARY_SELECT =
  `${BASE_COLUMNS}, total_count, sent_count, failed_count, waiting_count, cancelled_count, ` +
  "delivered_count, read_count, replied_count, converted_count, conversion_revenue, preview_names";

const LIST_LIMIT = 200;

// numeric chega como texto pelo PostgREST
const toNumber = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapBase = (row: CampaignBaseRow) => ({
  id: row.id,
  clinicId: row.clinic_id,
  createdBy: row.created_by,
  name: row.name ?? null,
  message: row.message,
  scheduledAt: row.scheduled_at,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  channelConnectionId: row.channel_connection_id ?? null,
  conversionTagId: row.conversion_tag_id ?? null,
  replyWindowDays: row.reply_window_days ?? 7,
});

const mapRow = (row: ScheduledMessageRow): ScheduledMessage => ({
  ...mapBase(row),
  recipients: [...(row.recipients ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      id: r.id,
      contactId: r.contact_id,
      name: r.name,
      phone: r.phone,
      status: r.status,
      error: r.error,
      failureKind: r.failure_kind ?? null,
      sentAt: r.sent_at,
      conversationId: r.conversation_id,
      deliveredAt: r.delivered_at ?? null,
      readAt: r.read_at ?? null,
      repliedAt: r.replied_at ?? null,
      convertedAt: r.converted_at ?? null,
      convertedVia: r.converted_via ?? null,
      conversionValue: toNumber(r.conversion_value),
    })),
});

const mapSummary = (row: SummaryRow): CampaignSummary => ({
  ...mapBase(row),
  stats: {
    total: row.total_count ?? 0,
    sent: row.sent_count ?? 0,
    failed: row.failed_count ?? 0,
    waiting: row.waiting_count ?? 0,
    cancelled: row.cancelled_count ?? 0,
    delivered: row.delivered_count ?? 0,
    read: row.read_count ?? 0,
    replied: row.replied_count ?? 0,
    converted: row.converted_count ?? 0,
    revenue: toNumber(row.conversion_revenue) ?? 0,
  },
  previewNames: row.preview_names ?? [],
});

// Remove caracteres com significado na sintaxe de filtros do PostgREST
const sanitizeSearch = (value: string) =>
  value.replace(/[,()"'\\%*]/g, " ").trim();

// O RLS já limita a quem criou (ou a todas, para o admin)
export const listCampaignSummaries = async (
  clinicId: string | null,
): Promise<CampaignSummary[]> => {
  if (!clinicId) return [];

  const { data, error } = await supabase
    .from("scheduled_message_summaries")
    .select(SUMMARY_SELECT)
    .eq("clinic_id", clinicId)
    // Mensagens agendadas pelo cartão do funil ficam só no cartão
    .is("deal_id", null)
    .order("scheduled_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) throw error;

  return ((data ?? []) as unknown as SummaryRow[]).map(mapSummary);
};

export const getScheduledMessage = async (
  id: string,
): Promise<ScheduledMessage | null> => {
  const { data, error } = await supabase
    .from("scheduled_messages")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data ? mapRow(data as unknown as ScheduledMessageRow) : null;
};

export const saveScheduledMessage = async (
  input: SaveScheduledMessageInput,
): Promise<string> => {
  const { data, error } = await supabase.rpc("scheduled_message_save", {
    p_id: input.id,
    p_message: input.message.trim(),
    p_scheduled_at:
      input.sendNow || !input.scheduledAt ? null : input.scheduledAt.toISOString(),
    p_recipients: input.recipients.map((recipient) =>
      recipient.contactId
        ? { contact_id: recipient.contactId }
        : { phone: recipient.phone, name: recipient.name },
    ),
    p_channel_connection_id: input.channelConnectionId,
    p_name: input.name.trim() || null,
    p_send_now: input.sendNow,
    p_conversion_tag_id: input.conversionTagId,
    p_reply_window_days: input.replyWindowDays,
  });

  if (error) throw error;

  return data as string;
};

export const cancelScheduledMessage = async (id: string) => {
  const { error } = await supabase.rpc("scheduled_message_cancel", { p_id: id });
  if (error) throw error;
};

// Quem não recebeu (falha segura ou cancelado) volta para a fila; devolve quantos
export const retryCampaign = async (id: string): Promise<number> => {
  const { data, error } = await supabase.rpc("campaign_retry", { p_id: id });
  if (error) throw error;
  return (data as number) ?? 0;
};

export const deleteScheduledMessage = async (id: string) => {
  const { error } = await supabase.rpc("scheduled_message_delete", { p_id: id });
  if (error) throw error;
};

export const searchWalletContacts = async (
  clinicId: string | null,
  search: string,
): Promise<WalletContact[]> => {
  if (!clinicId) return [];

  let query = supabase
    .from("contacts")
    .select("id, name, phone")
    .eq("clinic_id", clinicId)
    .not("phone", "is", null)
    .order("name", { ascending: true })
    .limit(30);

  const term = sanitizeSearch(search);
  if (term) {
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as WalletContact[];
};

// Clientes da carteira com alguma das etiquetas (lista vazia = todos)
export const fetchCampaignAudience = async (
  tagIds: string[],
): Promise<WalletContact[]> => {
  const { data, error } = await supabase.rpc("campaign_audience", {
    p_tag_ids: tagIds.length > 0 ? tagIds : null,
  });

  if (error) throw error;

  return (data ?? []) as WalletContact[];
};

export const listCampaignTags = async (
  clinicId: string | null,
): Promise<CampaignTag[]> => {
  if (!clinicId) return [];

  const { data, error } = await supabase
    .from("tags")
    .select("id, name, color")
    .eq("clinic_id", clinicId)
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []) as CampaignTag[];
};

// As campanhas saem pelo WhatsApp conectado por QR Code (Evolution)
export const hasConnectedQrWhatsapp = async (
  clinicId: string | null,
): Promise<boolean> => {
  if (!clinicId) return true;

  const { data, error } = await supabase
    .from("channel_connections")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("provider", "evolution")
    .eq("channel", "whatsapp")
    .eq("status", "connected")
    .limit(1);

  if (error) throw error;

  return (data ?? []).length > 0;
};

// Números QR Code da empresa (os removidos ficam de fora)
export const listQrWhatsappNumbers = async (
  clinicId: string | null,
): Promise<QrWhatsappNumber[]> => {
  if (!clinicId) return [];

  const { data, error } = await supabase
    .from("channel_connections")
    .select("id, status, display_name, connected_phone, connected_name")
    .eq("clinic_id", clinicId)
    .eq("provider", "evolution")
    .eq("channel", "whatsapp")
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id as string,
    label: whatsappConnectionLabel(row),
    connected: row.status === "connected",
  }));
};

type ConversationCampaignRow = {
  recipient_id: string;
  campaign_id: string;
  campaign_name: string | null;
  campaign_message: string;
  sent_at: string;
  replied_at: string | null;
  converted_at: string | null;
  converted_via: ConversationCampaign["convertedVia"];
  conversion_value: number | string | null;
  conversion_tag_id: string | null;
};

// Campanha mais recente que chegou nesta conversa e ainda está no prazo
export const getConversationCampaign = async (
  conversationId: string,
): Promise<ConversationCampaign | null> => {
  const { data, error } = await supabase.rpc("campaign_for_conversation", {
    p_conversation_id: conversationId,
  });

  if (error) throw error;

  const row = ((data ?? []) as ConversationCampaignRow[])[0];
  if (!row) return null;

  return {
    recipientId: row.recipient_id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    campaignMessage: row.campaign_message,
    sentAt: row.sent_at,
    repliedAt: row.replied_at,
    convertedAt: row.converted_at,
    convertedVia: row.converted_via,
    conversionValue: toNumber(row.conversion_value),
    conversionTagId: row.conversion_tag_id,
  };
};

export const setCampaignConversion = async (params: {
  recipientId: string;
  converted: boolean;
  value: number | null;
}) => {
  const { error } = await supabase.rpc("campaign_set_conversion", {
    p_recipient_id: params.recipientId,
    p_converted: params.converted,
    p_value: params.value,
  });
  if (error) throw error;
};
