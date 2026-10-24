import React, { createContext, useContext, useMemo } from "react";
import { useMatch } from "react-router-dom";
import { useConversations } from "../hooks/useConversations";
import { useFloatingChats } from "../modules/floatingChats/FloatingChatsContext";

type ConversationsValue = ReturnType<typeof useConversations>;

const ConversationsContext = createContext<ConversationsValue | null>(null);

/**
 * Lista de conversas do atendente, viva em qualquer tela do app: a lista do
 * inbox e as caixas flutuantes leem daqui (prévia e não lidas).
 */
export function ConversationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const routeConversationId =
    useMatch("/inbox/chat/:id")?.params.id ?? null;
  const { viewingIds } = useFloatingChats();

  // Conversas na tela agora: a da tela cheia e as caixas expandidas
  const activeKey = [routeConversationId, ...viewingIds]
    .filter(Boolean)
    .join(",");
  const activeConversationIds = useMemo(
    () => (activeKey ? activeKey.split(",") : []),
    [activeKey],
  );

  const value = useConversations({ activeConversationIds });

  return (
    <ConversationsContext.Provider value={value}>
      {children}
    </ConversationsContext.Provider>
  );
}

export function useConversationList() {
  const value = useContext(ConversationsContext);
  if (!value) {
    throw new Error("useConversationList precisa do ConversationsProvider");
  }
  return value;
}
