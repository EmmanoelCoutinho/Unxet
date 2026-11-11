import { supabase } from "../lib/supabaseClient";

// Os indicadores (Painel e Relatórios) vêm de src/modules/reports/api.ts;
// aqui fica só a fila de conversas esperando resposta.

export type BacklogFilters = {
  clinicId: string;
  channels: string[];
  departmentId?: string;
  assignedUserId?: string;
};

type BacklogRpcRow = {
  conversation_id: string;
  contact: string;
  channel: string;
  department: string;
  assigned_to: string;
  last_message_at: string;
  last_message_text: string | null;
  total_count: number;
  sla_breached?: boolean | null;
  sla_breached_count?: number | null;
};

const toError = (err: any, fallback: string) => {
  const msg =
    err?.message ||
    err?.error_description ||
    err?.hint ||
    err?.details ||
    fallback;
  return new Error(typeof msg === "string" ? msg : fallback);
};

export type BacklogItem = {
  conversationId: string;
  contact: string;
  channel: string;
  department: string;
  assignedTo: string;
  lastMessageAt: string;
  lastMessageText: string;
  // Passou do prazo de 1ª resposta definido pela empresa
  slaBreached: boolean;
};

export type BacklogResult = {
  items: BacklogItem[];
  // Total de conversas aguardando resposta (a lista traz no máximo 500)
  total: number;
  // Quantas delas já passaram do prazo de 1ª resposta
  slaBreachedTotal: number;
};

/**
 * Conversas ativas cuja última mensagem é do cliente, da que espera há mais
 * tempo para a mais recente.
 */
export const fetchBacklog = async (
  filters: BacklogFilters,
): Promise<BacklogResult> => {
  const { data, error } = await supabase.rpc("inbox_backlog", {
    p_clinic_id: filters.clinicId,
    p_channels: filters.channels?.length ? filters.channels : null,
    p_department_id: filters.departmentId ?? null,
    p_assigned_user_id: filters.assignedUserId ?? null,
  });

  if (error) throw toError(error, "Falha ao buscar o backlog.");

  const rows = (data ?? []) as BacklogRpcRow[];

  return {
    total: Number(rows[0]?.total_count ?? 0),
    slaBreachedTotal: Number(rows[0]?.sla_breached_count ?? 0),
    items: rows.map((row) => ({
      conversationId: row.conversation_id,
      contact: row.contact,
      channel: row.channel ?? "unknown",
      department: row.department,
      assignedTo: row.assigned_to,
      lastMessageAt: row.last_message_at,
      lastMessageText: row.last_message_text?.trim() || "Mensagem recebida",
      slaBreached: row.sla_breached === true,
    })),
  };
};

export type TodayConversation = {
  conversationId: string;
  contact: string;
  channel: string;
  department: string;
  assignedTo: string;
  status: "open" | "pending" | "closed";
  inBotFlow: boolean;
  lastActivityAt: string;
};

export type TodayConversationsResult = {
  items: TodayConversation[];
  // Total de conversas com movimento hoje (a lista traz no máximo 500)
  total: number;
};

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Conversas com movimento desde a meia-noite (mensagem, criação ou
 * finalização), da mais recente para a mais antiga.
 */
export const fetchTodayConversations = async (
  filters: Pick<BacklogFilters, "clinicId" | "channels" | "departmentId">,
): Promise<TodayConversationsResult> => {
  const timeZone = browserTimeZone();
  const { data, error } = await supabase.rpc("inbox_today_conversations", {
    p_clinic_id: filters.clinicId,
    p_channels: filters.channels?.length ? filters.channels : null,
    p_department_id: filters.departmentId ?? null,
    ...(timeZone ? { p_timezone: timeZone } : {}),
  });

  if (error) throw toError(error, "Falha ao buscar os atendimentos de hoje.");

  const rows = (data ?? []) as any[];
  return {
    total: Number(rows[0]?.total_count ?? 0),
    items: rows.map((row) => ({
      conversationId: row.conversation_id,
      contact: row.contact,
      channel: row.channel ?? "unknown",
      department: row.department,
      assignedTo: row.assigned_to,
      status: row.status === "open" || row.status === "closed" ? row.status : "pending",
      inBotFlow: row.in_bot_flow === true,
      lastActivityAt: row.last_activity_at,
    })),
  };
};
