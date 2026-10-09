import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { toast } from "react-toastify";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../contexts/ClinicContext";
import type { Conversation, Message, Channel } from "../types";
import {
  useMessages,
  mapDbMessage,
  DELETED_MESSAGE_TEXT,
  isLocalOptimisticId,
  sortMessages,
} from "../hooks/useMessages";
import { useConversationEvents } from "../hooks/useConversationEvents";
import { useQuickMessages } from "../hooks/useQuickMessages";
import { Button } from "../components/ui/Button";
import { ChatHeader } from "../components/chat/ChatHeader";
import { MessageBubble } from "../components/chat/MessageBubble";
import { SystemEventBubble } from "../components/chat/SystemEventBubble";
import { MessageInput } from "../components/chat/MessageInput";
import { ArrowDownIcon, ArrowLeftIcon } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { TransferModal } from "../components/chat/TransferModal";

type UiTag = { id: string; name: string; color: string };

type SendableInput =
  | string
  | {
      type: "text" | "image" | "audio" | "document";
      text?: string;
      mediaUrl?: string;
      mediaMimeType?: string;
      filename?: string;
      fileSize?: number;
    };

type LocalSendStatus = "sending" | "failed" | "sent";

type LocalPayload = {
  type: "text" | "image" | "audio" | "document";
  text?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  filename?: string;
  fileSize?: number;
};

type LocalMessageMeta = {
  localStatus?: LocalSendStatus;
  localError?: string | null;
  localPayload?: LocalPayload;
};

const HOURS_24_MS = 24 * 60 * 60 * 1000;
const RETRY_AUDIO_TRANSCRIPT_FUNCTION = "retry-audio-transcript";

function getLastInboundClientAt(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.direction === "inbound") return m.createdAt;
  }
  return null;
}

// Mais recente entre a coluna last_inbound_at da conversa e as mensagens
// carregadas: com paginação, a última mensagem do cliente pode não estar
// entre as mensagens exibidas
function latestIso(...values: Array<string | null | undefined>) {
  let best: string | null = null;
  let bestTime = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && time > bestTime) {
      best = value;
      bestTime = time;
    }
  }
  return best;
}

function isInside24hWindow(lastInboundAtIso: string | null) {
  if (!lastInboundAtIso) return false;
  const last = new Date(lastInboundAtIso).getTime();
  if (Number.isNaN(last)) return false;
  return Date.now() - last <= HOURS_24_MS;
}

function get24hBlockMessage(channel: Channel) {
  if (channel === "whatsapp") {
    return "Não foi possível enviar: no WhatsApp, após 24h da última mensagem do cliente, só é permitido enviar mensagens por template aprovado.";
  }

  return "Não foi possível enviar: essa conversa está fora da janela de atendimento. Envie um template (quando aplicável) ou aguarde o cliente responder.";
}

function formatRecordTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getSendFunctionName(channel: string, provider?: string) {
  switch (channel) {
    case "whatsapp": {
      switch (provider) {
        case "meta":
          return "send-whatsapp-message";

        case "evolution":
          return "send-evoluation-message";

        default:
          throw new Error(`Unsupported WhatsApp provider: ${provider}`);
      }
    }

    case "instagram":
    case "messenger":
      return "send-meta-message";

    default:
      throw new Error(`Unsupported channel: ${channel}`);
  }
}

function normalizeInput(input: SendableInput) {
  let bodyText = "";
  let outboundType: "text" | "image" | "audio" | "document" = "text";
  let mediaUrl: string | undefined;
  let mediaMimeType: string | undefined;
  let filename: string | undefined;
  let fileSize: number | undefined;

  if (typeof input === "string") {
    bodyText = input.trim();
    outboundType = "text";
  } else {
    outboundType = input.type;
    bodyText = (input.text ?? "").trim();
    mediaUrl = input.mediaUrl;
    mediaMimeType = input.mediaMimeType;
    filename = input.filename;
    fileSize = input.fileSize;
  }

  return {
    bodyText,
    outboundType,
    mediaUrl,
    mediaMimeType,
    filename,
    fileSize,
  };
}

export const Chat: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { authUser } = useAuth();
  const { clinicId, membership } = useClinic();
  const departmentId = membership?.department_id ?? null;

  const didInitialConversationLoadRef = useRef(false);
  const activeRouteConversationIdRef = useRef<string | undefined>(id);
  const conversationLoadRequestRef = useRef(0);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const justOpenedRef = useRef(true);
  // Posição da rolagem antes de carregar mensagens antigas (para restaurar)
  const pendingScrollRestoreRef = useRef<{ height: number; top: number } | null>(
    null,
  );

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(true);
  const [draftMessage, setDraftMessage] = useState("");
  const [recordingUiState, setRecordingUiState] = useState({
    isRecording: false,
    isSendingAudio: false,
    recordSeconds: 0,
  });

  const [isManageTagsOpen, setIsManageTagsOpen] = useState(false);
  const [availableTags, setAvailableTags] = useState<UiTag[]>([]);
  const [selectedTags, setSelectedTags] = useState<UiTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsSavingId, setTagsSavingId] = useState<string | null>(null);
  const [acceptingConversation, setAcceptingConversation] = useState(false);
  const [closingConversation, setClosingConversation] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferringConversation, setTransferringConversation] =
    useState(false);

  const {
    messages,
    loading: loadingMessages,
    setMessages,
    hasMore: hasOlderMessages,
    loadingOlder: loadingOlderMessages,
    loadOlder: loadOlderMessages,
  } = useMessages(id ?? null);

  const { quickMessages, loading: loadingQuickMessages } = useQuickMessages(
    clinicId,
    {
      enabled: Boolean(clinicId),
    },
  );

  const {
    events,
    loading: loadingEvents,
    error: eventsError,
  } = useConversationEvents(id ?? null);

  const getAccessibleDepartmentIds = useCallback(async (): Promise<
    string[]
  > => {
    if (!clinicId || !authUser) return [];

    const { data, error } = await supabase
      .from("department_members")
      .select("department_id")
      .eq("clinic_user_id", authUser.id);

    if (!error) {
      const ids = (data ?? [])
        .map((row: any) => row.department_id)
        .filter(Boolean);
      if (ids.length > 0) return ids;
    }

    return membership?.department_id ? [membership.department_id] : [];
  }, [authUser, clinicId, membership?.department_id]);

  const timelineItems = useMemo(() => {
    const messageItems = messages.map((message) => ({
      kind: "message" as const,
      message,
      // Mensagens ainda não confirmadas ficam no fim, na ordem de envio
      sortAt: isLocalOptimisticId(message.id)
        ? Number.MAX_SAFE_INTEGER
        : new Date(message.createdAt).getTime(),
    }));
    // Com mensagens antigas ainda não carregadas, eventos anteriores à mensagem
    // mais antiga exibida ficariam soltos no topo: aparecem junto da página
    const oldestMessageAt = messageItems.find(
      (item) => item.sortAt !== Number.MAX_SAFE_INTEGER,
    )?.sortAt;
    const eventItems = events
      .map((event) => ({
        kind: "event" as const,
        event,
        sortAt: new Date(event.createdAt).getTime(),
      }))
      .filter(
        (item) =>
          !hasOlderMessages ||
          oldestMessageAt === undefined ||
          item.sortAt >= oldestMessageAt,
      );

    return [...messageItems, ...eventItems].sort((a, b) => a.sortAt - b.sortAt);
  }, [messages, events, hasOlderMessages]);

  // Chave do último item: muda quando chega mensagem nova no fim, mas não
  // quando mensagens antigas entram no topo
  const lastTimelineKey = useMemo(() => {
    const last = timelineItems[timelineItems.length - 1];
    if (!last) return null;
    return last.kind === "message" ? `m:${last.message.id}` : `e:${last.event.id}`;
  }, [timelineItems]);

  const loadingTimeline = loadingMessages || loadingEvents;

  useEffect(() => {
    activeRouteConversationIdRef.current = id;
    setShowScrollToBottom(false);
    justOpenedRef.current = true;
    didInitialConversationLoadRef.current = false;
    setConversation(null);
    setSelectedTags([]);
    setAvailableTags([]);
    setLoadingConversation(true);
    setDraftMessage("");
    setRecordingUiState({
      isRecording: false,
      isSendingAudio: false,
      recordSeconds: 0,
    });
  }, [id]);

  const getContainerMetrics = () => {
    const container = messagesContainerRef.current;
    if (!container) return null;

    const fullHeight = container.scrollHeight;
    const visibleHeight = container.clientHeight;
    const currentScrollTop = container.scrollTop;
    const scrollable = fullHeight > visibleHeight + 5;

    return {
      context: "container" as const,
      el: container,
      fullHeight,
      visibleHeight,
      currentScrollTop,
      scrollable,
    };
  };

  const getWindowMetrics = () => {
    const doc = document.documentElement;
    const fullHeight = doc.scrollHeight;
    const visibleHeight = window.innerHeight;
    const currentScrollTop = window.scrollY || doc.scrollTop || 0;
    const scrollable = fullHeight > visibleHeight + 5;

    return {
      context: "window" as const,
      fullHeight,
      visibleHeight,
      currentScrollTop,
      scrollable,
    };
  };

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const containerMetrics = getContainerMetrics();
    const windowMetrics = getWindowMetrics();

    const useContainer =
      containerMetrics && containerMetrics.scrollable ? true : false;
    const useWindow = !useContainer && windowMetrics.scrollable ? true : false;

    if (useContainer && containerMetrics) {
      const { el, fullHeight, visibleHeight } = containerMetrics;
      const maxScrollTop = fullHeight - visibleHeight;
      const target = maxScrollTop > 0 ? maxScrollTop : 0;

      el.scrollTo({
        top: target,
        behavior,
      });
    } else if (useWindow && windowMetrics) {
      const { fullHeight, visibleHeight } = windowMetrics;
      const maxScrollTop = fullHeight - visibleHeight;
      const target = maxScrollTop > 0 ? maxScrollTop : 0;

      window.scrollTo({
        top: target,
        behavior,
      });
    }

    setShowScrollToBottom(false);
  }, []);

  useLayoutEffect(() => {
    if (loadingTimeline) return;
    if (!timelineItems.length) return;
    if (!justOpenedRef.current) return;

    justOpenedRef.current = false;

    scrollToBottom("auto");

    setTimeout(() => {
      scrollToBottom("auto");
    }, 0);

    setTimeout(() => {
      scrollToBottom("auto");
    }, 100);
  }, [loadingTimeline, timelineItems.length, scrollToBottom]);

  const requestOlderMessages = useCallback(() => {
    if (!hasOlderMessages || loadingOlderMessages || loadingMessages) return;
    const container = messagesContainerRef.current;
    if (container) {
      pendingScrollRestoreRef.current = {
        height: container.scrollHeight,
        top: container.scrollTop,
      };
    }
    void loadOlderMessages();
  }, [hasOlderMessages, loadingOlderMessages, loadingMessages, loadOlderMessages]);

  // handleScrollCheck é estável (sem dependências); lê a versão atual pela ref
  const requestOlderMessagesRef = useRef(requestOlderMessages);
  useEffect(() => {
    requestOlderMessagesRef.current = requestOlderMessages;
  }, [requestOlderMessages]);

  const handleScrollCheck = useCallback(() => {
    const containerMetrics = getContainerMetrics();
    const windowMetrics = getWindowMetrics();

    const useContainer =
      containerMetrics && containerMetrics.scrollable ? true : false;
    const useWindow = !useContainer && windowMetrics.scrollable ? true : false;

    if (useContainer && containerMetrics) {
      const { fullHeight, visibleHeight, currentScrollTop } = containerMetrics;
      const distanceToBottom = fullHeight - (currentScrollTop + visibleHeight);

      setShowScrollToBottom(distanceToBottom > 40);

      // Perto do topo: carrega a página anterior
      if (currentScrollTop < 120) requestOlderMessagesRef.current();
    } else if (useWindow && windowMetrics) {
      const { fullHeight, visibleHeight, currentScrollTop } = windowMetrics;
      const distanceToBottom = fullHeight - (currentScrollTop + visibleHeight);

      setShowScrollToBottom(distanceToBottom > 40);
    } else {
      setShowScrollToBottom(false);
    }
  }, []);

  const reloadConversationTags = useCallback(async (conversationId: string) => {
    const { data, error } = await supabase
      .from("conversation_tags")
      .select("tags(id,name,color)")
      .eq("conversation_id", conversationId);

    if (error) return;
    if (activeRouteConversationIdRef.current !== conversationId) return;

    const mapped: UiTag[] = ((data as any[]) ?? [])
      .map((r) => (r as any).tags)
      .flat()
      .filter(Boolean)
      .map((t: any) => ({
        id: t.id,
        name: t.name,
        color: t.color ?? "#0A84FF",
      }));

    setSelectedTags(mapped);

    setConversation((prev) =>
      prev ? ({ ...prev, tag: mapped[0]?.name as any } as any) : prev,
    );
  }, []);

  const loadConversation = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = !!opts?.silent;
      const requestedId = id;
      const requestId = ++conversationLoadRequestRef.current;

      if (!requestedId) return;
      if (!clinicId) {
        if (
          requestId !== conversationLoadRequestRef.current ||
          activeRouteConversationIdRef.current !== requestedId
        ) {
          return;
        }
        setConversation(null);
        setLoadingConversation(true);
        return;
      }

      const shouldHardLoad =
        !silent && !didInitialConversationLoadRef.current && !conversation;

      if (shouldHardLoad) setLoadingConversation(true);

      const accessibleDepartmentIds = await getAccessibleDepartmentIds();
      if (accessibleDepartmentIds.length === 0) {
        if (
          requestId !== conversationLoadRequestRef.current ||
          activeRouteConversationIdRef.current !== requestedId
        ) {
          return;
        }
        setConversation(null);
        setLoadingConversation(false);
        didInitialConversationLoadRef.current = true;
        return;
      }

      const { data, error } = await supabase
        .from("conversations")
        .select(
          `
        id,
        status,
        channel,
        channel_connections (
          provider
        ),
        last_message_at,
        created_at,
        assigned_user_id,
        contacts:contact_id (*),
        last_inbound_at,
        messages (
          id,
          text,
          sent_at,
          direction,
          type
        ),
        clinic_id,
        department_id,
        conversation_tags (
          tag_id,
          tags (
            id,
            name,
            color
          )
        )
      `,
        )
        .eq("id", requestedId)
        .eq("clinic_id", clinicId)
        .in("department_id", accessibleDepartmentIds)
        // Só a última mensagem (prévia); a lista completa vem paginada
        .order("sent_at", { referencedTable: "messages", ascending: false })
        .limit(1, { referencedTable: "messages" })
        .maybeSingle();

      if (
        requestId !== conversationLoadRequestRef.current ||
        activeRouteConversationIdRef.current !== requestedId
      ) {
        return;
      }

      if (error) {
        console.error("Erro ao buscar conversa:", error);
        setLoadingConversation(false);
        didInitialConversationLoadRef.current = true;
        return;
      }

      if (!data) {
        setConversation(null);
        setLoadingConversation(false);
        didInitialConversationLoadRef.current = true;
        return;
      }

      const messagesRows =
        (data.messages as {
          id: string;
          text: string | null;
          sent_at: string | null;
          direction: string | null;
          type?: string | null;
        }[]) ?? [];

      const last = messagesRows[0];

      const rawContacts: any = (data as any).contacts;
      const contactRow = Array.isArray(rawContacts)
        ? rawContacts[0]
        : rawContacts;
      const contactAvatar =
        contactRow?.avatar ??
        contactRow?.avatar_url ??
        contactRow?.photo_url ??
        contactRow?.profile_pic_url ??
        contactRow?.image_url;

      const ct = ((data as any).conversation_tags as any[]) ?? [];
      const tagsFromConv: UiTag[] = ct
        .map((row) => row?.tags)
        .flat()
        .filter(Boolean)
        .map((t: any) => ({
          id: t.id,
          name: t.name,
          color: t.color ?? "#0A84FF",
        }));

      const mappedConversation: Conversation = {
        id: (data as any).id,
        clinicId: (data as any).clinic_id ?? undefined,
        channel: (data as any).channel as Channel,
        status: ((data as any).status as Conversation["status"]) ?? "pending",
        provider: (data as any).channel_connections?.provider ?? undefined,
        contactName:
          contactRow?.name ?? contactRow?.phone ?? "Contato sem nome",
        contactNumber: contactRow?.phone ?? "",
        contactAvatar: contactAvatar ?? undefined,
        lastMessage: last?.text ?? "",
        lastMessageType: (last as any)?.type ?? "text",
        lastTimestamp:
          last?.sent_at ??
          (data as any).last_message_at ??
          new Date().toISOString(),
        unreadCount: 0,
        tags: tagsFromConv,
        assignedTo: (data as any).assigned_user_id ?? undefined,
        lastInboundAt: (data as any).last_inbound_at ?? undefined,
      };

      setSelectedTags(tagsFromConv);
      setConversation(mappedConversation);

      setLoadingConversation(false);
      didInitialConversationLoadRef.current = true;
    },
    [id, clinicId, getAccessibleDepartmentIds],
  );

  useEffect(() => {
    handleScrollCheck();
  }, [timelineItems.length, handleScrollCheck]);

  useEffect(() => {
    if (loadingTimeline || !lastTimelineKey) return;
    scrollToBottom("auto");
  }, [loadingTimeline, lastTimelineKey, scrollToBottom]);

  // Mantém na tela a mesma mensagem depois de inserir as antigas no topo
  useLayoutEffect(() => {
    const pending = pendingScrollRestoreRef.current;
    const container = messagesContainerRef.current;
    if (!pending || !container || loadingOlderMessages) return;
    pendingScrollRestoreRef.current = null;
    container.scrollTop = container.scrollHeight - pending.height + pending.top;
  }, [timelineItems, loadingOlderMessages]);

  useEffect(() => {
    const onWindowScroll = () => handleScrollCheck();
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    return () => window.removeEventListener("scroll", onWindowScroll);
  }, [handleScrollCheck]);

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  useEffect(() => {
    const cid = (conversation as any)?.clinicId as string | undefined;
    if (!cid) return;

    const fetchClinicTags = async () => {
      setTagsLoading(true);

      const { data, error } = await supabase
        .from("tags")
        .select("id,name,color,clinic_id")
        .eq("clinic_id", cid)
        .order("created_at", { ascending: false });

      if (!error) {
        const mapped: UiTag[] = ((data as any[]) ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color ?? "#0A84FF",
        }));
        setAvailableTags(mapped);
      }

      setTagsLoading(false);
    };

    fetchClinicTags();
  }, [conversation?.clinicId]);

  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`rt:conversations:${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${id}`,
        },
        () => {
          loadConversation({ silent: true });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, loadConversation]);

  useEffect(() => {
    if (!conversation?.id) return;

    reloadConversationTags(conversation.id);

    const channel = supabase
      .channel(`rt:conversation_tags:${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_tags",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        () => reloadConversationTags(conversation.id),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.id, reloadConversationTags]);

  const handleAcceptConversation = useCallback(async () => {
    if (!id) return;

    setAcceptingConversation(true);

    const { data, error } = await supabase.functions.invoke(
      "accept-conversation",
      {
        body: { conversationId: id },
      },
    );

    if (error) {
      console.error("Erro ao aceitar conversa:", error);
      setAcceptingConversation(false);
      return;
    }

    const updated = (data as any)?.conversation;
    if (updated) {
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              status: updated.status,
              assignedTo: updated.assigned_user_id ?? undefined,
            }
          : prev,
      );
    }

    await loadConversation();

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("inbox:tab", { detail: "open" }));
    }
    setAcceptingConversation(false);
  }, [id, loadConversation]);

  const handleCloseConversation = useCallback(async () => {
    if (!id) return;

    setClosingConversation(true);

    const { data, error } = await supabase.functions.invoke(
      "close-conversation",
      {
        body: { conversationId: id },
      },
    );

    if (error) {
      console.error("Erro ao finalizar conversa:", error);
      toast.error("Não foi possível finalizar o atendimento.");
      setClosingConversation(false);
      return;
    }

    const updated = (data as any)?.conversation;
    if (updated) {
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              status: updated.status,
              assignedTo: updated.assigned_user_id ?? undefined,
            }
          : prev,
      );
    }

    toast.success("Atendimento encerrado.");
    setClosingConversation(false);

    navigate("/inbox");
  }, [id, navigate]);

  const handleTransferConversation = useCallback(
    async (target: { departmentId: string }) => {
      if (!id) return;
      if (!target.departmentId) return;

      setTransferringConversation(true);

      const { error } = await supabase.functions.invoke(
        "transfer-conversation",
        {
          body: {
            conversationId: id,
            toDepartmentId: target.departmentId,
          },
        },
      );

      if (error) {
        console.error("Erro ao transferir conversa:", error);
        setTransferringConversation(false);
        return;
      }

      setIsTransferOpen(false);
      setTransferringConversation(false);

      navigate("/inbox");
    },
    [id, navigate],
  );

  const addTagToConversation = async (
    conversationId: string,
    tagId: string,
  ) => {
    const { error } = await supabase
      .from("conversation_tags")
      .insert({ conversation_id: conversationId, tag_id: tagId });

    if (error) throw error;
  };

  const removeTagFromConversation = async (
    conversationId: string,
    tagId: string,
  ) => {
    const { error } = await supabase
      .from("conversation_tags")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("tag_id", tagId);

    if (error) throw error;
  };

  const toggleConversationTag = async (tag: UiTag) => {
    if (!conversation?.id) return;

    const isSelected = selectedTags.some((t) => t.id === tag.id);
    setTagsSavingId(tag.id);

    try {
      if (isSelected) {
        await removeTagFromConversation(conversation.id, tag.id);
        setSelectedTags((prev) => prev.filter((t) => t.id !== tag.id));
      } else {
        await addTagToConversation(conversation.id, tag.id);
        setSelectedTags((prev) => [tag, ...prev]);
      }

      const nextFirst = !isSelected
        ? tag.name
        : selectedTags.filter((t) => t.id !== tag.id)[0]?.name;
      setConversation((prev) =>
        prev ? ({ ...prev, tag: nextFirst as any } as any) : prev,
      );
    } finally {
      setTagsSavingId(null);
    }
  };

  const canReply = useMemo(() => {
    if (!authUser || !conversation) return false;

    if (conversation.assignedTo) {
      return conversation.assignedTo === authUser.id;
    }

    return true;
  }, [authUser, conversation]);

  const createSendNonce = useCallback(async (conversationId: string) => {
    const { data, error } = await supabase.functions.invoke(
      "create-send-nonce",
      {
        body: { conversationId },
      },
    );

    if (error) {
      console.error("create-send-nonce error:", error);
      throw error;
    }

    const nonce = (data as any)?.nonce ?? null;
    if (!nonce) {
      throw new Error("create-send-nonce não retornou nonce");
    }

    return nonce as string;
  }, []);

  const markLocalMessage = useCallback(
    (tempId: string, patch: Partial<LocalMessageMeta>) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? ({ ...m, ...(patch as any) } as any) : m,
        ),
      );
    },
    [setMessages],
  );

  const sendNow = useCallback(
    async (opts: {
      tempId: string;
      input: SendableInput;
      isRetry?: boolean;
    }) => {
      if (!id) return;
      if (!conversation?.channel) return;
      if (!canReply) return;

      const { tempId, input } = opts;

      const lastInboundAt = latestIso(
        conversation.lastInboundAt,
        getLastInboundClientAt(messages),
      );

      const isMetaProvider = conversation.provider === "meta";
      const canSend = !isMetaProvider || isInside24hWindow(lastInboundAt);

      if (!canSend) {
        markLocalMessage(tempId, {
          localStatus: "failed",
          localError: get24hBlockMessage(conversation.channel),
        });

        toast.info(get24hBlockMessage(conversation.channel), {
          autoClose: 4500,
        });

        return;
      }

      const {
        bodyText,
        outboundType,
        mediaUrl,
        mediaMimeType,
        filename,
        fileSize,
      } = normalizeInput(input);

      if (!bodyText && !mediaUrl) {
        markLocalMessage(tempId, {
          localStatus: "failed",
          localError: "Nada para enviar.",
        });
        return;
      }

      const functionName = getSendFunctionName(
        conversation.channel,
        conversation.provider,
      );
      if (!functionName) {
        markLocalMessage(tempId, {
          localStatus: "failed",
          localError: "Canal não suportado para envio.",
        });
        return;
      }

      markLocalMessage(tempId, { localStatus: "sending", localError: null });

      let nonce: string;
      try {
        nonce = await createSendNonce(id);
      } catch (e: any) {
        console.error("Falha ao gerar nonce:", e);
        markLocalMessage(tempId, {
          localStatus: "failed",
          localError: "Falha ao preparar envio. Reenviar.",
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke(functionName, {
        body: {
          nonce,
          conversationId: id,
          text: bodyText,
          type: outboundType,
          mediaUrl,
          mediaMimeType,
          filename,
          fileSize,
        },
      });

      if (error) {
        console.error(`Erro ao enviar mensagem (${functionName}):`, error);
        markLocalMessage(tempId, {
          localStatus: "failed",
          localError: "Falha ao enviar. Reenviar.",
        });
        toast.error("Não foi possível enviar a mensagem.");
        return;
      }

      const inserted = (data as any)?.message;
      if (!inserted) {
        console.warn(
          `Envio concluído sem mensagem persistida imediata (${functionName}). Aguardando sincronização pelo realtime.`,
          data,
        );
        markLocalMessage(tempId, {
          localStatus: "sent",
          localError: null,
        });
        return;
      }

      if (outboundType === "document" && filename && inserted.id) {
        const { error: filenameError } = await supabase
          .from("messages")
          .update({ filename })
          .eq("id", inserted.id);

        if (filenameError) {
          console.warn("Persist filename failed:", filenameError);
        }
      }

      const persisted: Message = mapDbMessage(inserted);

      setMessages((prev) => {
        const optimistic = prev.find((m) => m.id === tempId);

        const merged: Message = {
          ...persisted,
          filename: persisted.filename ?? optimistic?.filename,
          fileSize: persisted.fileSize ?? optimistic?.fileSize,
          mediaUrl: persisted.mediaUrl ?? optimistic?.mediaUrl,
          mediaMimeType: persisted.mediaMimeType ?? optimistic?.mediaMimeType,
          text: persisted.text,
        };

        const withoutTemp = prev.filter((m) => m.id !== tempId);
        const idx = withoutTemp.findIndex((m) => m.id === merged.id);
        if (idx >= 0) {
          const next = [...withoutTemp];
          next[idx] = { ...next[idx], ...merged };
          return sortMessages(next);
        }
        return sortMessages([...withoutTemp, merged]);
      });

      scrollToBottom("smooth");
    },
    [
      id,
      conversation?.channel,
      canReply,
      messages,
      createSendNonce,
      markLocalMessage,
      setMessages,
      scrollToBottom,
      conversation,
    ],
  );

  // Fila de envio por conversa: cada mensagem só sai depois que a anterior
  // terminou. Sem isso, "oi" e "tudo bem?" iam em paralelo e podiam chegar
  // ao provedor/banco na ordem trocada.
  const sendQueuesRef = useRef(new Map<string, Promise<void>>());

  const enqueueSend = useCallback(
    (conversationId: string, job: () => Promise<void>) => {
      const queues = sendQueuesRef.current;
      const run = (queues.get(conversationId) ?? Promise.resolve())
        .then(job)
        .catch((e) => {
          console.error("Erro na fila de envio:", e);
        });
      queues.set(conversationId, run);
      run.finally(() => {
        if (queues.get(conversationId) === run) queues.delete(conversationId);
      });
      return run;
    },
    [],
  );

  const handleSendMessage = async (input: SendableInput) => {
    if (!id) return;
    if (!conversation?.channel) return;
    if (!canReply) return;

    const {
      bodyText,
      outboundType,
      mediaUrl,
      mediaMimeType,
      filename,
      fileSize,
    } = normalizeInput(input);

    if (!bodyText && !mediaUrl) return;

    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const optimistic: Message & LocalMessageMeta = {
      id: tempId,
      conversationId: id,
      author: "atendente",
      direction: "outbound",
      text: bodyText,
      createdAt: new Date().toISOString(),
      type: outboundType,
      mediaUrl,
      mediaMimeType,
      filename,
      fileSize,

      localStatus: "sending",
      localError: null,
      localPayload: {
        type: outboundType,
        text: bodyText,
        mediaUrl,
        mediaMimeType,
        filename,
        fileSize,
      },
    };

    setMessages((prev) => [...prev, optimistic]);
    scrollToBottom("smooth");

    await enqueueSend(id, () => sendNow({ tempId, input }));
  };

  const handleRetryLocalMessage = useCallback(
    async (msg: Message) => {
      if (!id) return;
      const meta = msg as any as LocalMessageMeta;
      if (!meta.localPayload) return;
      const localPayload = meta.localPayload;

      await enqueueSend(id, () =>
        sendNow({
          tempId: msg.id,
          input: localPayload,
          isRetry: true,
        }),
      );
    },
    [id, enqueueSend, sendNow],
  );

  const handleRetryAudioTranscript = useCallback(
    async (message: Message) => {
      if (!id) return;

      const { error } = await supabase.functions.invoke(
        RETRY_AUDIO_TRANSCRIPT_FUNCTION,
        {
          body: {
            conversationId: id,
            messageId: message.id,
          },
        },
      );

      if (error) {
        console.error("Erro ao reprocessar transcrição:", error);
        // Mostra o motivo enviado pela função (ex.: indisponível para o canal)
        const response = (error as { context?: Response }).context;
        const payload = await response?.json?.().catch(() => null);
        toast.error(payload?.error ?? "Não foi possível reprocessar a transcrição.");
        return;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id
            ? {
                ...m,
                transcriptStatus: "PENDING",
              }
            : m,
        ),
      );

      toast.info("Transcrição solicitada novamente.");
    },
    [id, setMessages],
  );

  // 🔥 ADICIONADO: Função para deletar a mensagem física no Supabase e atualizar a interface localmente
  // Evolution apaga também no WhatsApp do cliente; a API da Meta não permite
  const deleteMode: "everyone" | "system" =
    conversation?.provider === "evolution" ? "everyone" : "system";

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      const { data, error } = await supabase.functions.invoke(
        "delete-message",
        { body: { messageId } },
      );

      if (error) {
        const response = (error as { context?: Response }).context;
        const payload = await response?.json?.().catch(() => null);
        console.error("Erro ao apagar mensagem:", error);
        toast.error(payload?.error ?? "Não foi possível apagar a mensagem.");
        return;
      }

      const deletedAt = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                text: DELETED_MESSAGE_TEXT,
                type: "text",
                mediaUrl: undefined,
                mediaMimeType: undefined,
                filename: undefined,
                fileSize: undefined,
                transcriptStatus: undefined,
                transcriptText: undefined,
                deletedAt,
                deletedForEveryone: !!data?.deletedForEveryone,
              }
            : m,
        ),
      );
      toast.success(
        data?.deletedForEveryone
          ? "Mensagem apagada para todos."
          : "Mensagem removida do Unxet.",
      );
    },
    [setMessages],
  );

  if (!id) {
    return null;
  }

  const showConversationNotFound =
    !loadingConversation &&
    !conversation &&
    didInitialConversationLoadRef.current;

  if (showConversationNotFound) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-white">
        <div className="text-center">
          <h3 className="text-lg font-medium text-[#1E1E1E] mb-2">
            Conversa não encontrada
          </h3>
          <Button variant="primary" onClick={() => navigate("/inbox")}>
            Voltar para Conversas
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-white relative">
      {loadingConversation ? (
        <div className="flex items-center gap-3 shrink-0 border-b border-gray-200 px-2 py-3 bg-white sm:px-4">
          <button
            type="button"
            onClick={() => navigate("/inbox")}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
            aria-label="Voltar"
          >
            <ArrowLeftIcon className="w-5 h-5 text-[#1E1E1E]" />
          </button>
          <p className="text-gray-500 text-sm">Carregando conversa...</p>
        </div>
      ) : conversation ? (
        <ChatHeader
          conversation={conversation}
          onBack={() => navigate("/inbox")}
          onManageTags={() => setIsManageTagsOpen(true)}
          onAccept={handleAcceptConversation}
          onClose={handleCloseConversation}
          onRefresh={loadConversation}
          onTransfer={() => setIsTransferOpen(true)}
          acceptDisabled={
            acceptingConversation ||
            !authUser ||
            conversation.status !== "pending"
          }
          closeDisabled={
            closingConversation || !authUser || conversation.status === "closed"
          }
        />
      ) : null}

      <div
        ref={messagesContainerRef}
        onScroll={handleScrollCheck}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-3 space-y-4 sm:p-4"
      >
        {eventsError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Não foi possível carregar os logs do sistema.
          </div>
        )}
        {loadingTimeline ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">Carregando mensagens...</p>
          </div>
        ) : timelineItems.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          <>
            {hasOlderMessages ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={requestOlderMessages}
                  disabled={loadingOlderMessages}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70"
                >
                  {loadingOlderMessages
                    ? "Carregando mensagens anteriores..."
                    : "Carregar mensagens anteriores"}
                </button>
              </div>
            ) : null}
            {timelineItems.map((item) =>
              item.kind === "message" ? (
                <div key={`message-${item.message.id}`}>
                  <MessageBubble
                    message={item.message}
                    contactName={conversation?.contactName ?? ""}
                    onRetry={handleRetryLocalMessage}
                    onRetryTranscript={handleRetryAudioTranscript}
                    onDeleteMessage={handleDeleteMessage}
                    deleteMode={deleteMode}
                  />
                </div>
              ) : (
                <SystemEventBubble
                  key={`event-${item.event.id}`}
                  event={item.event}
                />
              ),
            )}
          </>
        )}
      </div>

      {showScrollToBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="absolute left-1/2 -translate-x-1/2 bottom-28 z-20 sm:bottom-32 flex h-12 w-12 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-lg transition-colors hover:bg-[#0066d6]"
          aria-label="Ir para última mensagem"
        >
          <ArrowDownIcon className="w-5 h-5" />
        </button>
      )}

      {recordingUiState.isRecording && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 sm:bottom-32 w-[calc(100%-2rem)] max-w-md -translate-x-1/2">
          <div className="rounded-xl border border-red-100 bg-white/95 px-4 py-3 text-sm text-[#1F2937] shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              <span className="font-medium">Gravando...</span>
              <span className="text-[#6B7280]">
                {formatRecordTime(recordingUiState.recordSeconds)}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#6B7280]">
              Toque no botão de envio para concluir e enviar.
            </p>
          </div>
        </div>
      )}

      {isManageTagsOpen && (
        <div className="fixed inset-0 z-[9999]">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setIsManageTagsOpen(false)}
          />

          <div className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border border-gray-200 bg-white shadow-xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[92vw] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
            <div className="shrink-0 p-5 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">
                Gerenciar Etiquetas
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Selecione as etiquetas que deseja aplicar nesta conversa.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {tagsLoading ? (
                <div className="text-sm text-gray-500">
                  Carregando etiquetas...
                </div>
              ) : availableTags.length === 0 ? (
                <div className="text-sm text-gray-500">
                  Nenhuma etiqueta cadastrada. Crie etiquetas na página{" "}
                  <span
                    onClick={() => navigate("/inbox/tags")}
                    className="font-medium italic cursor-pointer text-blue-500"
                  >
                    Etiquetas
                  </span>
                  .
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableTags.map((t) => {
                    const active = selectedTags.some((s) => s.id === t.id);
                    const loading = tagsSavingId === t.id;

                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={!!tagsSavingId}
                        onClick={() => toggleConversationTag(t)}
                        className={`px-3 py-1.5 rounded-full border text-sm transition ${
                          active
                            ? "border-gray-900"
                            : "border-gray-200 hover:border-gray-300"
                        } ${loading ? "opacity-60" : ""}`}
                        style={{
                          backgroundColor: active ? t.color : "transparent",
                          color: active ? "white" : "#374151",
                        }}
                      >
                        {loading ? "Salvando..." : t.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="shrink-0 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-gray-200 flex justify-end">
              <Button
                variant="ghost"
                onClick={() => setIsManageTagsOpen(false)}
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      <TransferModal
        open={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        onConfirm={handleTransferConversation}
        loading={transferringConversation}
        clinicId={clinicId}
        currentDepartmentId={departmentId}
      />

      {conversation?.status === "open" && (
        <MessageInput
          onSend={handleSendMessage}
          disabled={!canReply}
          draft={draftMessage}
          onDraftChange={setDraftMessage}
          quickMessages={quickMessages}
          quickMessagesLoading={loadingQuickMessages}
          onRecordingStateChange={setRecordingUiState}
        />
      )}
    </div>
  );
};