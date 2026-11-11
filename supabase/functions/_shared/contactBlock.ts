// deno-lint-ignore-file
// @ts-nocheck
// Contato bloqueado (migration 20261115000000_contact_blocking): a entrada
// descarta as mensagens dele e a empresa também não envia para ele.
//
// Erro ao consultar nunca bloqueia: na dúvida a mensagem segue (perder a
// mensagem de um cliente é pior do que deixar passar a de um bloqueado).

export const BLOCKED_CONTACT_CODE = "contact_blocked";
export const BLOCKED_CONTACT_ERROR =
  "Este contato está bloqueado. Desbloqueie em Contatos bloqueados para voltar a conversar.";

/** Telefone só com dígitos ou a chave do canal ("instagram:123"), sem vazios nem repetidos. */
export const blockIdentifiers = (...values: unknown[]): string[] => {
  const out = new Set<string>();
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) out.add(text);
  }
  return [...out];
};

/**
 * Entrada: se o remetente está bloqueado, conta a mensagem barrada e devolve
 * true (quem chama descarta a mensagem).
 */
export async function registerBlockedInbound(supabase, clinicId, identifiers: string[]) {
  if (!clinicId || identifiers.length === 0) return false;
  const { data, error } = await supabase.rpc("register_blocked_inbound", {
    p_clinic_id: clinicId,
    p_identifiers: identifiers,
  });
  if (error) {
    console.error("[CONTACT_BLOCK] register_blocked_inbound falhou:", error);
    return false;
  }
  return data === true;
}

/** Envio para um número/chave: está bloqueado? */
export async function isIdentifierBlocked(supabase, clinicId, identifiers: string[]) {
  if (!clinicId || identifiers.length === 0) return false;
  const { data, error } = await supabase.rpc("is_contact_identifier_blocked", {
    p_clinic_id: clinicId,
    p_identifiers: identifiers,
  });
  if (error) {
    console.error("[CONTACT_BLOCK] is_contact_identifier_blocked falhou:", error);
    return false;
  }
  return data === true;
}

/** Envio numa conversa: o contato dela está bloqueado? */
export async function isContactBlocked(supabase, contactId) {
  if (!contactId) return false;
  const { data, error } = await supabase
    .from("contacts")
    .select("blocked_at")
    .eq("id", contactId)
    .maybeSingle();
  if (error) {
    console.error("[CONTACT_BLOCK] leitura do contato falhou:", error);
    return false;
  }
  return !!data?.blocked_at;
}
