import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Atendentes adicionados à conversa (além do responsável). Atualiza sozinho
 * quando alguém entra ou sai e quando `refreshKey` muda (ex.: a conversa foi
 * transferida ou finalizada e o banco limpou a lista).
 */
export function useConversationParticipants(
  conversationId: string | null | undefined,
  refreshKey?: string,
) {
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!conversationId) {
      setParticipantIds([]);
      setLoaded(true);
      return;
    }

    const { data, error } = await supabase
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Erro ao carregar atendentes da conversa:", error);
      setLoaded(true);
      return;
    }

    setParticipantIds(
      ((data as { user_id: string }[]) ?? []).map((r) => r.user_id),
    );
    setLoaded(true);
  }, [conversationId]);

  useEffect(() => {
    setLoaded(false);
    void reload();
  }, [reload, refreshKey]);

  useEffect(() => {
    if (!conversationId) return;

    // Remoções não podem ser filtradas por coluna no tempo real: escuta a
    // tabela e confere a conversa no próprio aviso
    const channel = supabase
      .channel(`rt:conversation_participants:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_participants" },
        (payload) => {
          const rowConversationId =
            (payload.new as any)?.conversation_id ??
            (payload.old as any)?.conversation_id;
          if (rowConversationId && rowConversationId !== conversationId) return;
          void reload();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, reload]);

  return { participantIds, loaded, reload };
}
