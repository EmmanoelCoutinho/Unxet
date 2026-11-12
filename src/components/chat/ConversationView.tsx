import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useClinic } from "../../contexts/ClinicContext";
import {
  isSlaBreached,
  type Conversation,
  type Message,
  type Channel,
} from "../../types";
import {
  useMessages,
  mapDbMessage,
  DELETED_MESSAGE_TEXT,
  isLocalOptimisticId,
  sortMessages,
} from "../../hooks/useMessages";
import { useConversationEvents } from "../../hooks/useConversationEvents";
import { useQuickMessages } from "../../hooks/useQuickMessages";
import {
  getAssigneeLabel,
  useClinicUserNames,
} from "../../hooks/useClinicUserNames";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";
import { ChatHeader } from "./ChatHeader";
import { ConversationCampaignBanner } from "../../modules/scheduledMessages/components/ConversationCampaignBanner";
import { ConversationDealBar } from "../../modules/leads/components/ConversationDealBar";
import { MessageBubble } from "./MessageBubble";
import { SystemEventBubble } from "./SystemEventBubble";
import { MessageInput } from "./MessageInput";
import { ArrowDownIcon, ArrowLeftIcon } from "lucide-react";
import { TbMessageCheck } from "react-icons/tb";
import { useAuth } from "../../contexts/AuthContext";
import { TransferModal, type TransferTarget } from "./TransferModal";
import { ParticipantsModal } from "./ParticipantsModal";
import { ConversationFilesPanel } from "./ConversationFilesPanel";
import { BlockContactModal } from "../../modules/contacts/components/BlockContactModal";
import { unblockContact } from "../../modules/contacts/api/blocking";
import { OtherNumbersBanner } from "./OtherNumbersBanner";
import { GENERIC_SEND_ERROR, sendErrorMessage } from "../../lib/sendError";
import { useConversationParticipants } from "../../hooks/useConversationParticipants";
import { sharedContactText, type SharedContact } from "../../lib/sharedContact";
import {
  conversationConnectionLabel,
  isConnectionRemoved,
  whatsappConnectionLabel,
} from "../../lib/whatsappConnections";
import { useWhatsappConnections } from "../../hooks/useWhatsappConnections";
import { useFloatingChats } from "../../modules/floatingChats/FloatingChatsContext";
import { useConversationList } from "../../contexts/ConversationsContext";
import { WindowControls, type WindowControlsProps } from "./WindowControls";

type UiTag = { id: string; name: string; color: string };

type SendableInput =
  | string
  | {
      type: "text" | "image" | "audio" | "document" | "contact";
      text?: string;
      mediaUrl?: string;
      mediaMimeType?: string;
      filename?: string;
      fileSize?: number;
      contact?: SharedContact;
    };

type LocalSendStatus = "sending" | "failed" | "sent";

type LocalPayload = {
  type: "text" | "image" | "audio" | "document" | "contact";
  text?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  filename?: string;
  fileSize?: number;
  contact?: SharedContact;
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
  let outboundType: "text" | "image" | "audio" | "document" | "contact" =
    "text";
  let mediaUrl: string | undefined;
  let mediaMimeType: string | undefined;
  let filename: string | undefined;
  let fileSize: number | undefined;
  let contact: SharedContact | undefined;

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
    contact = input.contact;
    // contato vira texto no histórico (a edge function grava no mesmo formato)
    if (outboundType === "contact" && contact) {
      bodyText = sharedContactText(contact);
    }
  }

  return {
    bodyText,
    outboundType,
    // tipo exibido na bolha: não existe bolha própria de contato
    displayType: (outboundType === "contact" ? "text" : outboundType) as
      | "text"
      | "image"
      | "audio"
      | "document",
    mediaUrl,
    mediaMimeType,
    filename,
    fileSize,
    contact,
  };
}

export type ConversationViewProps = {
  conversationId: string;
  /** "page": tela cheia (rota do chat); "floating": caixa flutuante. */
  variant?: "page" | "floating";
  /** Sair da conversa: voltar, depois de finalizar ou de transferir. */
  onExit: () => void;
  /** Tela cheia no computador: levar a conversa para uma caixa flutuante. */
  onPopOut?: () => void;
  /** Caixa flutuante: minimizar, maximizar e fechar. */
  windowControls?: WindowControlsProps;
};

export const ConversationView: React.FC<ConversationViewProps> = ({
  conversationId: id,
  variant = "page",
  onExit,
  onPopOut,
  windowControls,
}) => {
  const navigate = useNavigate();
  const isFloating = variant === "floating";
  const { getDraft, setDraft } = useFloatingChats();
  const { authUser } = useAuth();
  const { clinicId, can, hasFeature } = useClinic();
  const { refetch: refetchConversationList } = useConversationList();
  const { hasMultiple: hasMultipleWhatsapp } = useWhatsappConnections(clinicId);
  const seesAllConversations = can("conversations.all");
  // Nomes de todos da empresa: responsável (admin) e atendentes adicionados
  const userNames = useClinicUserNames(clinicId);

  const handleUnblockContact = async () => {
    const contactId = conversation?.contactId;
    if (!contactId) return;
    try {
      await unblockContact(contactId);
      setConversation((current) =>
        current && current.contactId === contactId ? { ...current, contactBlocked: false } : current,
      );
      toast.success("Contato desbloqueado. As mensagens dele voltam a chegar.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível desbloquear o contato.");
    }
  };

  const didInitialConversationLoadRef = useRef(false);
  const activeRouteConversationIdRef = useRef<string | undefined>(id);
  const conversationLoadRequestRef = useRef(0);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const justOpenedRef = useRef(true);
  // Enquanto o usuário estiver no fim, mantém o fim visível quando o conteúdo
  // cresce depois de renderizar (imagens, áudios e vídeos carregando)
  const stickToBottomRef = useRef(true);
  const [messagesContentEl, setMessagesContentEl] =
    useState<HTMLDivElement | null>(null);
  // Posição da rolagem antes de carregar mensagens antigas (para restaurar)
  const pendingScrollRestoreRef = useRef<{ height: number; top: number } | null>(
    null,
  );

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(true);
  // O rascunho fica guardado por conversa: segue entre a caixa e a tela cheia
  const [draftMessage, setDraftMessageState] = useState(() => getDraft(id));
  const setDraftMessage = useCallback(
    (value: string) => {
      setDraftMessageState(value);
      setDraft(id, value);
    },
    [id, setDraft],
  );
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
  const [startingConversation, setStartingConversation] = useState(false);
  const [closingConversation, setClosingConversation] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferringConversation, setTransferringConversation] =
    useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [isFilesOpen, setIsFilesOpen] = useState(false);
  const [isBlockOpen, setIsBlockOpen] = useState(false);
  const canBlockContacts = can("contacts.block");
  const [participantBusyId, setParticipantBusyId] = useState<string | null>(
    null,
  );

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

  // Atendentes adicionados à conversa. A lista é limpa pelo banco quando a
  // conversa muda de responsável/setor ou é finalizada: recarrega junto.
  const { participantIds, reload: reloadParticipants } =
    useConversationParticipants(
      id ?? null,
      `${conversation?.status ?? ""}:${conversation?.assignedTo ?? ""}:${conversation?.departmentId ?? ""}`,
    );

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
    stickToBottomRef.current = true;
    didInitialConversationLoadRef.current = false;
    setConversation(null);
    setSelectedTags([]);
    setAvailableTags([]);
    setLoadingConversation(true);
    setDraftMessageState(getDraft(id));
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

    stickToBottomRef.current = true;
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

      stickToBottomRef.current = distanceToBottom <= 40;
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

      // Quem pode abrir a conversa é decidido pelo banco (RLS): quem atende
      // todos os setores, o responsável, quem foi adicionado e, na fila, quem
      // é do setor. Não filtramos por setor aqui: a conversa transferida para
      // uma pessoa continua no setor de origem.
      const conversationQuery = supabase
        .from("conversations")
        .select(
          `
        id,
        status,
        channel,
        channel_connections (
          id,
          provider,
          display_name,
          connected_phone,
          connected_name,
          archived_at
        ),
        last_message_at,
        created_at,
        assigned_user_id,
        in_bot_flow,
        contacts:contact_id (*),
        departments:department_id (name),
        last_inbound_at,
        sla_breached_at,
        first_unanswered_inbound_at,
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
        .eq("clinic_id", clinicId);

      const { data, error } = await conversationQuery
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
        departmentId: (data as any).department_id ?? undefined,
        departmentName: (data as any).departments?.name ?? undefined,
        channel: (data as any).channel as Channel,
        status: ((data as any).status as Conversation["status"]) ?? "pending",
        provider: (data as any).channel_connections?.provider ?? undefined,
        connectionId: (data as any).channel_connections?.id ?? undefined,
        connectionLabel: conversationConnectionLabel(
          (data as any).channel_connections,
        ),
        connectionRemoved: isConnectionRemoved((data as any).channel_connections),
        connectionName: (data as any).channel_connections
          ? whatsappConnectionLabel((data as any).channel_connections)
          : undefined,
        contactId: contactRow?.id ?? (data as any).contact_id ?? undefined,
        contactBlocked: !!contactRow?.blocked_at,
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
        inBotFlow: (data as any).in_bot_flow === true,
        lastInboundAt: (data as any).last_inbound_at ?? undefined,
        slaBreached: isSlaBreached(data as any),
      };

      setSelectedTags(tagsFromConv);
      setConversation(mappedConversation);

      setLoadingConversation(false);
      didInitialConversationLoadRef.current = true;
    },
    [id, clinicId],
  );

  useEffect(() => {
    handleScrollCheck();
  }, [timelineItems.length, handleScrollCheck]);

  useEffect(() => {
    if (loadingTimeline || !lastTimelineKey) return;
    scrollToBottom("auto");
  }, [loadingTimeline, lastTimelineKey, scrollToBottom]);

  // Mídias carregam depois do primeiro scroll e aumentam a altura da lista;
  // se o usuário estava no fim, continua no fim
  useEffect(() => {
    if (!messagesContentEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToBottom("auto");
    });
    observer.observe(messagesContentEl);
    return () => observer.disconnect();
  }, [messagesContentEl, scrollToBottom]);

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
      const response = (error as { context?: Response }).context;
      // 409: outro atendente aceitou primeiro (a função já devolve o texto)
      const payload =
        response?.status === 409
          ? await response.json().catch(() => null)
          : null;
      toast.error(payload?.error ?? "Não foi possível aceitar a conversa.");
      await loadConversation({ silent: true });
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

  // Conversa finalizada: o atendente puxa a conversa e fica como responsável
  const handleStartConversation = useCallback(async () => {
    if (!id) return;
    setStartingConversation(true);
    const { error } = await supabase.functions.invoke("start-conversation", {
      body: { conversationId: id },
    });
    if (error) {
      console.error("Erro ao iniciar conversa:", error);
      const response = (error as { context?: Response }).context;
      const payload = await response?.json?.().catch(() => null);
      toast.error(payload?.error ?? "Não foi possível iniciar a conversa.");
      setStartingConversation(false);
      return;
    }
    await loadConversation();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("inbox:tab", { detail: "open" }));
    }
    setStartingConversation(false);
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

    onExit();
  }, [id, onExit]);

  const handleTransferConversation = useCallback(
    async (target: TransferTarget) => {
      if (!id) return;
      const toUserId = "userId" in target ? target.userId : null;
      const toDepartmentId = "departmentId" in target ? target.departmentId : null;
      if (!toUserId && !toDepartmentId) return;

      setTransferringConversation(true);

      const { error } = await supabase.functions.invoke(
        "transfer-conversation",
        {
          body: {
            conversationId: id,
            ...(toUserId ? { toUserId } : { toDepartmentId }),
          },
        },
      );

      if (error) {
        console.error("Erro ao transferir conversa:", error);
        const response = (error as { context?: Response }).context;
        // As recusas da função (400/403/409) já vêm com o motivo
        const payload =
          response && response.status < 500
            ? await response.json().catch(() => null)
            : null;
        toast.error(payload?.error ?? "Não foi possível transferir a conversa.");
        setTransferringConversation(false);
        return;
      }

      setIsTransferOpen(false);
      setTransferringConversation(false);
      toast.success("Conversa transferida.");

      // Transferiu para si mesmo: continua na conversa, agora como responsável
      if (toUserId && toUserId === authUser?.id) {
        await loadConversation();
        return;
      }

      // Quem transferiu pode perder o acesso à conversa (outro setor, sem
      // responsável): o aviso em tempo real dessa mudança não chega até essa
      // pessoa, então a lista é recarregada para tirar a conversa de lá
      void refetchConversationList();

      onExit();
    },
    [id, onExit, refetchConversationList, authUser?.id, loadConversation],
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
    } catch (error) {
      console.error("Erro ao atualizar etiqueta da conversa:", error);
      toast.error("Não foi possível atualizar a etiqueta desta conversa.");
      void reloadConversationTags(conversation.id);
    } finally {
      setTagsSavingId(null);
    }
  };

  const canReply = useMemo(() => {
    if (!authUser || !conversation) return false;
    // Número removido da empresa: não há por onde enviar
    if (conversation.connectionRemoved) return false;

    if (conversation.assignedTo) {
      // O responsável e os atendentes adicionados respondem
      return (
        conversation.assignedTo === authUser.id ||
        participantIds.includes(authUser.id)
      );
    }

    return true;
  }, [authUser, conversation, participantIds]);

  // Responsável ou quem atende todos os setores adiciona/remove atendentes
  const canManageParticipants =
    !!authUser &&
    !!conversation &&
    (seesAllConversations || conversation.assignedTo === authUser.id);

  const handleParticipantChange = useCallback(
    async (action: "add" | "remove", userId: string) => {
      if (!id) return;
      setParticipantBusyId(userId);

      const { error } = await supabase.functions.invoke(
        "conversation-participants",
        { body: { conversationId: id, action, userId } },
      );

      setParticipantBusyId(null);

      if (error) {
        console.error("Erro ao atualizar atendentes da conversa:", error);
        const response = (error as { context?: Response }).context;
        const payload =
          response && response.status < 500
            ? await response.json().catch(() => null)
            : null;
        toast.error(
          payload?.error ??
            (action === "add"
              ? "Não foi possível adicionar o atendente."
              : "Não foi possível remover o atendente."),
        );
        return;
      }

      await reloadParticipants();

      const leaving = action === "remove" && userId === authUser?.id;
      if (leaving) {
        toast.success("Você saiu da conversa.");
        setIsParticipantsOpen(false);
        void refetchConversationList();
        onExit();
        return;
      }

      toast.success(
        action === "add" ? "Atendente adicionado." : "Atendente removido.",
      );
    },
    [id, authUser?.id, onExit, refetchConversationList, reloadParticipants],
  );

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
        contact,
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
          // com "+": a edge function não acrescenta o 55 de novo
          contact: contact
            ? { name: contact.name, phone: `+${contact.phone}` }
            : undefined,
        },
      });

      if (error) {
        console.error(`Erro ao enviar mensagem (${functionName}):`, error);
        // A função devolve o motivo (número removido, conversa de outro
        // atendente...): mostra ele em vez do aviso genérico
        const response = (error as { context?: Response }).context;
        const payload = response
          ? await response.json().catch(() => null)
          : null;
        const reason = sendErrorMessage(response?.status, payload);
        markLocalMessage(tempId, {
          localStatus: "failed",
          localError:
            reason === GENERIC_SEND_ERROR ? "Falha ao enviar. Reenviar." : reason,
        });
        toast.error(reason);
        // Número removido enquanto a conversa estava aberta: trava o campo
        if (payload?.code === "number_removed") {
          void loadConversation({ silent: true });
        }
        return;
      }

      const inserted = (data as any)?.message;
      if ((data as any)?.persisted === false) {
        toast.warn(
          "A mensagem foi enviada ao cliente, mas não foi salva no histórico. Não é preciso reenviar.",
          { autoClose: 8000 },
        );
      }
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
      loadConversation,
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
      displayType,
      mediaUrl,
      mediaMimeType,
      filename,
      fileSize,
      contact,
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
      type: displayType,
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
        contact,
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

  // Barra simples enquanto a conversa carrega (ou quando não foi encontrada)
  const placeholderHeader = (text: string) =>
    isFloating ? (
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white py-2 pl-3 pr-1">
        <p className="min-w-0 flex-1 truncate text-sm text-gray-500">{text}</p>
        {windowControls && <WindowControls {...windowControls} />}
      </div>
    ) : (
      <div className="flex items-center gap-3 shrink-0 border-b border-gray-200 px-2 py-3 bg-white sm:px-4">
        <button
          type="button"
          onClick={onExit}
          className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
          aria-label="Voltar"
        >
          <ArrowLeftIcon className="w-5 h-5 text-gray-900" />
        </button>
        <p className="text-gray-500 text-sm">{text}</p>
      </div>
    );

  if (showConversationNotFound) {
    return (
      <div className="flex h-full w-full flex-col bg-white">
        {isFloating && placeholderHeader("Conversa indisponível")}
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Conversa não encontrada
            </h3>
            <Button variant="primary" onClick={onExit}>
              {isFloating ? "Fechar" : "Voltar para Conversas"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-white relative">
      {loadingConversation ? (
        placeholderHeader("Carregando conversa...")
      ) : conversation ? (
        <ChatHeader
          compact={isFloating}
          windowControls={windowControls}
          onPopOut={onPopOut}
          conversation={conversation}
          assigneeName={
            seesAllConversations
              ? getAssigneeLabel(conversation.assignedTo, authUser?.id, userNames)
              : undefined
          }
          departmentName={conversation.departmentName}
          connectionLabel={
            conversation.channel === "whatsapp" &&
            (hasMultipleWhatsapp || conversation.connectionRemoved)
              ? conversation.connectionLabel
              : undefined
          }
          onBack={onExit}
          onManageTags={() => setIsManageTagsOpen(true)}
          participantNames={participantIds.map((pid) =>
            pid === authUser?.id ? "Você" : (userNames[pid] ?? "Atendente"),
          )}
          onManageParticipants={
            conversation.status === "open" &&
            (canManageParticipants ||
              (!!authUser && participantIds.includes(authUser.id)))
              ? () => setIsParticipantsOpen(true)
              : undefined
          }
          onOpenFiles={conversation.contactId ? () => setIsFilesOpen(true) : undefined}
          onBlockContact={
            canBlockContacts && conversation.contactId && !conversation.contactBlocked
              ? () => setIsBlockOpen(true)
              : undefined
          }
          onUnblockContact={
            canBlockContacts && conversation.contactId && conversation.contactBlocked
              ? handleUnblockContact
              : undefined
          }
          onAccept={handleAcceptConversation}
          onClose={handleCloseConversation}
          onRefresh={loadConversation}
          // Plano sem departamentos: o botão de transferir nem aparece
          // Plano sem departamentos: transfere só para uma pessoa
          onTransfer={() => setIsTransferOpen(true)}
          acceptDisabled={
            acceptingConversation ||
            !authUser ||
            conversation.status !== "pending"
          }
          closeDisabled={
            closingConversation ||
            !authUser ||
            conversation.status === "closed" ||
            // mesma regra da função: só o responsável ou um admin finaliza
            (!seesAllConversations && conversation.assignedTo !== authUser.id)
          }
          transferDisabled={
            transferringConversation ||
            !authUser ||
            conversation.status === "closed" ||
            // conversa de outro atendente: só ele ou um admin transfere
            (!seesAllConversations &&
              !!conversation.assignedTo &&
              conversation.assignedTo !== authUser.id)
          }
        />
      ) : null}

      {conversation?.id &&
        conversation.contactId &&
        conversation.channel === "whatsapp" && (
          <OtherNumbersBanner
            conversationId={conversation.id}
            contactId={conversation.contactId}
            contactName={conversation.contactName}
            refreshKey={conversation.status}
            compact={isFloating}
          />
        )}

      {conversation?.id && hasFeature("scheduled_messages") && (
        <ConversationCampaignBanner
          conversationId={conversation.id}
          tagsKey={selectedTags.map((t) => t.id).join(",")}
          compact={isFloating}
        />
      )}

      {conversation?.id && conversation.contactId && hasFeature("scheduled_messages") && (
        <ConversationDealBar
          conversationId={conversation.id}
          contactId={conversation.contactId}
          contactName={conversation.contactName}
          contactPhone={conversation.contactNumber ?? null}
          compact={isFloating}
        />
      )}

      <div
        ref={messagesContainerRef}
        onScroll={handleScrollCheck}
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-3 space-y-4 ${isFloating ? "" : "sm:p-4"}`}
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
          <div ref={setMessagesContentEl} className="space-y-4">
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
          </div>
        )}
      </div>

      {showScrollToBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className={`absolute left-1/2 -translate-x-1/2 z-20 ${
            isFloating ? "bottom-24 h-10 w-10" : "bottom-28 sm:bottom-32 h-12 w-12"
          } flex items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-lg transition-colors hover:bg-[#0066d6]`}
          aria-label="Ir para última mensagem"
        >
          <ArrowDownIcon className="w-5 h-5" />
        </button>
      )}

      {recordingUiState.isRecording && (
        <div className={`pointer-events-none absolute left-1/2 z-20 ${isFloating ? "bottom-24" : "bottom-28 sm:bottom-32"} w-[calc(100%-2rem)] max-w-md -translate-x-1/2`}>
          <div className="rounded-xl border border-red-100 bg-white/95 px-4 py-3 text-sm text-gray-800 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              <span className="font-medium">Gravando...</span>
              <span className="text-gray-500">
                {formatRecordTime(recordingUiState.recordSeconds)}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Toque no botão de envio para concluir e enviar, ou na lixeira (Esc) para cancelar.
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
            <div className="flex shrink-0 items-start justify-between gap-3 p-5 border-b border-gray-200">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900">
                  Gerenciar Etiquetas
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Selecione as etiquetas que deseja aplicar nesta conversa.
                </p>
              </div>
              <CloseButton
                onClick={() => setIsManageTagsOpen(false)}
                className="-mr-1 -mt-1"
              />
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
                          color: active ? "white" : "rgb(var(--c-text-gray-700))",
                        }}
                      >
                        {loading ? "Salvando..." : t.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="pb-[env(safe-area-inset-bottom)]" />
            </div>
          </div>
        </div>
      )}

      {isBlockOpen && conversation?.contactId && (
        <BlockContactModal
          contactId={conversation.contactId}
          contactName={conversation.contactName}
          onClose={() => setIsBlockOpen(false)}
          onBlocked={() => {
            // O bloqueio finaliza a conversa: recarrega esta tela e a lista
            void loadConversation({ silent: true });
            void refetchConversationList();
          }}
        />
      )}

      {conversation?.contactId && (
        <ConversationFilesPanel
          open={isFilesOpen}
          contactId={conversation.contactId}
          contactName={conversation.contactName}
          onClose={() => setIsFilesOpen(false)}
        />
      )}

      <ParticipantsModal
        open={isParticipantsOpen}
        onClose={() => setIsParticipantsOpen(false)}
        clinicId={clinicId}
        currentUserId={authUser?.id ?? null}
        assignedTo={conversation?.assignedTo}
        participantIds={participantIds}
        names={userNames}
        canManage={canManageParticipants}
        canAdd={conversation?.status === "open" && !!conversation?.assignedTo}
        busyUserId={participantBusyId}
        onAdd={(userId) => void handleParticipantChange("add", userId)}
        onRemove={(userId) => void handleParticipantChange("remove", userId)}
      />

      <TransferModal
        open={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        onConfirm={handleTransferConversation}
        loading={transferringConversation}
        clinicId={clinicId}
        currentDepartmentId={conversation?.departmentId ?? null}
        currentAssigneeId={conversation?.assignedTo ?? null}
        allowDepartments={hasFeature("departments")}
      />

      {/* Caixa flutuante: aceitar fica no rodapé, onde o campo de mensagem
          aparece depois de aceitar */}
      {isFloating && conversation?.status === "pending" && (
        <div className="flex shrink-0 items-center gap-3 border-t border-gray-200 bg-gray-50 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs leading-snug text-gray-500">
            {conversation.inBotFlow
              ? "O cliente ainda está no atendimento automático."
              : "Aceite a conversa para responder."}
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={handleAcceptConversation}
            disabled={acceptingConversation || !authUser}
            className="flex flex-shrink-0 items-center gap-1.5 px-4"
          >
            <TbMessageCheck className="h-4 w-4" />
            {acceptingConversation ? "Aceitando..." : "Aceitar"}
          </Button>
        </div>
      )}

      {/* Finalizada: "Iniciar conversa" reabre com o atendente como responsável */}
      {conversation?.status === "closed" && !conversation.connectionRemoved && (
        <div className="flex shrink-0 items-center gap-3 border-t border-gray-200 bg-gray-50 px-3 py-2.5 sm:px-4">
          <p className="min-w-0 flex-1 text-xs leading-snug text-gray-500 sm:text-sm">
            {conversation.provider === "meta" &&
            !isInside24hWindow(
              latestIso(conversation.lastInboundAt, getLastInboundClientAt(messages)),
            )
              ? "Conversa finalizada. Pelo WhatsApp oficial, depois de 24h sem resposta do cliente só dá para enviar modelo aprovado (em Campanhas)."
              : "Conversa finalizada. Inicie a conversa para enviar mensagem ao cliente."}
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={handleStartConversation}
            disabled={startingConversation || !authUser}
            className="flex flex-shrink-0 items-center gap-1.5 px-4"
          >
            <TbMessageCheck className="h-4 w-4" />
            {startingConversation ? "Iniciando..." : "Iniciar conversa"}
          </Button>
        </div>
      )}

      {conversation?.connectionRemoved && conversation.status !== "closed" && (
        <div className="shrink-0 border-t border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-snug text-amber-900 sm:px-4 sm:text-sm">
          O número desta conversa
          {conversation.connectionName ? (
            <span className="font-semibold"> ({conversation.connectionName})</span>
          ) : null}{" "}
          foi removido da empresa. Não é possível responder por aqui. Se o
          cliente falar por outro número, a conversa aparece lá.
        </div>
      )}

      {conversation?.status === "open" && !conversation.connectionRemoved && (
        <MessageInput
          // Outra conversa: começa sem anexos na fila
          key={id}
          compact={isFloating}
          captionsSupported={conversation.channel === "whatsapp"}
          onSend={handleSendMessage}
          allowContacts={conversation.channel === "whatsapp"}
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