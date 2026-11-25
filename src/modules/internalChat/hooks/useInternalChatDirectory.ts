import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { useAuth } from "../../../contexts/AuthContext";
import { openDirectThread } from "../api/internalChat";
import type { ListEntry } from "../components/shared";
import { GENERAL_NAME, roleLabel } from "../utils/format";
import type { InternalThread } from "../types/internalChat";
import {
  internalChatKeys,
  useInternalThreads,
  useTeamMembers,
} from "./useInternalChat";

/**
 * Lista do chat interno (canal geral e pessoas da equipe) e ações comuns à
 * página do chat e à janela flutuante.
 */
export function useInternalChatDirectory(search: string) {
  const queryClient = useQueryClient();
  const { authUser } = useAuth();
  const currentUserId = authUser?.id;

  const { threads, loading: threadsLoading } = useInternalThreads();
  const { members, loading: membersLoading } = useTeamMembers();
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);

  const memberNames = useMemo(() => {
    const names: Record<string, string> = {};
    members.forEach((member) => {
      names[member.userId] = member.name;
    });
    return names;
  }, [members]);

  // Canal geral no topo; depois as pessoas, das conversas mais recentes para as sem conversa
  const entries = useMemo(() => {
    const general = threads.find((thread) => thread.kind === "general");
    const directByUser = new Map(
      threads
        .filter((thread) => thread.kind === "direct" && thread.otherUserId)
        .map((thread) => [thread.otherUserId as string, thread]),
    );

    const people: ListEntry[] = members
      .filter((member) => member.userId !== currentUserId)
      .map((member) => ({
        key: member.userId,
        name: member.name,
        general: false,
        member,
        thread: directByUser.get(member.userId),
      }))
      .sort((a, b) => {
        const aAt = a.thread?.lastMessageAt ?? "";
        const bAt = b.thread?.lastMessageAt ?? "";
        if (aAt !== bAt) {
          return new Date(bAt || 0).getTime() - new Date(aAt || 0).getTime();
        }
        return a.name.localeCompare(b.name, "pt-BR");
      });

    const all: ListEntry[] = [
      { key: "general", name: GENERAL_NAME, general: true, thread: general },
      ...people,
    ];

    const query = search.trim().toLowerCase();
    return query
      ? all.filter((entry) => entry.name.toLowerCase().includes(query))
      : all;
  }, [threads, members, currentUserId, search]);

  const titleOf = useCallback(
    (thread: InternalThread) =>
      thread.kind === "general"
        ? GENERAL_NAME
        : (memberNames[thread.otherUserId ?? ""] ?? "Atendente"),
    [memberNames],
  );

  const subtitleOf = useCallback(
    (thread: InternalThread) =>
      thread.kind === "general"
        ? `Toda a equipe · ${members.length} ${members.length === 1 ? "pessoa" : "pessoas"}`
        : roleLabel(
            members.find((m) => m.userId === thread.otherUserId)?.role ??
              "agent",
          ),
    [members],
  );

  /** Id da conversa da entrada, criando a conversa direta se ainda não existe. */
  const resolveEntry = useCallback(
    async (entry: ListEntry): Promise<string | null> => {
      if (entry.thread) return entry.thread.id;
      if (!entry.member || !currentUserId) return null;

      setOpeningUserId(entry.member.userId);
      try {
        const id = await openDirectThread(entry.member.userId);
        await queryClient.invalidateQueries({
          queryKey: internalChatKeys.threads(currentUserId),
        });
        return id;
      } catch (error) {
        console.error("Erro ao abrir conversa interna:", error);
        toast.error("Não foi possível abrir a conversa.");
        return null;
      } finally {
        setOpeningUserId(null);
      }
    },
    [currentUserId, queryClient],
  );

  return {
    currentUserId,
    threads,
    members,
    memberNames,
    entries,
    loading: threadsLoading || membersLoading,
    threadsLoading,
    openingUserId,
    titleOf,
    subtitleOf,
    resolveEntry,
  };
}
