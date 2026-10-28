import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteContactScheduledMessage,
  listContactScheduledMessages,
  saveContactScheduledMessage,
  setContactScheduledMessageStatus,
} from "../api/recurring";

const key = (contactId: string | null) => ["contact-scheduled-messages", contactId] as const;

export const useContactScheduledMessages = (contactId: string | null) => {
  const query = useQuery({
    queryKey: key(contactId),
    queryFn: () => listContactScheduledMessages(contactId as string),
    enabled: Boolean(contactId),
    // Acompanha o envio ("agora" sai em até 1 minuto)
    refetchInterval: 30000,
  });
  return {
    items: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
};

export const useContactScheduledActions = (contactId: string | null) => {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key(contactId) });

  const save = useMutation({ mutationFn: saveContactScheduledMessage, onSettled: invalidate });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "paused" }) =>
      setContactScheduledMessageStatus(id, status),
    onSettled: invalidate,
  });
  const remove = useMutation({ mutationFn: deleteContactScheduledMessage, onSettled: invalidate });

  return {
    save: save.mutateAsync,
    saving: save.isPending,
    setStatus: setStatus.mutateAsync,
    remove: remove.mutateAsync,
    busy: setStatus.isPending || remove.isPending,
  };
};
