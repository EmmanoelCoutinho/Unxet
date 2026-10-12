import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  MessagesSquareIcon,
  SendIcon,
  SmileIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "../components/ui/Input";
import { EmojiPicker } from "../components/chat/EmojiPicker";
import { useAuth } from "../contexts/AuthContext";
import {
  INTERNAL_MESSAGE_MAX_LENGTH,
  openDirectThread,
} from "../modules/internalChat/api/internalChat";
import {
  internalChatKeys,
  setActiveInternalThread,
  useInternalMessages,
  useInternalThreads,
  useMarkInternalThreadRead,
  useSendInternalMessage,
  useTeamMembers,
} from "../modules/internalChat/hooks/useInternalChat";
import type {
  InternalMessage,
  InternalThread,
  TeamMember,
} from "../modules/internalChat/types/internalChat";

const GENERAL_NAME = "Geral";

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

// Na lista: hora para hoje, data para os outros dias
const formatListTime = (iso: string) => {
  const date = new Date(iso);
  return isSameDay(date, new Date())
    ? formatTime(iso)
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

const formatDayLabel = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, today)) return "Hoje";
  if (isSameDay(date, yesterday)) return "Ontem";
  return date.toLocaleDateString("pt-BR");
};

const roleLabel = (role: string) =>
  role === "admin" ? "Administrador" : "Atendente";

const Avatar: React.FC<{ name?: string; general?: boolean }> = ({
  name,
  general,
}) => (
  <div
    className={[
      "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold",
      general ? "bg-blue-50 text-blue-700" : "bg-gray-200 text-gray-700",
    ].join(" ")}
  >
    {general ? <UsersIcon className="h-5 w-5" /> : getInitials(name ?? "")}
  </div>
);

type ListEntry = {
  key: string;
  name: string;
  general: boolean;
  member?: TeamMember;
  thread?: InternalThread;
};

type ThreadListProps = {
  entries: ListEntry[];
  loading: boolean;
  activeThreadId: string | null;
  currentUserId?: string;
  openingUserId: string | null;
  onSelect: (entry: ListEntry) => void;
};

const ThreadList: React.FC<ThreadListProps> = ({
  entries,
  loading,
  activeThreadId,
  currentUserId,
  openingUserId,
  onSelect,
}) => {
  if (loading) {
    return (
      <div className="space-y-3 p-4">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-14 animate-pulse rounded bg-gray-200" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-gray-500">
        Ninguém encontrado.
      </p>
    );
  }

  return (
    <div className="divide-y">
      {entries.map((entry) => {
        const { thread } = entry;
        const active = !!thread && thread.id === activeThreadId;
        const unread = thread?.unreadCount ?? 0;
        const preview = thread?.lastMessageBody
          ? `${thread.lastMessageSenderId === currentUserId ? "Você: " : ""}${thread.lastMessageBody}`
          : entry.general
            ? "Toda a equipe"
            : roleLabel(entry.member?.role ?? "agent");

        return (
          <button
            key={entry.key}
            type="button"
            disabled={openingUserId === entry.member?.userId}
            onClick={() => onSelect(entry)}
            className={[
              "flex w-full items-center gap-3 px-3 py-3 text-left transition disabled:opacity-60 sm:px-4",
              active ? "bg-blue-50" : "hover:bg-gray-50",
            ].join(" ")}
          >
            <Avatar name={entry.name} general={entry.general} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-gray-900">
                  {entry.name}
                </span>
                {thread?.lastMessageAt && (
                  <span className="flex-shrink-0 text-xs text-gray-500">
                    {formatListTime(thread.lastMessageAt)}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={[
                    "truncate text-sm",
                    unread > 0 ? "font-medium text-gray-900" : "text-gray-500",
                  ].join(" ")}
                >
                  {preview}
                </span>
                {unread > 0 && (
                  <span className="flex-shrink-0 rounded-full bg-[#0A84FF] px-2 py-0.5 text-xs font-semibold text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

type ThreadViewProps = {
  thread: InternalThread;
  title: string;
  subtitle: string;
  memberNames: Record<string, string>;
  currentUserId: string;
  onBack: () => void;
};

const ThreadView: React.FC<ThreadViewProps> = ({
  thread,
  title,
  subtitle,
  memberNames,
  currentUserId,
  onBack,
}) => {
  const { messages, hasMore, loading, error, loadingOlder, loadOlder } =
    useInternalMessages(thread.id);
  const send = useSendInternalMessage(thread.id);
  const markRead = useMarkInternalThreadRead();

  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  // Só acompanha as mensagens novas se o usuário já estava no fim da conversa
  const stickToBottomRef = useRef(true);
  // Altura antes de carregar mensagens antigas, para manter a posição da leitura
  const heightBeforeOlderRef = useRef<number | null>(null);

  const isGeneral = thread.kind === "general";
  const lastMessage = messages[messages.length - 1];
  const lastMessageId = lastMessage?.id;

  const lastIsMine = lastMessage?.senderId === currentUserId;
  // Última mensagem já marcada como lida (undefined = ainda não marcou nesta abertura)
  const markedUpToRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    setActiveInternalThread(thread.id);
    return () => setActiveInternalThread(null);
  }, [thread.id]);

  // Marca como lida ao abrir, ao chegar mensagem de outra pessoa e ao voltar para a aba
  useEffect(() => {
    const markIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      markedUpToRef.current = lastMessageId ?? null;
      void markRead(thread.id);
    };

    const pending =
      markedUpToRef.current === undefined ||
      (!lastIsMine && markedUpToRef.current !== (lastMessageId ?? null));
    if (pending) markIfVisible();

    document.addEventListener("visibilitychange", markIfVisible);
    return () =>
      document.removeEventListener("visibilitychange", markIfVisible);
  }, [thread.id, lastMessageId, lastIsMine, markRead]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (heightBeforeOlderRef.current !== null) {
      el.scrollTop += el.scrollHeight - heightBeforeOlderRef.current;
      heightBeforeOlderRef.current = null;
      return;
    }

    if (stickToBottomRef.current || lastIsMine) {
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, messages.length, lastMessageId]);

  useEffect(() => {
    if (!emojiOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        emojiPickerRef.current?.contains(target) ||
        emojiButtonRef.current?.contains(target)
      ) {
        return;
      }
      setEmojiOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [emojiOpen]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const handleLoadOlder = async () => {
    heightBeforeOlderRef.current = scrollRef.current?.scrollHeight ?? null;
    try {
      await loadOlder();
    } catch (err) {
      heightBeforeOlderRef.current = null;
      console.error("Erro ao carregar mensagens anteriores:", err);
      toast.error("Não foi possível carregar as mensagens anteriores.");
    }
  };

  const handleSubmit = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    setEmojiOpen(false);
    stickToBottomRef.current = true;
    void send(body);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const renderMessage = (message: InternalMessage, index: number) => {
    const previous = messages[index - 1];
    const mine = message.senderId === currentUserId;
    const newDay =
      !previous ||
      !isSameDay(new Date(previous.createdAt), new Date(message.createdAt));
    // No canal geral, identifica quem escreveu no início de cada sequência
    const showSender =
      isGeneral && !mine && (newDay || previous?.senderId !== message.senderId);

    return (
      <React.Fragment key={message.id}>
        {newDay && (
          <div className="flex justify-center">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
              {formatDayLabel(message.createdAt)}
            </span>
          </div>
        )}
        <div className={`flex w-full ${mine ? "justify-end" : "justify-start"}`}>
          <div className="flex min-w-0 max-w-[88%] flex-col sm:max-w-md">
            {showSender && (
              <span className="mb-1 text-xs font-medium text-gray-600">
                {(message.senderId && memberNames[message.senderId]) ||
                  "Usuário removido"}
              </span>
            )}
            <div
              className={[
                "rounded-lg px-4 py-3 text-sm whitespace-pre-wrap break-words",
                mine
                  ? "bg-[#0A84FF] text-white"
                  : "bg-[#E5E7EB] text-[#1E1E1E]",
                message.pending ? "opacity-70" : "",
              ].join(" ")}
            >
              {message.body}
            </div>
            {message.failed ? (
              <div className="mt-1 flex items-center justify-end gap-2">
                <span className="text-xs text-red-600">Não enviada</span>
                <button
                  type="button"
                  onClick={() => void send(message.body, message.id)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  Tentar novamente
                </button>
              </div>
            ) : (
              <span
                className={`mt-1 text-xs text-gray-500 ${mine ? "text-right" : ""}`}
              >
                {message.pending ? "Enviando..." : formatTime(message.createdAt)}
              </span>
            )}
          </div>
        </div>
      </React.Fragment>
    );
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b bg-white px-3 py-3 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 rounded-lg p-2 text-gray-600 hover:bg-gray-100 xl:hidden"
          aria-label="Voltar para a lista"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <Avatar name={title} general={isGeneral} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{title}</p>
          <p className="truncate text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain bg-gray-50 p-3 sm:p-4"
      >
        {hasMore && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={loadingOlder}
              className="rounded-full border border-[#E5E7EB] bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60"
            >
              {loadingOlder ? "Carregando..." : "Carregar mensagens anteriores"}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : error && messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-red-600">
            Não foi possível carregar as mensagens.
          </p>
        ) : messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-gray-500">
            Nenhuma mensagem ainda. Escreva a primeira.
          </p>
        ) : (
          messages.map(renderMessage)
        )}
      </div>

      <div className="shrink-0 border-t border-[#E5E7EB] bg-white p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4">
        <div className="relative flex items-end gap-1 sm:gap-2">
          <EmojiPicker
            open={emojiOpen}
            pickerRef={emojiPickerRef}
            onPick={(emoji) => setText((current) => `${current}${emoji}`)}
          />
          <button
            ref={emojiButtonRef}
            type="button"
            onClick={() => setEmojiOpen((value) => !value)}
            className="flex h-11 w-10 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[#E5E7EB] sm:h-12 sm:w-12"
            aria-label="Emojis"
            aria-expanded={emojiOpen}
          >
            <SmileIcon className="h-5 w-5 text-gray-500" />
          </button>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            maxLength={INTERNAL_MESSAGE_MAX_LENGTH}
            placeholder="Mensagem para a equipe..."
            className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-lg border border-[#E5E7EB] px-3 py-2.5 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF] sm:min-h-12 sm:px-4 sm:py-3"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!text.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#0A84FF] text-white transition-colors hover:bg-[#0066d6] disabled:opacity-50 sm:h-12 sm:w-12"
            aria-label="Enviar"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
};

export const InternalChatPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { threadId = null } = useParams<{ threadId: string }>();
  const { authUser } = useAuth();
  const currentUserId = authUser?.id;

  const { threads, loading: threadsLoading } = useInternalThreads();
  const { members, loading: membersLoading } = useTeamMembers();

  const [search, setSearch] = useState("");
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

  const activeThread = threads.find((thread) => thread.id === threadId) ?? null;
  const activeTitle = !activeThread
    ? ""
    : activeThread.kind === "general"
      ? GENERAL_NAME
      : (memberNames[activeThread.otherUserId ?? ""] ?? "Atendente");
  const activeSubtitle = !activeThread
    ? ""
    : activeThread.kind === "general"
      ? `Toda a equipe · ${members.length} ${members.length === 1 ? "pessoa" : "pessoas"}`
      : roleLabel(
          members.find((m) => m.userId === activeThread.otherUserId)?.role ??
            "agent",
        );

  const handleSelect = async (entry: ListEntry) => {
    if (entry.thread) {
      navigate(`/inbox/team/${entry.thread.id}`);
      return;
    }
    if (!entry.member || !currentUserId) return;

    setOpeningUserId(entry.member.userId);
    try {
      const id = await openDirectThread(entry.member.userId);
      await queryClient.invalidateQueries({
        queryKey: internalChatKeys.threads(currentUserId),
      });
      navigate(`/inbox/team/${id}`);
    } catch (error) {
      console.error("Erro ao abrir conversa interna:", error);
      toast.error("Não foi possível abrir a conversa.");
    } finally {
      setOpeningUserId(null);
    }
  };

  // Abaixo de xl mostramos um painel por vez: a lista ou a conversa aberta
  return (
    <div className="flex min-h-0 w-full flex-1 bg-white">
      <div
        className={[
          "min-h-0 w-full flex-col border-r xl:flex xl:w-80 xl:flex-shrink-0",
          threadId ? "hidden" : "flex",
        ].join(" ")}
      >
        <div className="shrink-0 border-b p-3 sm:p-4">
          <h2 className="mb-3 text-xl font-semibold">Chat interno</h2>
          <Input
            type="search"
            placeholder="Buscar pessoa..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ThreadList
            entries={entries}
            loading={threadsLoading || membersLoading}
            activeThreadId={threadId}
            currentUserId={currentUserId}
            openingUserId={openingUserId}
            onSelect={handleSelect}
          />
        </div>
      </div>

      <div
        className={[
          "min-h-0 min-w-0 flex-1 flex-col xl:flex",
          threadId ? "flex" : "hidden",
        ].join(" ")}
      >
        {activeThread && currentUserId ? (
          <ThreadView
            key={activeThread.id}
            thread={activeThread}
            title={activeTitle}
            subtitle={activeSubtitle}
            memberNames={memberNames}
            currentUserId={currentUserId}
            onBack={() => navigate("/inbox/team")}
          />
        ) : (
          <div className="flex h-full flex-1 flex-col items-center justify-center bg-gray-50 p-6 text-center">
            {threadId && threadsLoading ? (
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            ) : (
              <>
                <MessagesSquareIcon className="mb-3 h-16 w-16 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900">
                  {threadId ? "Conversa não encontrada" : "Chat interno"}
                </h3>
                <p className="text-sm text-gray-500">
                  {threadId
                    ? "Ela pode ter sido removida ou você não participa dela."
                    : "Escolha alguém da equipe ou o canal Geral para conversar."}
                </p>
                {threadId && (
                  <button
                    type="button"
                    onClick={() => navigate("/inbox/team")}
                    className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700 xl:hidden"
                  >
                    Voltar para a lista
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
