import React, { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ConversationView } from "../components/chat/ConversationView";
import { useFloatingChats } from "../modules/floatingChats/FloatingChatsContext";

// Conversa em tela cheia (/inbox/chat/:id). No computador dá para voltar
// para a caixa flutuante pelo botão do cabeçalho.
export const Chat: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { enabled: floatingEnabled, open } = useFloatingChats();

  const exit = useCallback(() => navigate("/inbox"), [navigate]);
  const popOut = useCallback(() => {
    if (!id) return;
    open(id);
    navigate("/inbox");
  }, [id, open, navigate]);

  if (!id) return null;

  return (
    <ConversationView
      conversationId={id}
      variant="page"
      onExit={exit}
      onPopOut={floatingEnabled ? popOut : undefined}
    />
  );
};
