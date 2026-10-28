import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { useClinic } from "../contexts/ClinicContext";
import {
  mapInternalMessage,
  type DbInternalMessage,
} from "../modules/internalChat/api/internalChat";
import {
  applyMessageToCache,
  applyMessageToThreads,
  internalChatKeys,
  isInternalThreadOnScreen,
  useTeamMembers,
} from "../modules/internalChat/hooks/useInternalChat";

/**
 * Recebe em tempo real as mensagens do chat interno, em qualquer tela do app:
 * atualiza a conversa aberta, o contador de não lidas do menu e avisa quem
 * está em outra tela. O RLS limita os eventos às conversas do usuário.
 */
export function InternalChatBridge() {
  const { authUser } = useAuth();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // Nomes para o aviso, disponíveis mesmo sem a tela do chat ter sido aberta
  const { members } = useTeamMembers();
  const membersRef = useRef(members);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  const userId = authUser?.id ?? null;

  useEffect(() => {
    if (!userId || !clinicId) return;

    let subscribedBefore = false;

    const channel = supabase
      .channel(`internal-chat-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "internal_chat_messages",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const message = mapInternalMessage(payload.new as DbInternalMessage);
          const fromMe = message.senderId === userId;
          const onScreen = isInternalThreadOnScreen(message.threadId);

          applyMessageToCache(queryClient, userId, message);

          const known = applyMessageToThreads(queryClient, userId, message, {
            countAsUnread: !fromMe && !onScreen,
          });
          // Primeira mensagem de uma conversa direta que ainda não estava na lista
          if (!known) {
            void queryClient.invalidateQueries({
              queryKey: internalChatKeys.threads(userId),
            });
          }

          if (fromMe || onScreen) return;

          const senderName =
            membersRef.current.find((m) => m.userId === message.senderId)
              ?.name ?? "Equipe";

          // Só o nome: a tela pode estar à vista de um cliente
          toast.info(`${senderName}: nova mensagem no chat interno`, {
            toastId: `internal-chat-${message.threadId}`,
            onClick: () =>
              navigateRef.current(`/inbox/team/${message.threadId}`),
          });
        },
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // Ao reconectar, busca o que chegou enquanto a conexão estava caída
        if (subscribedBefore) {
          void queryClient.invalidateQueries({
            queryKey: internalChatKeys.all,
          });
        }
        subscribedBefore = true;
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, clinicId, queryClient]);

  return null;
}
