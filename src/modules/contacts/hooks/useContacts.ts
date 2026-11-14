import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContactNote,
  deleteContactNote,
  getContact,
  getContactMetrics,
  listContactNotes,
  listContacts,
  updateContact,
} from "../api/contacts";
import type { ContactListFilters } from "../types/contacts";

/** Salva nome, telefone e e-mail do cliente e atualiza a Carteira. */
export const useUpdateContact = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: updateContact,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      // Conversas, funil e agendamentos mostram o nome do cliente
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
  return { save: mutation.mutateAsync, saving: mutation.isPending };
};

export const contactQueryKeys = {
  all: ["contacts"] as const,
  lists: () => [...contactQueryKeys.all, "list"] as const,
  list: (tenantId: string | null, filters: ContactListFilters) =>
    [...contactQueryKeys.lists(), tenantId, filters] as const,
  detail: (tenantId: string | null, contactId: string | null) =>
    [...contactQueryKeys.all, "detail", tenantId, contactId] as const,
  metrics: (tenantId: string | null) =>
    [...contactQueryKeys.all, "metrics", tenantId] as const,
  notes: (tenantId: string | null, contactId: string | null) =>
    [...contactQueryKeys.all, "notes", tenantId, contactId] as const,
};

export const useContacts = (
  tenantId: string | null,
  filters: ContactListFilters,
) => {
  const query = useQuery({
    queryKey: contactQueryKeys.list(tenantId, filters),
    queryFn: () => listContacts(tenantId, filters),
  });

  return {
    contacts: query.data?.contacts ?? [],
    total: query.data?.total ?? 0,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
    queryKey: contactQueryKeys.list(tenantId, filters),
  };
};

/** Um cliente pelo id (pode estar fora da página atual da lista). */
export const useContact = (
  tenantId: string | null,
  contactId: string | null,
) => {
  const query = useQuery({
    queryKey: contactQueryKeys.detail(tenantId, contactId),
    queryFn: () => getContact(tenantId, contactId),
    enabled: Boolean(tenantId && contactId),
  });

  return {
    contact: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
};

export const useContactMetrics = (tenantId: string | null) => {
  const query = useQuery({
    queryKey: contactQueryKeys.metrics(tenantId),
    queryFn: () => getContactMetrics(tenantId),
  });

  return {
    metrics: query.data ?? {
      total: 0,
      active: 0,
      inactive7Days: 0,
      inactive30Days: 0,
    },
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
    queryKey: contactQueryKeys.metrics(tenantId),
  };
};

export const useContactNotes = (
  tenantId: string | null,
  contactId: string | null,
) => {
  const queryClient = useQueryClient();
  const queryKey = contactQueryKeys.notes(tenantId, contactId);

  const query = useQuery({
    queryKey,
    queryFn: () => listContactNotes(tenantId, contactId),
    enabled: Boolean(contactId),
  });

  const createMutation = useMutation({
    mutationFn: ({ userId, note }: { userId: string; note: string }) => {
      if (!contactId) throw new Error("Contato não selecionado.");
      return createContactNote(tenantId, { contactId, userId, note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => deleteContactNote(tenantId, noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    notes: query.data ?? [],
    loading: query.isLoading,
    saving: createMutation.isPending || deleteMutation.isPending,
    error:
      query.error instanceof Error
        ? query.error.message
        : createMutation.error instanceof Error
          ? createMutation.error.message
          : deleteMutation.error instanceof Error
            ? deleteMutation.error.message
            : null,
    refetch: query.refetch,
    createNote: (userId: string, note: string) =>
      createMutation.mutateAsync({ userId, note }),
    deleteNote: (noteId: string) => deleteMutation.mutateAsync(noteId),
    queryKey,
  };
};
