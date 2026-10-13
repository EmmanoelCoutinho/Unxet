import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelScheduledMessage,
  deleteScheduledMessage,
  getScheduledMessage,
  hasConnectedQrWhatsapp,
  listScheduledMessages,
  saveScheduledMessage,
  searchWalletContacts,
} from "../api/scheduledMessages";
import type {
  SaveScheduledMessageInput,
  ScheduledMessage,
} from "../types/scheduledMessages";

export const scheduledMessageQueryKeys = {
  all: ["scheduled-messages"] as const,
  list: (clinicId: string | null) =>
    [...scheduledMessageQueryKeys.all, "list", clinicId] as const,
  detail: (id: string | null) =>
    [...scheduledMessageQueryKeys.all, "detail", id] as const,
  qrConnection: (clinicId: string | null) =>
    [...scheduledMessageQueryKeys.all, "qr-connection", clinicId] as const,
  walletSearch: (clinicId: string | null, search: string) =>
    [...scheduledMessageQueryKeys.all, "wallet", clinicId, search] as const,
};

const POLL_MS = 15000;
// Perto do horário a tela acompanha a mudança de status sem recarregar
const POLL_WINDOW_MS = 5 * 60 * 1000;

const needsPolling = (item: ScheduledMessage) =>
  item.status === "processing" ||
  (item.status === "scheduled" &&
    new Date(item.scheduledAt).getTime() - Date.now() < POLL_WINDOW_MS);

export const useScheduledMessages = (clinicId: string | null) => {
  const query = useQuery({
    queryKey: scheduledMessageQueryKeys.list(clinicId),
    queryFn: () => listScheduledMessages(clinicId),
    enabled: Boolean(clinicId),
    staleTime: 0,
    refetchInterval: (q) =>
      (q.state.data ?? []).some(needsPolling) ? POLL_MS : false,
  });

  return {
    scheduledMessages: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
};

export const useScheduledMessage = (id: string | null) => {
  const query = useQuery({
    queryKey: scheduledMessageQueryKeys.detail(id),
    queryFn: () => getScheduledMessage(id as string),
    enabled: Boolean(id),
    staleTime: 0,
    refetchInterval: (q) =>
      q.state.data && needsPolling(q.state.data) ? POLL_MS : false,
  });

  return {
    scheduledMessage: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
};

export const useScheduledMessageActions = () => {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: scheduledMessageQueryKeys.all });

  const saveMutation = useMutation({
    mutationFn: (input: SaveScheduledMessageInput) => saveScheduledMessage(input),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelScheduledMessage(id),
    // Em caso de erro a situação mudou no servidor (ex.: já foi enviada)
    onSettled: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteScheduledMessage(id),
    onSettled: invalidate,
  });

  return {
    save: saveMutation.mutateAsync,
    cancel: cancelMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
    saving: saveMutation.isPending,
    acting: cancelMutation.isPending || deleteMutation.isPending,
  };
};

export const useQrWhatsappConnected = (clinicId: string | null) => {
  const query = useQuery({
    queryKey: scheduledMessageQueryKeys.qrConnection(clinicId),
    queryFn: () => hasConnectedQrWhatsapp(clinicId),
    enabled: Boolean(clinicId),
  });

  // Sem resposta (carregando ou erro) não mostra o aviso de desconectado
  return query.data ?? true;
};

export const useWalletContactSearch = (
  clinicId: string | null,
  search: string,
  enabled: boolean,
) => {
  const query = useQuery({
    queryKey: scheduledMessageQueryKeys.walletSearch(clinicId, search),
    queryFn: () => searchWalletContacts(clinicId, search),
    enabled: Boolean(clinicId) && enabled,
    placeholderData: (previous) => previous,
  });

  return {
    contacts: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
};
