import { supabase } from "../../../lib/supabaseClient";
import type {
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
  sent_at: string | null;
  conversation_id: string | null;
};

type ScheduledMessageRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  message: string;
  scheduled_at: string;
  status: ScheduledMessage["status"];
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  recipients: RecipientRow[] | null;
};

const SELECT =
  "id, clinic_id, created_by, message, scheduled_at, status, started_at, finished_at, created_at, updated_at, " +
  "recipients:scheduled_message_recipients(id, position, contact_id, name, phone, status, error, sent_at, conversation_id)";

const LIST_LIMIT = 200;

const mapRow = (row: ScheduledMessageRow): ScheduledMessage => ({
  id: row.id,
  clinicId: row.clinic_id,
  createdBy: row.created_by,
  message: row.message,
  scheduledAt: row.scheduled_at,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  recipients: [...(row.recipients ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      id: r.id,
      contactId: r.contact_id,
      name: r.name,
      phone: r.phone,
      status: r.status,
      error: r.error,
      sentAt: r.sent_at,
      conversationId: r.conversation_id,
    })),
});

// Remove caracteres com significado na sintaxe de filtros do PostgREST
const sanitizeSearch = (value: string) =>
  value.replace(/[,()"'\\%*]/g, " ").trim();

// O RLS já limita a quem criou (ou a todas, para o admin)
export const listScheduledMessages = async (
  clinicId: string | null,
): Promise<ScheduledMessage[]> => {
  if (!clinicId) return [];

  const { data, error } = await supabase
    .from("scheduled_messages")
    .select(SELECT)
    .eq("clinic_id", clinicId)
    .order("scheduled_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) throw error;

  return ((data ?? []) as unknown as ScheduledMessageRow[]).map(mapRow);
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
    p_scheduled_at: input.scheduledAt.toISOString(),
    p_recipients: input.recipients.map((recipient) =>
      recipient.contactId
        ? { contact_id: recipient.contactId }
        : { phone: recipient.phone, name: recipient.name },
    ),
  });

  if (error) throw error;

  return data as string;
};

export const cancelScheduledMessage = async (id: string) => {
  const { error } = await supabase.rpc("scheduled_message_cancel", { p_id: id });
  if (error) throw error;
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

// As programadas saem pelo WhatsApp conectado por QR Code (Evolution)
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
