// deno-lint-ignore-file
// @ts-nocheck
// Rodízio de conversas por departamento (departments.distribution_mode =
// 'round_robin'). Quem escolhe o atendente é o banco
// (distribute_conversation): aqui só chamamos e registramos falhas.
//
// Pode ser chamado à vontade: a função só age quando a conversa está
// marcada como "aguardando rodízio" (distribution_pending) e o bot não está
// mais conduzindo. Nos demais casos não faz nada.

/**
 * Tenta distribuir a conversa. Devolve o id do atendente escolhido, ou null
 * quando ela fica na fila (setor sem rodízio, bot atendendo, ninguém online
 * ou erro). Nunca lança: a conversa continua em "Pendentes" no pior caso.
 */
export async function distributeConversation(supabase, conversationId: string | null | undefined): Promise<string | null> {
  if (!conversationId) return null;
  try {
    const { data, error } = await supabase.rpc("distribute_conversation", {
      p_conversation_id: conversationId,
    });
    if (error) {
      console.error("distribution.failed", conversationId, error);
      return null;
    }
    return typeof data === "string" ? data : null;
  } catch (err) {
    console.error("distribution.failed", conversationId, err?.message ?? String(err));
    return null;
  }
}
