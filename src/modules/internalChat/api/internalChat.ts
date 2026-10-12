import { supabase } from "../../../lib/supabaseClient";
import type {
  InternalMessage,
  InternalThread,
  TeamMember,
} from "../types/internalChat";

// Mensagens carregadas por vez (a conversa abre com as mais recentes)
export const INTERNAL_MESSAGES_PAGE_SIZE = 50;
export const INTERNAL_MESSAGE_MAX_LENGTH = 4000;

const MESSAGE_COLUMNS = "id, thread_id, sender_id, body, created_at";

export type DbInternalMessage = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
};

export const mapInternalMessage = (row: DbInternalMessage): InternalMessage => ({
  id: row.id,
  threadId: row.thread_id,
  senderId: row.sender_id ?? null,
  body: row.body ?? "",
  createdAt: row.created_at,
});

export async function listInternalThreads(): Promise<InternalThread[]> {
  const { data, error } = await supabase.rpc("internal_chat_list_threads");
  if (error) throw error;

  return ((data as any[]) ?? []).map((row) => ({
    id: row.thread_id,
    kind: row.kind,
    otherUserId: row.other_user_id ?? null,
    lastMessageAt: row.last_message_at ?? null,
    lastMessageBody: row.last_message_body ?? null,
    lastMessageSenderId: row.last_message_sender_id ?? null,
    unreadCount: row.unread_count ?? 0,
  }));
}

export async function listTeamMembers(clinicId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from("clinic_users")
    .select("user_id, name, email, role")
    .eq("clinic_id", clinicId);
  if (error) throw error;

  return ((data as any[]) ?? [])
    .filter((row) => row?.user_id)
    .map((row) => ({
      userId: row.user_id,
      name: row.name || row.email || "Atendente",
      role: row.role ?? "agent",
    }));
}

/** Abre (ou cria) a conversa direta com outra pessoa da clínica. */
export async function openDirectThread(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc("internal_chat_open_direct", {
    p_user_id: userId,
  });
  if (error) throw error;
  if (!data) throw new Error("Não foi possível abrir a conversa.");
  return data as string;
}

/** Página de mensagens anteriores a `before` (ou a mais recente), em ordem cronológica. */
export async function listInternalMessages(threadId: string, before?: string) {
  let query = supabase
    .from("internal_chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(INTERNAL_MESSAGES_PAGE_SIZE + 1);

  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data as DbInternalMessage[]) ?? [];
  return {
    messages: rows
      .slice(0, INTERNAL_MESSAGES_PAGE_SIZE)
      .reverse()
      .map(mapInternalMessage),
    hasMore: rows.length > INTERNAL_MESSAGES_PAGE_SIZE,
  };
}

export async function sendInternalMessage(params: {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
}): Promise<InternalMessage> {
  const { data, error } = await supabase
    .from("internal_chat_messages")
    .insert({
      id: params.id,
      thread_id: params.threadId,
      sender_id: params.senderId,
      body: params.body,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;

  // O push é só um aviso: falha nele não desfaz o envio
  supabase.functions
    .invoke("internal-chat-push", { body: { messageId: params.id } })
    .then(({ error: pushError }) => {
      if (pushError) console.error("Erro ao notificar a equipe:", pushError);
    })
    .catch((pushError) => {
      console.error("Erro ao notificar a equipe:", pushError);
    });

  return mapInternalMessage(data as DbInternalMessage);
}

export async function markInternalThreadRead(threadId: string) {
  const { error } = await supabase.rpc("internal_chat_mark_read", {
    p_thread_id: threadId,
  });
  if (error) throw error;
}
