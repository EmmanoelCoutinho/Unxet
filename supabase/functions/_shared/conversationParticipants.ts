/**
 * Atendentes adicionados a uma conversa (tabela conversation_participants).
 *
 * Eles respondem junto com o responsável (assigned_user_id). Só o
 * responsável ou quem atende todos os setores adiciona e remove; o próprio
 * participante pode sair. A lista é limpa pelo banco ao transferir, voltar
 * para a fila ou finalizar (trigger conversations_clear_participants).
 */

/** A pessoa foi adicionada a esta conversa? Em caso de erro, não. */
export async function isConversationParticipant(admin, conversationId: string, userId: string): Promise<boolean> {
  if (!conversationId || !userId) return false;
  const { data, error } = await admin
    .from("conversation_participants")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("participants.check_failed", conversationId, error);
    return false;
  }
  return !!data;
}

/** user_ids dos participantes da conversa (lista vazia em caso de erro). */
export async function listConversationParticipantIds(admin, conversationId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", conversationId);
  if (error) {
    console.error("participants.list_failed", conversationId, error);
    return [];
  }
  return (data ?? []).map((row) => row.user_id).filter(Boolean);
}
