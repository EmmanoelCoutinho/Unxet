import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  MicIcon,
  PaperclipIcon,
  SendIcon,
  SmileIcon,
  StickerIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { EmojiPicker } from "../../../components/chat/EmojiPicker";
import { StickerPicker } from "../../../components/chat/StickerPicker";
import { useClinic } from "../../../contexts/ClinicContext";
import { mediaPathFromPublicUrl } from "../../../lib/mediaUrls";
import { INTERNAL_MESSAGE_MAX_LENGTH } from "../api/internalChat";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import { formatDuration } from "../utils/attachments";
import { MessageAttachment } from "./MessageAttachment";
import {
  setActiveInternalThread,
  useInternalMessages,
  useMarkInternalThreadRead,
  useSendInternalMessage,
} from "../hooks/useInternalChat";
import type { InternalMessage, InternalThread } from "../types/internalChat";
import { Avatar } from "./shared";
import { formatDayLabel, formatTime, isSameDay } from "../utils/format";

// Rascunho por conversa: segue entre a janela flutuante e a página do chat e
// sobrevive a minimizar a janela
const drafts = new Map<string, string>();

type ThreadViewProps = {
  thread: InternalThread;
  title: string;
  subtitle: string;
  memberNames: Record<string, string>;
  currentUserId: string;
  /** Página: botão de voltar para a lista (telas estreitas). */
  onBack?: () => void;
  /** "dock": versão compacta da janela flutuante. */
  variant?: "page" | "dock";
};

export const ThreadView: React.FC<ThreadViewProps> = ({
  thread,
  title,
  subtitle,
  memberNames,
  currentUserId,
  onBack,
  variant = "page",
}) => {
  const { messages, hasMore, loading, error, loadingOlder, loadOlder } =
    useInternalMessages(thread.id);
  const send = useSendInternalMessage(thread.id);
  const markRead = useMarkInternalThreadRead();
  const { clinicId } = useClinic();
  const dock = variant === "dock";

  const [text, setTextState] = useState(() => drafts.get(thread.id) ?? "");
  const setText = (update: string | ((current: string) => string)) =>
    setTextState((current) => {
      const next = typeof update === "function" ? update(current) : update;
      if (next) drafts.set(thread.id, next);
      else drafts.delete(thread.id);
      return next;
    });
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Conta entradas e saídas do arraste (os filhos disparam dragleave)
  const dragDepthRef = useRef(0);

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

  // Na janela flutuante o cursor já vai para a mensagem ao abrir a conversa
  useEffect(() => {
    if (dock) textareaRef.current?.focus();
  }, [dock, thread.id]);

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

  const keepAtBottom = () => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  };

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
    void send({ text: body });
    textareaRef.current?.focus();
  };

  // Cada arquivo vai numa mensagem; os recusados avisam o motivo
  const sendFiles = (files: File[]) => {
    if (!files.length) return;
    stickToBottomRef.current = true;
    files.forEach((file) => {
      void send({ file }).then((reason) => {
        if (reason) toast.info(`${file.name}: ${reason}`);
      });
    });
  };

  const recorder = useVoiceRecorder((file) => sendFiles([file]));

  const handlePaste = (event: React.ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    sendFiles(files);
  };

  const hasFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const dropHandlers = {
    onDragEnter: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragging(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragging(false);
    },
    onDrop: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragging(false);
      sendFiles(Array.from(event.dataTransfer.files));
    },
  };

  const handleSticker = (url: string) => {
    setStickersOpen(false);
    const stickerPath = mediaPathFromPublicUrl(url);
    if (!stickerPath) {
      toast.error("Não foi possível enviar a figurinha.");
      return;
    }
    stickToBottomRef.current = true;
    void send({ stickerPath });
  };

  const retry = (message: InternalMessage) =>
    void send({
      text: message.body,
      retryId: message.id,
      stickerPath:
        message.attachment?.kind === "sticker"
          ? message.attachment.path
          : undefined,
    });

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
    const { attachment } = message;
    const isSticker = attachment?.kind === "sticker";

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
          <div
            className={[
              "flex min-w-0 flex-col",
              dock ? "max-w-[85%]" : "max-w-[88%] sm:max-w-[min(40rem,88%)]",
            ].join(" ")}
          >
            {showSender && (
              <span className="mb-1 text-xs font-medium text-gray-600">
                {(message.senderId && memberNames[message.senderId]) ||
                  "Usuário removido"}
              </span>
            )}
            {isSticker ? (
              <div
                className={`${mine ? "self-end" : ""} ${message.pending ? "opacity-70" : ""}`}
              >
                <MessageAttachment
                  attachment={attachment}
                  mine={mine}
                  compact={dock}
                  onMediaLoad={keepAtBottom}
                />
              </div>
            ) : (
              <div
                className={[
                  "rounded-lg text-sm whitespace-pre-wrap break-words",
                  attachment?.kind === "image"
                    ? "p-1"
                    : dock
                      ? "px-3 py-2"
                      : "px-4 py-3",
                  mine
                    ? "bg-[#0A84FF] text-white"
                    : dock
                      ? "bg-white text-gray-900 shadow-sm"
                      : "bg-gray-200 text-gray-900",
                  message.pending ? "opacity-70" : "",
                ].join(" ")}
              >
                {attachment && (
                  <MessageAttachment
                    attachment={attachment}
                    mine={mine}
                    compact={dock}
                    onMediaLoad={keepAtBottom}
                  />
                )}
                {message.body && (
                  <p
                    className={
                      attachment?.kind === "image"
                        ? dock
                          ? "px-2 pb-1 pt-1.5"
                          : "px-3 pb-2 pt-2"
                        : attachment
                          ? "mt-2"
                          : ""
                    }
                  >
                    {message.body}
                  </p>
                )}
              </div>
            )}
            {message.failed ? (
              <div className="mt-1 flex items-center justify-end gap-2">
                <span className="text-xs text-red-600">Não enviada</span>
                <button
                  type="button"
                  onClick={() => retry(message)}
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

  const iconButton = [
    "flex shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-50",
    dock ? "h-10 w-9" : "h-11 w-10 sm:h-12 sm:w-12",
  ].join(" ");
  const primaryButton = [
    "flex shrink-0 items-center justify-center rounded-lg bg-[#0A84FF] text-white transition-colors hover:bg-[#0066d6] disabled:opacity-50",
    dock ? "h-10 w-10" : "h-11 w-11 sm:h-12 sm:w-12",
  ].join(" ");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dropHandlers}>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#0A84FF] bg-blue-50/90 text-sm font-medium text-[#0A84FF]">
          <UploadIcon className="h-6 w-6" aria-hidden />
          Solte para enviar na conversa
        </div>
      )}

      <div
        className={[
          "flex shrink-0 items-center border-b bg-white",
          dock ? "gap-2 px-3 py-2" : "gap-3 px-3 py-3 sm:px-4",
        ].join(" ")}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 rounded-lg p-2 text-gray-600 hover:bg-gray-100 xl:hidden"
            aria-label="Voltar para a lista"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
        )}
        <Avatar name={title} general={isGeneral} size={dock ? "sm" : "md"} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{title}</p>
          <p className="truncate text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={[
          "min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain bg-gray-50",
          dock ? "p-3" : "p-3 sm:p-4",
        ].join(" ")}
      >
        {hasMore && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={loadingOlder}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60"
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

      <div
        className={[
          "shrink-0 border-t border-gray-200 bg-white",
          dock
            ? "p-2"
            : "p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4",
        ].join(" ")}
      >
        {recorder.recording ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={recorder.cancel}
              className={iconButton}
              aria-label="Descartar áudio"
              title="Descartar áudio"
            >
              <Trash2Icon className="h-5 w-5" />
            </button>
            <div
              className={[
                "flex flex-1 items-center gap-2 rounded-lg bg-red-50 px-3 text-sm font-medium text-red-600",
                dock ? "h-10" : "h-11 sm:h-12",
              ].join(" ")}
              role="status"
            >
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              Gravando {formatDuration(recorder.seconds)}
            </div>
            <button
              type="button"
              onClick={recorder.stop}
              className={primaryButton}
              aria-label="Enviar áudio"
              title="Enviar áudio"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
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
              className={iconButton}
              aria-label="Emojis"
              title="Emojis"
              aria-expanded={emojiOpen}
            >
              <SmileIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={iconButton}
              aria-label="Enviar arquivo ou imagem"
              title="Enviar arquivo ou imagem"
            >
              <PaperclipIcon className="h-5 w-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                sendFiles(files);
              }}
            />
            <button
              type="button"
              onClick={() => {
                setEmojiOpen(false);
                setStickersOpen(true);
              }}
              className={iconButton}
              aria-label="Figurinhas"
              title="Figurinhas"
            >
              <StickerIcon className="h-5 w-5" />
            </button>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={1}
              maxLength={INTERNAL_MESSAGE_MAX_LENGTH}
              placeholder="Mensagem para a equipe..."
              className={[
                "min-w-0 flex-1 resize-none rounded-lg border border-gray-200 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]",
                dock
                  ? "max-h-24 min-h-10 px-3 py-2 text-sm"
                  : "max-h-32 min-h-11 px-3 py-2.5 sm:min-h-12 sm:px-4 sm:py-3",
              ].join(" ")}
            />
            {text.trim() ? (
              <button
                type="button"
                onClick={handleSubmit}
                className={primaryButton}
                aria-label="Enviar"
                title="Enviar"
              >
                <SendIcon className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEmojiOpen(false);
                  void recorder.start();
                }}
                className={primaryButton}
                aria-label="Gravar áudio"
                title="Gravar áudio"
              >
                <MicIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      <StickerPicker
        open={stickersOpen}
        onClose={() => setStickersOpen(false)}
        onSelect={handleSticker}
        clinicId={clinicId}
      />
    </div>
  );
};
