import { useCallback, useEffect, useState } from "react";
import type { ConversationEvent } from "../types";
import { supabase } from "../lib/supabaseClient";

type DbEvent = {
  id: string;
  conversation_id: string;
  event_type: string;
  created_at?: string | null;
  performed_by?: string | null;
  metadata?: any;
};

const safeParseMetadata = (raw: any) => {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw ?? {};
};

const mapDbEvent = (row: DbEvent): ConversationEvent => {
  const metadata = safeParseMetadata(row?.metadata);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    type: row.event_type,
    createdAt: row.created_at ?? new Date().toISOString(),
    performedBy: row.performed_by ?? null,
    performedByName: metadata?.performed_by_name ?? null,
    metadata,
  };
};

// Eventos já buscados por conversa: reabrir a conversa (caixa flutuante ↔
// tela cheia) mostra na hora e atualiza em segundo plano
const eventsCache = new Map<string, ConversationEvent[]>();

export function useConversationEvents(conversationId: string | null) {
  const [events, setEventsState] = useState<ConversationEvent[]>(
    () => (conversationId ? eventsCache.get(conversationId) : undefined) ?? [],
  );
  const [loading, setLoading] = useState(
    () => !(conversationId && eventsCache.has(conversationId)),
  );
  const [error, setError] = useState<any>(null);

  const setEvents = useCallback(
    (
      updater:
        | ConversationEvent[]
        | ((prev: ConversationEvent[]) => ConversationEvent[]),
    ) => {
      setEventsState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (conversationId) eventsCache.set(conversationId, next);
        return next;
      });
    },
    [conversationId],
  );

  const fetchEvents = useCallback(async () => {
    if (!conversationId) {
      setEventsState([]);
      setLoading(false);
      return;
    }

    const cached = eventsCache.get(conversationId);
    if (cached) {
      setEventsState(cached);
      setLoading(false);
    } else {
      setEventsState([]);
      setLoading(true);
    }
    setError(null);

    const { data, error } = await supabase
      .from("conversation_events")
      .select(
        `
          id,
          conversation_id,
          event_type,
          created_at,
          performed_by,
          metadata
        `,
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Erro ao buscar eventos da conversa:", error);
      setError(error);
      setLoading(false);
      return;
    }

    const mapped = (data ?? []).map((row) => mapDbEvent(row as DbEvent));
    setEvents(mapped);
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`conversation-events-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_events",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newEvent = mapDbEvent(payload.new as DbEvent);
          setEvents((current) => {
            if (current.some((e) => e.id === newEvent.id)) return current;
            return [...current, newEvent];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  return { events, loading, error, refetch: fetchEvents, setEvents };
}
