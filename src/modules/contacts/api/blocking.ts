import { supabase } from "../../../lib/supabaseClient";

// Contato bloqueado (migration 20261115000000_contact_blocking): as mensagens
// dele são descartadas na entrada e a empresa também não envia para ele.

export type BlockedContact = {
  id: string;
  name: string | null;
  phone: string | null;
  imageUrl: string | null;
  blockedAt: string;
  blockedByName: string | null;
  reason: string | null;
  blockedMessages: number;
  lastBlockedMessageAt: string | null;
};

export const BLOCK_REASON_MAX_LENGTH = 300;

/** Mensagem do banco (já escrita para o usuário) ou o texto padrão. */
const rpcMessage = (error: { message?: string } | null, fallback: string) => {
  const text = String(error?.message ?? "").trim();
  return /\s/.test(text) && /[à-úÀ-Ú]|ç/.test(text) ? text : fallback;
};

export async function listBlockedContacts(): Promise<BlockedContact[]> {
  const { data, error } = await supabase.rpc("list_blocked_contacts");
  if (error) throw new Error("Não foi possível carregar os contatos bloqueados.");
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    name: row.name ?? null,
    phone: row.phone ?? null,
    imageUrl: row.image_url ?? null,
    blockedAt: row.blocked_at,
    blockedByName: row.blocked_by_name ?? null,
    reason: row.blocked_reason ?? null,
    blockedMessages: Number(row.blocked_messages ?? 0),
    lastBlockedMessageAt: row.last_blocked_message_at ?? null,
  }));
}

/** Bloqueia um cliente da carteira (contactId) ou um número digitado (phone). */
export async function blockContact(params: {
  contactId?: string;
  phone?: string;
  name?: string;
  reason?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("contact_block", {
    p_contact_id: params.contactId ?? null,
    p_phone: params.contactId ? null : (params.phone ?? null),
    p_name: params.name?.trim() || null,
    p_reason: params.reason?.trim() || null,
  });
  if (error) throw new Error(rpcMessage(error, "Não foi possível bloquear o contato."));
  return data as string;
}

export async function unblockContact(contactId: string): Promise<void> {
  const { error } = await supabase.rpc("contact_unblock", { p_contact_id: contactId });
  if (error) throw new Error(rpcMessage(error, "Não foi possível desbloquear o contato."));
}

/** "5511987654321" -> "+55 (11) 98765-4321"; chave de outro canal volta sem o prefixo. */
export const formatBlockedIdentifier = (value: string | null | undefined) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const channel = raw.match(/^(instagram|messenger):/i)?.[1]?.toLowerCase();
  if (channel) return channel === "instagram" ? "Instagram" : "Messenger";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return digits ? `+${digits}` : raw;
};
