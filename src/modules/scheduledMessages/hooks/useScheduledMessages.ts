import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelScheduledMessage,
  deleteScheduledMessage,
  fetchCampaignAudience,
  getConversationCampaign,
  getScheduledMessage,
  hasConnectedQrWhatsapp,
  listCampaignSummaries,
  listCampaignTags,
  listQrWhatsappNumbers,
  retryCampaign,
  saveScheduledMessage,
  searchWalletContacts,
  setCampaignConversion,
} from "../api/scheduledMessages";
import type {
  SaveScheduledMessageInput,
  ScheduledMessageStatus,
} from "../types/scheduledMessages";
import { effectiveStatus } from "../utils/schedule";

export const scheduledMessageQueryKeys = {
  all: ["scheduled-messages"] as const,
  list: (clinicId: string | null) =>
    [...scheduledMessageQueryKeys.all, "list", clinicId] as const,
  detail: (id: string | null) =>
    [...scheduledMessageQueryKeys.all, "detail", id] as const,
  qrConnection: (clinicId: string | null) =>
    [...scheduledMessageQueryKeys.all, "qr-connection", clinicId] as const,
  qrNumbers: (clinicId: string | null) =>
    [...scheduledMessageQueryKeys.all, "qr-numbers", clinicId] as const,
  walletSearch: (clinicId: string | null, search: string) =>
    [...scheduledMessageQueryKeys.all, "wallet", clinicId, search] as const,
  tags: (clinicId: string | null) =>
    [...scheduledMessageQueryKeys.all, "tags", clinicId] as const,
  conversation: (conversationId: string | null) =>
    [...scheduledMessageQueryKeys.all, "conversation", conversationId] as const,
};

// Enquanto envia, a barra de progresso acompanha de perto
const SENDING_POLL_MS = 5000;
const POLL_MS = 15000;
// Perto do horário a tela acompanha a mudança de status sem recarregar
const POLL_WINDOW_MS = 5 * 60 * 1000;

const pollInterval = (
  items: { status: ScheduledMessageStatus; scheduledAt: string }[],
) => {
  if (items.some((item) => effectiveStatus(item) === "processing")) {
    return SENDING_POLL_MS;
  }
  const startsSoon = items.some(
    (item) =>
      item.status === "scheduled" &&
      new Date(item.scheduledAt).getTime() - Date.now() < POLL_WINDOW_MS,
  );
  return startsSoon ? POLL_MS : false;
};

export const useScheduledMessages = (clinicId: string | null) => {
  const query = useQuery({
    queryKey: scheduledMessageQueryKeys.list(clinicId),
    queryFn: () => listCampaignSummaries(clinicId),
    enabled: Boolean(clinicId),
    staleTime: 0,
    refetchInterval: (q) => pollInterval(q.state.data ?? []),
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
    refetchInterval: (q) => (q.state.data ? pollInterval([q.state.data]) : false),
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
  const retryMutation = useMutation({
    mutationFn: (id: string) => retryCampaign(id),
    onSettled: invalidate,
  });

  return {
    save: saveMutation.mutateAsync,
    cancel: cancelMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
    retry: retryMutation.mutateAsync,
    saving: saveMutation.isPending,
    acting:
      cancelMutation.isPending ||
      deleteMutation.isPending ||
      retryMutation.isPending,
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

export const useQrWhatsappNumbers = (clinicId: string | null) => {
  const query = useQuery({
    queryKey: scheduledMessageQueryKeys.qrNumbers(clinicId),
    queryFn: () => listQrWhatsappNumbers(clinicId),
    enabled: Boolean(clinicId),
  });

  return { numbers: query.data ?? [], loading: query.isLoading };
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

export const useCampaignTags = (clinicId: string | null) => {
  const query = useQuery({
    queryKey: scheduledMessageQueryKeys.tags(clinicId),
    queryFn: () => listCampaignTags(clinicId),
    enabled: Boolean(clinicId),
  });

  return { tags: query.data ?? [], loading: query.isLoading };
};

// Busca sob demanda (botão "Adicionar"), não a cada clique numa etiqueta
export const useCampaignAudience = () =>
  useMutation({ mutationFn: (tagIds: string[]) => fetchCampaignAudience(tagIds) });

export const useConversationCampaign = (conversationId: string | null) => {
  const query = useQuery({
    queryKey: scheduledMessageQueryKeys.conversation(conversationId),
    queryFn: () => getConversationCampaign(conversationId as string),
    enabled: Boolean(conversationId),
    staleTime: 30 * 1000,
  });

  return { campaign: query.data ?? null, refetch: query.refetch };
};

export const useCampaignConversion = (conversationId: string | null) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setCampaignConversion,
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: scheduledMessageQueryKeys.conversation(conversationId),
      });
      queryClient.invalidateQueries({ queryKey: scheduledMessageQueryKeys.all });
    },
  });
};
