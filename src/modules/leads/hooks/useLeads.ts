import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDealNote,
  archiveLossReason,
  campaignToDeals,
  createDeal,
  createDealTask,
  createLossReason,
  createPipeline,
  createStage,
  deleteDeal,
  deleteDealNote,
  deleteDealTask,
  deletePipeline,
  deleteStage,
  ensureDefaultPipeline,
  getDeal,
  listDealEvents,
  listDealScheduledMessages,
  listDealTasks,
  listDeals,
  listLossReasons,
  listOpenDealsForContact,
  listPipelines,
  renamePipeline,
  scheduleDealMessage,
  setDealTags,
  setDealTaskDone,
  updateDeal,
  updateStage,
} from "../api/leads";
import type { CreateDealInput, Deal, DealPatch, TaskType } from "../types/leads";

export const leadsKeys = {
  all: ["leads"] as const,
  pipelines: (clinicId: string | null) => [...leadsKeys.all, "pipelines", clinicId] as const,
  lossReasons: (clinicId: string | null) => [...leadsKeys.all, "loss-reasons", clinicId] as const,
  deals: (pipelineId: string | null) => [...leadsKeys.all, "deals", pipelineId] as const,
  deal: (id: string | null) => [...leadsKeys.all, "deal", id] as const,
  events: (id: string | null) => [...leadsKeys.all, "events", id] as const,
  tasks: (id: string | null) => [...leadsKeys.all, "tasks", id] as const,
  messages: (id: string | null) => [...leadsKeys.all, "messages", id] as const,
  contactDeals: (contactId: string | null) => [...leadsKeys.all, "contact", contactId] as const,
};

// O quadro se atualiza sozinho (outros atendentes, lembretes, campanhas)
const BOARD_POLL_MS = 30000;

export const usePipelines = (clinicId: string | null) => {
  const query = useQuery({
    queryKey: leadsKeys.pipelines(clinicId),
    queryFn: async () => {
      let pipelines = await listPipelines(clinicId);
      // Empresa nova: cria o funil padrão na primeira visita
      if (pipelines.length === 0 && clinicId) {
        await ensureDefaultPipeline();
        pipelines = await listPipelines(clinicId);
      }
      return pipelines;
    },
    enabled: Boolean(clinicId),
    staleTime: 60000,
  });
  return {
    pipelines: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
};

export const useLossReasons = (clinicId: string | null) => {
  const query = useQuery({
    queryKey: leadsKeys.lossReasons(clinicId),
    queryFn: () => listLossReasons(clinicId),
    enabled: Boolean(clinicId),
    staleTime: 60000,
  });
  return query.data ?? [];
};

export const useDeals = (pipelineId: string | null) => {
  const query = useQuery({
    queryKey: leadsKeys.deals(pipelineId),
    queryFn: () => listDeals(pipelineId),
    enabled: Boolean(pipelineId),
    refetchInterval: BOARD_POLL_MS,
  });
  return {
    deals: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
};

export const useDeal = (id: string | null) => {
  const query = useQuery({
    queryKey: leadsKeys.deal(id),
    queryFn: () => getDeal(id as string),
    enabled: Boolean(id),
  });
  return { deal: query.data ?? null, loading: query.isLoading };
};

export const useDealEvents = (id: string | null) =>
  useQuery({
    queryKey: leadsKeys.events(id),
    queryFn: () => listDealEvents(id as string),
    enabled: Boolean(id),
  });

export const useDealTasks = (id: string | null) =>
  useQuery({
    queryKey: leadsKeys.tasks(id),
    queryFn: () => listDealTasks(id as string),
    enabled: Boolean(id),
  });

export const useDealMessages = (id: string | null) => {
  const query = useQuery({
    queryKey: leadsKeys.messages(id),
    queryFn: () => listDealScheduledMessages(id as string),
    enabled: Boolean(id),
    // Enquanto há mensagem para sair, acompanha o status
    refetchInterval: (q) =>
      (q.state.data ?? []).some((m) => m.status === "scheduled" || m.status === "processing")
        ? 15000
        : false,
  });
  return query.data ?? [];
};

export const useContactOpenDeals = (contactId: string | null) => {
  const query = useQuery({
    queryKey: leadsKeys.contactDeals(contactId),
    queryFn: () => listOpenDealsForContact(contactId as string),
    enabled: Boolean(contactId),
    staleTime: 30000,
  });
  return { deals: query.data ?? [], refetch: query.refetch };
};

export const useLeadActions = () => {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: leadsKeys.all });

  // Mover/editar com atualização otimista no quadro: o cartão muda na hora
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: DealPatch }) => updateDeal(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: [...leadsKeys.all, "deals"] });
      const snapshots = queryClient.getQueriesData<Deal[]>({ queryKey: [...leadsKeys.all, "deals"] });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        queryClient.setQueryData<Deal[]>(
          key,
          data.map((deal) =>
            deal.id === id
              ? {
                  ...deal,
                  ...(patch.stageId !== undefined ? { stageId: patch.stageId } : {}),
                  ...(patch.position !== undefined ? { position: patch.position } : {}),
                  ...(patch.title !== undefined ? { title: patch.title } : {}),
                  ...(patch.value !== undefined ? { value: patch.value } : {}),
                  ...(patch.ownerUserId !== undefined ? { ownerUserId: patch.ownerUserId } : {}),
                }
              : deal,
          ),
        );
      }
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: invalidate,
  });

  const create = useMutation({
    mutationFn: (input: CreateDealInput) => createDeal(input),
    onSettled: invalidate,
  });
  const remove = useMutation({ mutationFn: deleteDeal, onSettled: invalidate });
  const tags = useMutation({
    mutationFn: ({ dealId, current, next }: { dealId: string; current: string[]; next: string[] }) =>
      setDealTags(dealId, current, next),
    onSettled: invalidate,
  });
  const addNote = useMutation({
    mutationFn: ({ dealId, userId, note }: { dealId: string; userId: string; note: string }) =>
      addDealNote(dealId, userId, note),
    onSettled: invalidate,
  });
  const removeNote = useMutation({ mutationFn: deleteDealNote, onSettled: invalidate });
  const addTask = useMutation({
    mutationFn: (input: {
      dealId: string;
      title: string;
      taskType: TaskType;
      dueAt: string;
      assignedUserId: string | null;
    }) => createDealTask(input),
    onSettled: invalidate,
  });
  const toggleTask = useMutation({
    mutationFn: ({ taskId, done }: { taskId: string; done: boolean }) => setDealTaskDone(taskId, done),
    onSettled: invalidate,
  });
  const removeTask = useMutation({ mutationFn: deleteDealTask, onSettled: invalidate });
  const scheduleMessage = useMutation({
    mutationFn: scheduleDealMessage,
    onSettled: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
    },
  });
  const fromCampaign = useMutation({
    mutationFn: ({ campaignId, onlyReplied }: { campaignId: string; onlyReplied: boolean }) =>
      campaignToDeals(campaignId, onlyReplied),
    onSettled: invalidate,
  });

  return {
    updateDeal: update.mutateAsync,
    createDeal: create.mutateAsync,
    deleteDeal: remove.mutateAsync,
    setTags: tags.mutateAsync,
    addNote: addNote.mutateAsync,
    removeNote: removeNote.mutateAsync,
    addTask: addTask.mutateAsync,
    toggleTask: toggleTask.mutateAsync,
    removeTask: removeTask.mutateAsync,
    scheduleMessage: scheduleMessage.mutateAsync,
    campaignToDeals: fromCampaign.mutateAsync,
    creating: create.isPending,
    scheduling: scheduleMessage.isPending,
    movingFromCampaign: fromCampaign.isPending,
  };
};

export const usePipelineSettingsActions = () => {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: leadsKeys.all });
  const wrap = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A) => {
      try {
        return await fn(...args);
      } finally {
        invalidate();
      }
    };
  return {
    createPipeline: wrap(createPipeline),
    renamePipeline: wrap(renamePipeline),
    deletePipeline: wrap(deletePipeline),
    createStage: wrap(createStage),
    updateStage: wrap(updateStage),
    deleteStage: wrap(deleteStage),
    createLossReason: wrap(createLossReason),
    archiveLossReason: wrap(archiveLossReason),
  };
};

/** Abre um cartão vindo de ?deal=<id> (lembrete por push, link da conversa). */
export const useDealFromQuery = (
  search: string,
  onOpen: (dealId: string) => void,
) => {
  useEffect(() => {
    const id = new URLSearchParams(search).get("deal");
    if (id) onOpen(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
};
