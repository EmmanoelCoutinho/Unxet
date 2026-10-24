import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useFloatingChats } from "./FloatingChatsContext";

/**
 * Abre uma conversa: no computador em caixa flutuante, no celular (ou com
 * `fullScreen`) na tela cheia do chat.
 */
export function useOpenConversation() {
  const navigate = useNavigate();
  const { enabled, open } = useFloatingChats();

  return useCallback(
    (id: string, options?: { title?: string; fullScreen?: boolean }) => {
      if (enabled && !options?.fullScreen) {
        open(id, options?.title);
        return;
      }
      navigate(`/inbox/chat/${id}`);
    },
    [enabled, open, navigate],
  );
}
