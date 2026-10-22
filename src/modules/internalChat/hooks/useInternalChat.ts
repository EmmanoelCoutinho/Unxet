import { useCallback, useState } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useAuth } from "../../../contexts/AuthContext";
import { useClinic } from "../../../contexts/ClinicContext";
import {
  listInternalMessages,
  listInternalThreads,
  listTeamMembers,
  markInternalThreadRead,
  sendInternalMessage,
} from "../api/internalChat";
import type {
  InternalMessage,
  InternalMessagesPage,
  InternalThread,
} from "../types/internalChat";
import {
  mergeLatestPage,
  sortInternalMessages,
  upsertInternalMessage,
} from "../utils/messages";

export const internalChatKeys = {
  all: ["internal-chat"] as const,
  threads: (userId: string | null) =>
    [...internalChatKeys.all, "threads", userId] as const,
  members: (clinicId: string | null) =>
    [...internalChatKeys.all, "members", clinicId] as const,
  messages: (userId: string | null, threadId: string | null) =>
    [...internalChatKeys.all, "messages", userId, threadId] as const,
};

// Conversa aberta na tela agora: mensagens que chegam nela não contam como não lidas
let activeThreadId: string | null = null;
export const setActiveInternalThread = (threadId: string | null) => {
  activeThreadId = threadId;
};
export const isInternalThreadOnScreen = (threadId: string) =>
  activeThreadId === threadId && document.visibilityState === "visible";

/**
 * Reflete uma mensagem nova na lista de conversas em cache (prévia, ordem e
 * não lidas). Retorna false quando a conversa ainda não está na lista.
 */
export function applyMessageToThreads(
  queryClient: QueryClient,
  userId: string,
  message: InternalMessage,
  options: { countAsUnread: boolean },
) {
  const key = internalChatKeys.threads(userId);
  const threads = queryClient.getQueryData<InternalThread[]>(key);
  if (!threads?.some((t) => t.id === message.threadId)) return false;

  queryClient.setQueryData<InternalThread[]>(key, (current) =>
    current?.map((thread) =>
      thread.id === message.threadId
        ? {
            ...thread,
            lastMessageAt: message.createdAt,
            lastMessageBody: message.body.slice(0, 140),
            lastMessageSenderId: message.senderId,
            unreadCount: thread.unreadCount + (options.countAsUnread ? 1 : 0),
          }
        : thread,
    ),
  );
  return true;
}

/** Coloca (ou atualiza) uma mensagem na conversa em cache, se ela já foi aberta. */
export function applyMessageToCache(
  queryClient: QueryClient,
  userId: string,
  message: InternalMessage,
) {
  queryClient.setQueryData<InternalMessagesPage>(
    internalChatKeys.messages(userId, message.threadId),
    (current) =>
      current && {
        ...current,
        messages: upsertInternalMessage(current.messages, message),
      },
  );
}

export function useInternalThreads() {
  const { authUser } = useAuth();
  const { clinicId } = useClinic();
  const userId = authUser?.id ?? null;

  const query = useQuery({
    queryKey: internalChatKeys.threads(userId),
    queryFn: listInternalThreads,
    enabled: !!userId && !!clinicId,
    refetchOnWindowFocus: true,
  });

  return {
    threads: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
  };
}

/** Total de mensagens internas não lidas (selo do menu). */
export function useInternalUnreadTotal() {
  const { threads } = useInternalThreads();
  const { hasFeature } = useClinic();
  // Plano sem chat interno: mensagens antigas não lidas não acendem um selo
  // que leva a uma tela bloqueada
  if (!hasFeature("internal_chat")) return 0;
  return threads.reduce((total, thread) => total + thread.unreadCount, 0);
}

export function useTeamMembers() {
  const { clinicId } = useClinic();

  const query = useQuery({
    queryKey: internalChatKeys.members(clinicId),
    queryFn: () => listTeamMembers(clinicId as string),
    enabled: !!clinicId,
    staleTime: 5 * 60 * 1000,
  });

  return { members: query.data ?? [], loading: query.isLoading };
}

export function useInternalMessages(threadId: string | null) {
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = internalChatKeys.messages(userId, threadId);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const query = useQuery({
    queryKey,
    enabled: !!userId && !!threadId,
    queryFn: async () => {
      const page = await listInternalMessages(threadId as string);
      return mergeLatestPage(
        queryClient.getQueryData<InternalMessagesPage>(queryKey),
        page,
      );
    },
  });

  const messages = query.data?.messages ?? [];
  const hasMore = query.data?.hasMore ?? false;

  // Carrega a página anterior à mensagem mais antiga exibida
  const loadOlder = useCallback(async () => {
    if (!userId || !threadId || loadingOlder) return;

    const key = internalChatKeys.messages(userId, threadId);
    const current = queryClient.getQueryData<InternalMessagesPage>(key);
    const oldest = current?.messages.find((m) => !m.pending && !m.failed);
    if (!current?.hasMore || !oldest) return;

    setLoadingOlder(true);
    try {
      const page = await listInternalMessages(threadId, oldest.createdAt);
      queryClient.setQueryData<InternalMessagesPage>(key, (latest) => {
        const existing = latest?.messages ?? [];
        const ids = new Set(existing.map((m) => m.id));
        return {
          messages: sortInternalMessages([
            ...page.messages.filter((m) => !ids.has(m.id)),
            ...existing,
          ]),
          hasMore: page.hasMore,
        };
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [userId, threadId, loadingOlder, queryClient]);

  return {
    messages,
    hasMore,
    loading: query.isLoading,
    error: query.error,
    loadingOlder,
    loadOlder,
  };
}

export function useSendInternalMessage(threadId: string | null) {
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;
  const queryClient = useQueryClient();

  /** Envia um texto novo ou reenvia uma mensagem que falhou (mesmo id). */
  return useCallback(
    async (body: string, retryId?: string) => {
      const text = body.trim();
      if (!userId || !threadId || !text) return;

      const key = internalChatKeys.messages(userId, threadId);
      const put = (message: InternalMessage) =>
        queryClient.setQueryData<InternalMessagesPage>(key, (current) => ({
          hasMore: current?.hasMore ?? false,
          messages: upsertInternalMessage(current?.messages ?? [], message),
        }));

      const optimistic: InternalMessage = {
        id: retryId ?? crypto.randomUUID(),
        threadId,
        senderId: userId,
        body: text,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      put(optimistic);

      try {
        const saved = await sendInternalMessage({
          id: optimistic.id,
          threadId,
          senderId: userId,
          body: text,
        });
        put(saved);
        applyMessageToThreads(queryClient, userId, saved, {
          countAsUnread: false,
        });
      } catch (error: any) {
        // Id repetido: a tentativa anterior chegou ao banco e só a resposta se perdeu
        if (error?.code === "23505") {
          await queryClient.invalidateQueries({ queryKey: key });
          return;
        }
        console.error("Erro ao enviar mensagem interna:", error);
        put({ ...optimistic, pending: false, failed: true });
      }
    },
    [userId, threadId, queryClient],
  );
}

/** Marca a conversa como lida no banco e zera o contador em cache. */
export function useMarkInternalThreadRead() {
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;
  const queryClient = useQueryClient();

  return useCallback(
    async (threadId: string) => {
      if (!userId) return;

      queryClient.setQueryData<InternalThread[]>(
        internalChatKeys.threads(userId),
        (current) =>
          current?.map((thread) =>
            thread.id === threadId ? { ...thread, unreadCount: 0 } : thread,
          ),
      );

      try {
        await markInternalThreadRead(threadId);
      } catch (error) {
        console.error("Erro ao marcar conversa interna como lida:", error);
      }
    },
    [userId, queryClient],
  );
}
