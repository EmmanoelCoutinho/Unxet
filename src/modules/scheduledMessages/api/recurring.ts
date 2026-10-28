import { supabase } from "../../../lib/supabaseClient";
import type { ScheduledMessageStatus, ScheduledRecipientStatus } from "../types/scheduledMessages";
import type { Frequency, RecurrenceDraft } from "../utils/recurrence";

export type RecurringStatus = "active" | "paused" | "finished";

// Mensagem agendada para um cliente (uma vez ou recorrente)
export type ContactScheduledMessage = RecurrenceDraft & {
  id: string;
  contactId: string;
  message: string;
  channelConnectionId: string | null;
  createdBy: string | null;
  runCount: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  status: RecurringStatus;
  createdAt: string;
  // Último envio gerado por esta regra (se houver)
  lastSend: {
    scheduledAt: string;
    status: ScheduledMessageStatus;
    recipientStatus: ScheduledRecipientStatus | null;
    recipientError: string | null;
  } | null;
};

export type SaveRecurringInput = RecurrenceDraft & {
  id: string | null;
  contactId: string;
  message: string;
  sendNow: boolean;
  channelConnectionId: string | null;
};

export const listContactScheduledMessages = async (
  contactId: string,
): Promise<ContactScheduledMessage[]> => {
  const { data, error } = await supabase
    .from("recurring_messages")
    .select(
      "id, contact_id, message, channel_connection_id, created_by, frequency, weekdays, month_day, send_time, starts_on, ends_on, max_runs, run_count, next_run_at, last_run_at, last_error, status, created_at",
    )
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  const rules = data ?? [];
  const ids = rules.map((r: any) => r.id as string);

  // Último envio de cada regra
  const lastByRule = new Map<string, ContactScheduledMessage["lastSend"]>();
  if (ids.length > 0) {
    const { data: sends, error: sendsError } = await supabase
      .from("scheduled_messages")
      .select("recurring_message_id, scheduled_at, status, recipients:scheduled_message_recipients(status, error)")
      .in("recurring_message_id", ids)
      .order("scheduled_at", { ascending: false })
      .limit(200);
    if (sendsError) throw sendsError;
    for (const send of (sends ?? []) as any[]) {
      if (lastByRule.has(send.recurring_message_id)) continue;
      lastByRule.set(send.recurring_message_id, {
        scheduledAt: send.scheduled_at,
        status: send.status,
        recipientStatus: send.recipients?.[0]?.status ?? null,
        recipientError: send.recipients?.[0]?.error ?? null,
      });
    }
  }

  return rules.map((r: any) => ({
    id: r.id,
    contactId: r.contact_id,
    message: r.message,
    channelConnectionId: r.channel_connection_id,
    createdBy: r.created_by,
    frequency: r.frequency as Frequency,
    weekdays: (r.weekdays ?? []).map(Number),
    monthDay: r.month_day ?? 1,
    // "09:00:00" -> "09:00"
    sendTime: String(r.send_time ?? "09:00").slice(0, 5),
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    maxRuns: r.max_runs,
    runCount: r.run_count ?? 0,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    lastError: r.last_error,
    status: r.status,
    createdAt: r.created_at,
    lastSend: lastByRule.get(r.id) ?? null,
  }));
};

const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
};

export const saveContactScheduledMessage = async (input: SaveRecurringInput): Promise<string> => {
  const { data, error } = await supabase.rpc("recurring_message_save", {
    p_id: input.id,
    p_contact_id: input.contactId,
    p_message: input.message.trim(),
    p_frequency: input.frequency,
    p_weekdays: input.frequency === "weekly" ? input.weekdays : null,
    p_month_day: input.frequency === "monthly" ? input.monthDay : null,
    p_send_time: input.sendTime,
    p_starts_on: input.startsOn,
    p_ends_on: input.frequency === "once" ? null : input.endsOn,
    p_max_runs: input.frequency === "once" ? null : input.maxRuns,
    p_send_now: input.frequency === "once" && input.sendNow,
    p_channel_connection_id: input.channelConnectionId,
    p_timezone: browserTimezone(),
  });
  if (error) throw error;
  return data as string;
};

export const setContactScheduledMessageStatus = async (id: string, status: "active" | "paused") => {
  const { error } = await supabase.rpc("recurring_message_set_status", { p_id: id, p_status: status });
  if (error) throw error;
};

export const deleteContactScheduledMessage = async (id: string) => {
  const { error } = await supabase.rpc("recurring_message_delete", { p_id: id });
  if (error) throw error;
};
