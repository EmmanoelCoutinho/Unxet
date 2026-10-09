"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Conversation, Channel, Tag } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useClinic } from "../contexts/ClinicContext";

type UseConversationsOptions = {
  status?: string;
  channel?: string;
};

type DbMessage = {
  id: string;
  conversation_id: string;
  direction: string | null;
  text: string | null;
  sent_at: string | null;
  type?: string | null;
  payload?: any;
  created_at?: string | null;
};

const isAssignedToOther = (conversation: Conversation, userId: string) =>
  !!conversation.assignedTo && conversation.assignedTo !== userId;

export function useConversations(options: UseConversationsOptions = {}) {
  const { authUser, loading: authLoading } = useAuth();
  const { clinicId, membership } = useClinic();
  // Admin acompanha todas as conversas da empresa, inclusive as de outros atendentes
  const isAdmin = membership?.role === "admin";

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<any>(null);

  const lastRefetchAtRef = useRef(0);
  const refetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInitialLoadRef = useRef(false);

  const parsePayload = (raw: any) => {
    if (!raw) return {};
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    return raw ?? {};
  };

  const detectMediaType = (
    msg?: { type?: string | null; payload?: any },
    payload?: any,
  ): Conversation["lastMessageType"] => {
    const parsedPayload = payload ?? parsePayload(msg?.payload);
    const directType = msg?.type ?? parsedPayload?.type;
    const candidate =
      parsedPayload?.message ?? parsedPayload?.messages?.[0] ?? parsedPayload;

    const hasMedia = (key: string) =>
      directType === key ||
      candidate?.[key] ||
      parsedPayload?.[key] ||
      parsedPayload?.data?.[key];

    if (hasMedia("image")) return "image";
    if (hasMedia("audio")) return "audio";
    if (hasMedia("sticker")) return "sticker";
    if (hasMedia("video")) return "video";
    if (hasMedia("document")) return "document";

    if (directType) return directType as Conversation["lastMessageType"];
    return "text";
  };

  const getPreview = (msg?: {
    text: string | null;
    type?: string | null;
    payload?: any;
  }) => {
    if (!msg) {
      return { text: "", type: "text" as Conversation["lastMessageType"] };
    }

    const payload = parsePayload(msg.payload);
    const kind = detectMediaType(msg, payload);
    const text = msg.text ?? "";

    const fallback =
      kind === "image"
        ? "Imagem"
        : kind === "audio"
          ? "Áudio"
          : kind === "sticker"
            ? "Figurinha"
            : kind === "video"
              ? "Vídeo"
              : kind === "document"
                ? "Documento"
                : "Mensagem";

    return {
      text: text || fallback,
      type: kind,
    };
  };

  const getAccessibleDepartmentIds = useCallback(async (): Promise<string[]> => {
    if (!clinicId || !authUser) return [];

    const { data, error } = await supabase
      .from("department_members")
      .select("department_id")
      .eq("clinic_user_id", authUser.id);

    if (!error) {
      const ids = (data ?? []).map((r: any) => r.department_id).filter(Boolean);
      if (ids.length > 0) return ids;
    }

    return membership?.department_id ? [membership.department_id] : [];
  }, [authUser, clinicId, membership?.department_id]);

  const getAccessibleDeptIdsRef = useRef(getAccessibleDepartmentIds);
  useEffect(() => {
    getAccessibleDeptIdsRef.current = getAccessibleDepartmentIds;
  }, [getAccessibleDepartmentIds]);

  const scheduleRefetch = useCallback((fetcher: () => void) => {
    const cooldownMs = 2500;
    const now = Date.now();
    const elapsed = now - lastRefetchAtRef.current;

    if (elapsed >= cooldownMs) {
      lastRefetchAtRef.current = now;
      fetcher();
      return;
    }

    if (refetchTimeoutRef.current) return;

    refetchTimeoutRef.current = setTimeout(() => {
      lastRefetchAtRef.current = Date.now();
      refetchTimeoutRef.current = null;
      fetcher();
    }, cooldownMs - elapsed);
  }, []);

  const conversationsLengthRef = useRef(0);
  useEffect(() => {
    conversationsLengthRef.current = conversations.length;
  }, [conversations.length]);

  const fetchConversations = useCallback(
    async (opts?: { reason?: "initial" | "refetch" }) => {
      const reason =
        opts?.reason ?? (didInitialLoadRef.current ? "refetch" : "initial");

      if (!authUser || !clinicId) {
        setConversations([]);
        setError(null);
        setLoading(true);
        return;
      }

      const shouldShowHardLoading =
        reason === "initial" &&
        !didInitialLoadRef.current &&
        conversationsLengthRef.current === 0;

      if (shouldShowHardLoading) setLoading(true);
      else setRefreshing(true);

      setError(null);

      try {
        const accessibleDepartmentIds = isAdmin
          ? []
          : await getAccessibleDepartmentIds();

        if (!isAdmin && accessibleDepartmentIds.length === 0) {
          setConversations([]);
          return;
        }

        const baseSelect = `
          id,
          status,
          channel,
          channel_connections!inner (
            provider
          ),
          last_message_at,
          created_at,
          assigned_user_id,
          contacts:contact_id (*),
          messages (
            id,
            text,
            sent_at,
            created_at,
            direction,
            type,
            payload
          ),
          conversation_tags (
            tag_id,
            tags (
              id,
              name,
              color
            )
          )
        `;

        const makeBase = () => {
          let q = supabase
            .from("conversations")
            .select(baseSelect)
            .eq("clinic_id", clinicId);
          if (!isAdmin) q = q.in("department_id", accessibleDepartmentIds);
          return q
            .neq("status", "closed")
            .order("last_message_at", { ascending: false })
            // Só a última mensagem de cada conversa (prévia na lista)
            .order("sent_at", { referencedTable: "messages", ascending: false })
            .limit(1, { referencedTable: "messages" });
        };

        // Atendente vê só as abertas dele; admin vê as de todos
        const applyOpenOwner = (q: any) =>
          isAdmin ? q : q.eq("assigned_user_id", authUser.id);

        const applyChannel = (q: any) =>
          options.channel ? q.eq("channel", options.channel) : q;

        let data: any[] = [];

        if (options.status) {
          let q = applyChannel(makeBase()).eq("status", options.status);

          if (options.status === "open") {
            q = applyOpenOwner(q);
          }

          const res = await q;
          if (res.error) throw res.error;
          data = res.data ?? [];
        } else {
          const [openRes, pendingRes] = await Promise.all([
            applyOpenOwner(applyChannel(makeBase()).eq("status", "open")),
            applyChannel(makeBase()).eq("status", "pending"),
          ]);

          if (openRes.error) throw openRes.error;
          if (pendingRes.error) throw pendingRes.error;

          const map = new Map<string, any>();
          (openRes.data ?? []).forEach((r: any) => map.set(r.id, r));
          (pendingRes.data ?? []).forEach((r: any) => map.set(r.id, r));
          data = Array.from(map.values());

          data.sort(
            (a, b) =>
              new Date(b.last_message_at ?? 0).getTime() -
              new Date(a.last_message_at ?? 0).getTime(),
          );
        }

        let mapped: Conversation[] =
          data?.map((row: any) => {
            const messages = (row.messages as any[]) ?? [];

            const last = messages
              .slice()
              .sort(
                (a, b) =>
                  new Date(b.sent_at ?? b.created_at ?? 0).getTime() -
                  new Date(a.sent_at ?? a.created_at ?? 0).getTime(),
              )[0];

            const preview = getPreview(last);

            const rawContacts: any = row.contacts;
            const contactRow = Array.isArray(rawContacts)
              ? rawContacts[0]
              : rawContacts;

            const contactAvatar =
              contactRow?.avatar ??
              contactRow?.avatar_url ??
              contactRow?.photo_url ??
              contactRow?.profile_pic_url ??
              contactRow?.image_url;

            const ct = (row.conversation_tags as any[]) ?? [];
            const tags: Tag[] = ct
              .map((x) => x.tags)
              .flat()
              .filter(Boolean)
              .map((t: any) => ({
                id: t.id,
                name: t.name,
                color: t.color ?? "#0A84FF",
              }));

            return {
              id: row.id,
              channel: row.channel as Channel,
              status: row.status,
              provider: row.channel_connections?.provider,
              contactName:
                contactRow?.name ?? contactRow?.phone ?? "Contato sem nome",
              contactNumber: contactRow?.phone ?? "",
              contactAvatar: contactAvatar ?? undefined,

              lastMessage: preview.text,
              lastMessageType: preview.type,
              lastTimestamp:
                last?.sent_at ?? row.last_message_at ?? row.created_at ?? "",

              unreadCount: 0,

              tags,
              assignedTo: row.assigned_user_id ?? undefined,
            };
          }) ?? [];

        const ids = mapped.map((c) => c.id).filter(Boolean);

        if (ids.length > 0) {
          const { data: counts, error: countsError } = await supabase.rpc(
            "get_unread_counts",
            { p_user_id: authUser.id, p_conversation_ids: ids },
          );

          if (countsError) throw countsError;

          const countMap = new Map<string, number>();
          (counts ?? []).forEach((r: any) => {
            countMap.set(
              String(r.conversation_id),
              Number(r.unread_count ?? 0),
            );
          });

          mapped = mapped.map((c) => ({
            ...c,
            // Conversa de outro atendente não conta como não lida para o admin
            unreadCount: isAssignedToOther(c, authUser.id)
              ? 0
              : (countMap.get(c.id) ?? 0),
          }));
        }

        setConversations(mapped);
      } catch (err: any) {
        console.error("Erro ao buscar conversas (mantendo estado anterior):", err);
        setError(err);
        // Proteção essencial: não limpamos mais as conversas da tela se houver um erro de infraestrutura temporário.
      } finally {
        didInitialLoadRef.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      authUser,
      clinicId,
      isAdmin,
      getAccessibleDepartmentIds,
      options.status,
      options.channel,
    ],
  );

  const scheduleRefetchStable = useCallback(() => {
    scheduleRefetch(() => fetchConversations({ reason: "refetch" }));
  }, [fetchConversations, scheduleRefetch]);

  const scheduleRefetchRef = useRef(scheduleRefetchStable);
  useEffect(() => {
    scheduleRefetchRef.current = scheduleRefetchStable;
  }, [scheduleRefetchStable]);

  // realtime: tags
  useEffect(() => {
    if (!authUser) return;

    const reloadTagForConversation = async (conversationId: string) => {
      const { data, error } = await supabase
        .from("conversation_tags")
        .select("tags(id,name,color)")
        .eq("conversation_id", conversationId);

      if (error) {
        console.warn("[RT] erro ao recarregar tags:", error);
        return;
      }

      const tags: Tag[] = ((data as any[]) ?? [])
        .map((r) => r.tags)
        .flat()
        .filter(Boolean)
        .map((t: any) => ({
          id: t.id,
          name: t.name,
          color: t.color ?? "#0A84FF",
        }));

      setConversations((current) => {
        const idx = current.findIndex((c) => c.id === conversationId);
        if (idx === -1) {
          scheduleRefetchRef.current();
          return current;
        }

        const clone = [...current];
        clone[idx] = { ...clone[idx], tags };
        return clone;
      });
    };

    const channel = supabase
      .channel("inbox-conversation-tags-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_tags" },
        (payload) => {
          const conversationId =
            (payload.new as any)?.conversation_id ??
            (payload.old as any)?.conversation_id;

          if (!conversationId) return;
          reloadTagForConversation(conversationId);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authUser]);

  // realtime: update conversations
  useEffect(() => {
    if (!authUser || !clinicId) return;

    let active = true;
    let rtChannel: any = null;

    const initConversationsUpdateChannel = async () => {
      const accessibleDepartmentIds = isAdmin
        ? []
        : await getAccessibleDeptIdsRef.current();
      if (!active) return;

      if (!isAdmin && !accessibleDepartmentIds.length) {
        return;
      }

      const filter = `clinic_id=eq.${clinicId}`;

      rtChannel = supabase
        .channel(`inbox-conversations-updates:${clinicId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "conversations",
            filter,
          },
          (payload) => {
            const nextRow = payload.new as any;
            const prevRow = payload.old as any;

            const conversationId = String(nextRow?.id ?? prevRow?.id ?? "");
            if (!conversationId) return;

            const nextDept = nextRow?.department_id
              ? String(nextRow.department_id)
              : null;

            if (
              !isAdmin &&
              nextDept &&
              !accessibleDepartmentIds.includes(nextDept)
            ) {
              return;
            }

            setConversations((current) => {
              const idx = current.findIndex((c) => c.id === conversationId);

              if (String(nextRow?.status) === "closed") {
                if (idx === -1) return current;
                const clone = [...current];
                clone.splice(idx, 1);
                return clone;
              }

              if (idx === -1) {
                scheduleRefetchRef.current();
                return current;
              }

              const old = current[idx];

              const updated: Conversation = {
                ...old,
                status: nextRow?.status ?? old.status,
                assignedTo: nextRow?.assigned_user_id ?? undefined,
                lastTimestamp:
                  nextRow?.last_message_at ?? old.lastTimestamp ?? undefined,
              };

              const clone = [...current];
              clone[idx] = updated;

              clone.sort(
                (a, b) =>
                  new Date(b.lastTimestamp ?? 0).getTime() -
                  new Date(a.lastTimestamp ?? 0).getTime(),
              );

              return clone;
            });

            if (
              String(prevRow?.status ?? "") !== String(nextRow?.status ?? "") ||
              String(prevRow?.assigned_user_id ?? "") !==
                String(nextRow?.assigned_user_id ?? "")
            ) {
              scheduleRefetchRef.current();
            }
          },
        )
        .subscribe();
    };

    initConversationsUpdateChannel();

    return () => {
      active = false;
      if (rtChannel) supabase.removeChannel(rtChannel);
    };
  }, [authUser, clinicId, isAdmin]);

  // inicial
  useEffect(() => {
    if (authLoading) {
      if (!didInitialLoadRef.current && conversationsLengthRef.current === 0) {
        setLoading(true);
      }
      return;
    }

    fetchConversations({ reason: "initial" });
  }, [authLoading, fetchConversations]);

  useEffect(() => {
    return () => {
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
    };
  }, []);

  // realtime: mensagem nova
  useEffect(() => {
    if (!authUser) return;

    const channel = supabase
      .channel("inbox-conversations-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const msg = payload.new as DbMessage;
          if (!msg) return;

          const isInbound = msg.direction === "inbound";

          setConversations((current) => {
            const idx = current.findIndex((c) => c.id === msg.conversation_id);
            if (idx === -1) {
              // Só consulta o banco de dados se for uma mensagem de um cliente novo que não está na lista!
              if (isInbound) scheduleRefetchRef.current();
              return current;
            }

            const old = current[idx];
            const preview = getPreview(msg as any);

            const updated: Conversation = {
              ...old,
              lastMessage: preview.text || old.lastMessage,
              lastMessageType: preview.type ?? old.lastMessageType,
              lastTimestamp: msg.sent_at ?? msg.created_at ?? old.lastTimestamp,
              unreadCount:
                isInbound && !isAssignedToOther(old, authUser.id)
                ? (old.unreadCount ?? 0) + 1
                : (old.unreadCount ?? 0),
            };

            const clone = [...current];
            clone[idx] = updated;

            clone.sort(
              (a, b) =>
                new Date(b.lastTimestamp ?? 0).getTime() -
                new Date(a.lastTimestamp ?? 0).getTime(),
            );

            return clone;
          });

          // 🚀 SEGUNDA PROTEÇÃO: Só agenda refetch no banco se a mensagem for de entrada.
          // Mensagens enviadas pelo disparo (outbound) já atualizaram o estado local acima.
          if (isInbound) {
            scheduleRefetchRef.current();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authUser]);

  const markAsRead = useCallback(
    async (conversationId: string) => {
      if (!authUser) return;

      setConversations((current) =>
        current.map((c) =>
          c.id === conversationId ? { ...c, unreadCount: 0 } : c,
        ),
      );

      const { error } = await supabase.rpc("mark_conversation_read", {
        p_conversation_id: conversationId,
        p_user_id: authUser.id,
      });

      if (error) {
        console.warn("mark_conversation_read falhou:", error);
        scheduleRefetchRef.current();
      }
    },
    [authUser],
  );

  const totalUnreadCount = useMemo(() => {
    return conversations.reduce(
      (sum, conv) => sum + (conv.unreadCount || 0),
      0,
    );
  }, [conversations]);

  const totalUnreadOpen = useMemo(() => {
    return conversations
      .filter((conv) => conv.status === "open")
      .reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
  }, [conversations]);

  const totalUnreadPending = useMemo(() => {
    return conversations
      .filter((conv) => conv.status === "pending")
      .reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
  }, [conversations]);

  return {
    conversations,
    loading,
    refreshing,
    error,
    totalUnreadCount,
    totalUnreadOpen,
    totalUnreadPending,
    refetch: () => fetchConversations({ reason: "refetch" }),
    markAsRead,
  };
}