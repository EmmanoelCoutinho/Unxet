import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AlertCircle,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  DownloadIcon,
  Reply,
  ExternalLinkIcon,
  FileTextIcon,
  FilmIcon,
  MapPin,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import type { Message as UiMessage } from "../../types";
import { AudioTranscriptStatus } from "./AudioTranscriptStatus";
import { AudioPlayer } from "./AudioPlayer";
import { VideoPlayer } from "./VideoPlayer";
import { isVideoFile as looksLikeVideo } from "../../lib/videoFile";
import { WhatsappText } from "./WhatsappText";
import { QuotedMessage } from "./QuotedMessage";
import { addStickerFavorite, stickerPathFromUrl } from "../../lib/stickerFavorites";
import { toast } from "react-toastify";
import { useMediaUrl } from "../../lib/mediaUrls";
import { MAX_EDIT_TEXT_LENGTH } from "../../lib/messageEdit";
import { locationMapsLinkFromText, pixFromText } from "../../lib/messageQuickActions";
import { CloseButton } from "../ui/CloseButton";

interface MessageBubbleProps {
  message: UiMessage;
  contactAvatar?: string;
  contactName?: string;
  /** Conversa de grupo: a mensagem do cliente mostra quem escreveu */
  isGroup?: boolean;

  /**
   * Opcional: usado para permitir "Reenviar" quando a mensagem é local e falhou.
   * Você deve passar essa função a partir do Chat.tsx.
   */
  onRetry?: (message: UiMessage) => void;
  /** Reenvia como mensagem nova o que o WhatsApp avisou que não entregou */
  onResendUndelivered?: (message: UiMessage) => void;
  onRetryTranscript?: (message: UiMessage) => Promise<void> | void;
  onDeleteMessage?: (messageId: string) => Promise<void>;
  /**
   * "everyone": o provedor apaga também no WhatsApp do cliente (Evolution).
   * "system": a API não permite (Meta); a mensagem some apenas do Unxet.
   */
  deleteMode?: "everyone" | "system";
  /** Editar o texto (só quando pode: WhatsApp QR Code, quem enviou, até 15 min). true = editou */
  onEditMessage?: (messageId: string, text: string) => Promise<boolean>;
  /** Responder citando (só WhatsApp e quem pode responder a conversa) */
  onReply?: (message: UiMessage) => void;
  /** Reagir com emoji; null remove a reação da empresa */
  onReact?: (message: UiMessage, emoji: string | null) => void;
  /** Clique na citação: vai até a mensagem original */
  onQuotedClick?: (messageId: string) => void;
}

const MENU_ITEM_CLASS =
  "flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm text-gray-700 outline-none data-[highlighted]:bg-gray-100";

// Reações rápidas do menu (como no WhatsApp)
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

const downloadName = (message: UiMessage, filename?: string) => {
  if (filename) return filename;
  const mime = (message.mediaMimeType ?? "").split(";")[0].trim().toLowerCase();
  const ext = MIME_EXTENSIONS[mime] ?? mime.split("/")[1] ?? "bin";
  const kind = message.type ?? "arquivo";
  return `${kind}-${message.id.slice(0, 8)}.${ext}`;
};

// Cor fixa por atendente (como nos grupos do WhatsApp), legível no claro e no escuro
const SENDER_COLORS = [
  "#0EA5E9",
  "#8B5CF6",
  "#EC4899",
  "#F97316",
  "#10B981",
  "#6366F1",
  "#D97706",
  "#14B8A6",
];

const senderColor = (key: string) => {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
};

const senderInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
};

type LocalSendStatus = "sending" | "failed" | "sent";
type LocalMeta = {
  localStatus?: LocalSendStatus;
  localError?: string | null;
};

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatBytes = (bytes?: number) => {
  if (!bytes || Number.isNaN(bytes)) return null;

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const formatted =
    unitIndex === 0 || size >= 10
      ? Math.round(size).toString()
      : size.toFixed(1);

  return `${formatted} ${units[unitIndex]}`;
};

const getDocumentLabel = (filename?: string, mimeType?: string) => {
  const ext = filename?.split(".").pop();
  if (ext && ext.length <= 6) return ext.toUpperCase();

  if (!mimeType) return "DOC";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.includes("ofx")) return "OFX";
  if (mimeType.includes("csv")) return "CSV";
  if (mimeType.includes("pkcs12")) return "PFX";
  if (mimeType.includes("xml") && !mimeType.includes("officedocument")) return "XML";
  if (mimeType.includes("word")) return "DOC";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet"))
    return "XLS";
  if (mimeType.includes("powerpoint") || mimeType.includes("presentation"))
    return "PPT";
  if (mimeType.startsWith("text/")) return "TXT";

  return "DOC";
};

const getDocumentAccentClass = (label: string) => {
  switch (label) {
    case "PDF":
      return "bg-red-500";
    case "DOC":
    case "DOCX":
      return "bg-blue-500";
    case "XLS":
    case "XLSX":
    case "CSV":
      return "bg-emerald-500";
    case "PPT":
    case "PPTX":
      return "bg-amber-500";
    case "TXT":
      return "bg-gray-600";
    case "XML":
    case "OFX":
      return "bg-teal-600";
    default:
      return "bg-gray-500";
  }
};

const filenameExtRegex = /\.[A-Za-z0-9]{1,6}$/;

const parseFilenameFromDocumentText = (text?: string): string | undefined => {
  const t = text?.trim();
  if (!t || !filenameExtRegex.test(t)) return undefined;
  return t;
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  onRetry,
  onResendUndelivered,
  onRetryTranscript,
  onDeleteMessage,
  deleteMode = "system",
  onEditMessage,
  onReply,
  onReact,
  onQuotedClick,
  contactName,
  isGroup,
}) => {
  const payload = message.payload ?? {};
  const isClient = message.author === "cliente";
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showOriginalText, setShowOriginalText] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const editFieldRef = useRef<HTMLTextAreaElement | null>(null);
  // O item escolhido no menu leva o foco para outro lugar (ver onCloseAutoFocus)
  const skipMenuFocusReturn = useRef(false);

  // UI-only metadata (falha/envio)
  const local = (message as unknown as LocalMeta) ?? {};
  const localStatus = local.localStatus;
  const localError = local.localError;

  const rawMediaUrl =
    message.mediaUrl ??
    (payload?.image?.url ||
      payload?.audio?.url ||
      payload?.sticker?.url ||
      payload?.video?.url ||
      payload?.document?.url ||
      undefined);
  // Bucket privado: troca a URL gravada por um link assinado e temporário
  const mediaUrl = useMediaUrl(rawMediaUrl);
  const mediaLoading = Boolean(rawMediaUrl) && !mediaUrl;

  // Vídeo fica gravado como documento (QR Code e Meta): toca na conversa.
  // Vale o tipo do arquivo ou, sem ele, a extensão do nome.
  const isVideoFile =
    (message.type === "document" || message.type === "video") &&
    looksLikeVideo(message.mediaMimeType, message.filename);
  const mediaType = isVideoFile
    ? "video"
    : message.type ??
    (payload.image
      ? "image"
      : payload.audio
        ? "audio"
        : payload.sticker
          ? "sticker"
          : payload.video
            ? "video"
            : payload.document
              ? "document"
              : "text");

  const captionFromPayload =
    payload?.image?.caption ?? payload?.document?.caption ?? null;

  const displayText = message.text || captionFromPayload || "";
  const transcriptStatus = message.transcriptStatus;
  const transcriptText = message.transcriptText;

  useEffect(() => {
    setIsExpanded(false);
  }, [displayText]);

  const documentData =
    payload?.document ??
    payload?.message?.document ??
    payload?.messages?.[0]?.document ??
    payload?.data?.document ??
    payload?.value?.document ??
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.document;

  const documentFilename =
    message.filename ??
    documentData?.filename ??
    documentData?.name ??
    (mediaType === "document"
      ? parseFilenameFromDocumentText(message.text)
      : undefined);

  const documentFileSize =
    message.fileSize ??
    documentData?.file_size ??
    documentData?.filesize ??
    undefined;

  const documentLabel = getDocumentLabel(
    documentFilename,
    message.mediaMimeType,
  );
  const documentSize = formatBytes(documentFileSize);
  const documentMeta = documentSize
    ? `${documentLabel} · ${documentSize}`
    : documentLabel;
  const documentAccentClass = getDocumentAccentClass(documentLabel);

  const hasMedia = Boolean(rawMediaUrl);

  const onlyAudio = mediaType === "audio";
  // Figurinha aparece solta, sem balão (como no WhatsApp)
  const isSticker = mediaType === "sticker";
  const onlyDocument =
    mediaType === "document" && (!displayText || !displayText.trim());

  const bubbleBase = "space-y-2";
  const bubblePadding = hasMedia ? "p-2" : "px-4 py-3";

  const bubbleClass =
    onlyAudio || onlyDocument || isSticker
      ? bubbleBase
      : `${bubbleBase} ${
          isClient
            ? `rounded-lg ${bubblePadding} bg-gray-200 text-gray-900`
            : `rounded-lg ${bubblePadding} bg-[#0A84FF] text-white`
        }`;

  // A linha de status só aparece em caso de erro; o progresso fica nos ticks.
  const showStatusRow = !isClient && localStatus === "failed";
  const canRetryFailedMessage =
    localStatus === "failed" && typeof onRetry === "function";

  // Atalhos: copiar o Pix e abrir a localização no Maps
  const quickText = message.deletedAt || rawMediaUrl ? "" : displayText;
  const pixAction = useMemo(() => pixFromText(quickText), [quickText]);
  const locationLink = useMemo(
    () => locationMapsLinkFromText(quickText),
    [quickText],
  );

  const maxPreviewLength = 200;
  const shouldTruncate = displayText.length > maxPreviewLength;
  const visibleText =
    shouldTruncate && !isExpanded
      ? displayText.slice(0, maxPreviewLength).trimEnd()
      : displayText;

  const statusNode = useMemo(() => {
    if (!showStatusRow) return null;

    if (localStatus === "failed") {
      return (
        <div className="flex items-center justify-end gap-2 mt-1">
          <span className="text-xs text-red-600">Não enviada</span>

          {canRetryFailedMessage && (
            <button
              type="button"
              onClick={() => onRetry(message)}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Reenviar
            </button>
          )}
        </div>
      );
    }

    return null;
  }, [showStatusRow, localStatus, canRetryFailedMessage, onRetry, message]);

  const errorHintNode = useMemo(() => {
    if (!showStatusRow) return null;
    if (localStatus !== "failed") return null;
    if (!localError) return null;
    if (canRetryFailedMessage) return null;

    return (
      <div className="flex items-center justify-end mt-1">
        <span className="text-[11px] text-gray-400 max-w-[320px] text-right">
          {localError}
        </span> {/* 🌟 CORRIGIDO: Fechamento da tag alterado para </span> */}
      </div>
    );
  }, [showStatusRow, localStatus, localError, canRetryFailedMessage]);

  // O WhatsApp avisou que não entregou (mensagem já gravada, sem erro local)
  const isUndelivered =
    !isClient &&
    !message.deletedAt &&
    localStatus !== "failed" &&
    localStatus !== "sending" &&
    message.deliveryStatus === "failed";

  // Editada no WhatsApp: "Editada" ao lado da hora mostra o texto de antes
  const isEdited = !!message.editedAt && !message.deletedAt;
  const canShowOriginal = isEdited && !!message.originalText?.trim();
  const editedLabel = isEdited ? (
    canShowOriginal ? (
      <button
        type="button"
        onClick={() => setShowOriginalText((v) => !v)}
        className="italic hover:underline"
        title={showOriginalText ? "Esconder o texto de antes" : "Ver o texto de antes da edição"}
        aria-expanded={showOriginalText}
      >
        Editada
      </button>
    ) : (
      <span className="italic" title="Mensagem editada no WhatsApp">
        Editada
      </span>
    )
  ) : null;
  const editNoticeNode = isEdited ? (
    <>
      {canShowOriginal && showOriginalText && (
        <div className="mt-1 border-l-2 border-gray-300 pl-2 text-xs text-gray-500">
          <span className="font-medium">Antes da edição: </span>
          <span className="whitespace-pre-wrap break-words">{message.originalText}</span>
        </div>
      )}
      {message.editUnreadable && (
        <div className="mt-1 flex items-start gap-1 text-xs text-amber-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Mensagem editada no WhatsApp. O texto novo não chegou ao Unxet: veja no celular.</span>
        </div>
      )}
    </>
  ) : null;

  const undeliveredNode = isUndelivered ? (
    <div className="flex items-center justify-end gap-2 mt-1">
      <span
        className="flex items-center gap-1 text-xs text-red-600"
        title={
          message.failureReason
            ? `O WhatsApp não entregou esta mensagem: ${message.failureReason}`
            : "O WhatsApp não entregou esta mensagem ao cliente. Confira a conexão do número em Integrações e reenvie."
        }
      >
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        Não entregue
      </span>
      {onResendUndelivered && (
        <button
          type="button"
          onClick={() => onResendUndelivered(message)}
          className="text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          Reenviar
        </button>
      )}
    </div>
  ) : null;

  // Ticks como no WhatsApp: ✓ enviada, ✓✓ entregue, ✓✓ verde lida pelo cliente.
  const deliveryIcon = (() => {
    if (isUndelivered) {
      return (
        <AlertCircle className="h-4 w-4 text-red-500" aria-label="Não entregue" />
      );
    }

    if (
      isClient ||
      message.deletedAt ||
      localStatus === "failed" ||
      localStatus === "sending"
    ) {
      return null;
    }

    if (message.deliveryStatus === "read") {
      return (
        <CheckCheck
          className="h-4 w-4 text-emerald-500"
          aria-label="Visualizada"
        />
      );
    }

    if (message.deliveryStatus === "delivered") {
      return (
        <CheckCheck className="h-4 w-4 text-gray-400" aria-label="Recebida" />
      );
    }

    return <Check className="h-4 w-4 text-gray-400" aria-label="Enviada" />;
  })();

  const deleteLabel =
    deleteMode === "everyone" ? "Apagar para todos" : "Remover do Unxet";

  const openEditDialog = () => {
    skipMenuFocusReturn.current = true;
    setEditDraft(message.text ?? "");
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!onEditMessage) return;
    const text = editDraft.trim();
    if (!text) return;
    if (text === (message.text ?? "").trim()) {
      setIsEditDialogOpen(false);
      return;
    }
    setIsSavingEdit(true);
    try {
      const ok = await onEditMessage(message.id, text);
      if (ok) setIsEditDialogOpen(false);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!onDeleteMessage) return;
    setIsDeleting(true);
    try {
      await onDeleteMessage(message.id);
      setIsDeleteDialogOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  // Mobile: pressionar e segurar a mensagem abre o menu (como no WhatsApp).
  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => clearLongPress, []);

  const handleTouchStart = () => {
    longPressFired.current = false;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      longPressTimer.current = null;
      navigator.vibrate?.(30);
      setIsMenuOpen(true);
    }, 500);
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    clearLongPress();
    // Evita que o toque longo vire um clique na mensagem.
    if (longPressFired.current) event.preventDefault();
  };

  const isPersisted =
    !message.deletedAt && !message.id.startsWith("local-");

  const canDelete =
    !isClient &&
    !!onDeleteMessage &&
    isPersisted &&
    localStatus !== "sending";

  // Itens do menu da setinha
  const canCopy = !message.deletedAt && !!displayText.trim();
  const canDownload = !message.deletedAt && !!mediaUrl;
  const canReplyHere = !!onReply && isPersisted;
  const canEdit = !isClient && !!onEditMessage && isPersisted && localStatus !== "sending";
  const canReactHere = !!onReact && isPersisted;
  // Figurinha guardada na pasta da empresa pode ir para as favoritas
  const favoriteStickerPath =
    isSticker && !message.deletedAt ? stickerPathFromUrl(rawMediaUrl) : null;
  const canFavoriteSticker = !!favoriteStickerPath;
  const hasMenu =
    canCopy ||
    canDownload ||
    canReplyHere ||
    canReactHere ||
    canEdit ||
    canDelete ||
    canFavoriteSticker;

  const handleFavoriteSticker = async () => {
    if (!favoriteStickerPath) return;
    try {
      const result = await addStickerFavorite(favoriteStickerPath);
      toast.success(
        result === "added"
          ? "Figurinha adicionada às favoritas."
          : "Essa figurinha já está nas favoritas.",
        { autoClose: 1500 },
      );
    } catch (err) {
      console.error("Erro ao favoritar figurinha:", err);
      toast.error("Não foi possível adicionar a figurinha às favoritas.");
    }
  };

  const handleCopy = () =>
    copyText(displayText, "Mensagem copiada.", "Não foi possível copiar a mensagem.");

  const handleCopyPix = () => {
    if (!pixAction) return;
    void copyText(
      pixAction.value,
      pixAction.kind === "code" ? "Código Pix copiado." : "Chave Pix copiada.",
      "Não foi possível copiar o Pix.",
    );
  };

  const copyText = async (value: string, success: string, failure: string) => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      // Sem permissão para a área de transferência: cópia pelo jeito antigo
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      area.remove();
    }
    if (copied) toast.success(success, { autoClose: 1500 });
    else toast.error(failure);
  };

  // O link assinado é de outro domínio: o atributo download não vale, então
  // baixa o arquivo e salva com o nome certo
  const handleDownload = async () => {
    if (!mediaUrl) return;
    try {
      const resp = await fetch(mediaUrl);
      if (!resp.ok) throw new Error(String(resp.status));
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = downloadName(message, documentFilename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      window.open(mediaUrl, "_blank", "noopener,noreferrer");
    }
  };

  const clientReaction = message.deletedAt ? undefined : message.clientReaction;
  const agentReaction = message.deletedAt ? undefined : message.agentReaction;
  const hasReactions = !!clientReaction || !!agentReaction;
  const reactionTitle = [
    clientReaction
      ? `${(isGroup ? "Participante" : contactName?.trim()) || "Cliente"}: ${clientReaction}`
      : null,
    agentReaction ? `Empresa: ${agentReaction}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const quoted = message.deletedAt ? undefined : message.replyTo;
  const quotedOnDark = !isClient && !onlyAudio && !onlyDocument;

  // Quem respondeu (o cliente recebe o nome na 1ª linha da mensagem). No
  // grupo, também quem escreveu do lado do cliente.
  const senderName =
    !isClient || isGroup
      ? message.senderName?.trim() || (isClient ? "Participante" : undefined)
      : undefined;
  const senderTint = senderName
    ? senderColor(message.senderUserId ?? senderName)
    : undefined;

  return (
    <div className={`flex w-full ${isClient ? "justify-start" : "justify-end"}`}>
      <div
        className={`flex min-w-0 items-end gap-1 max-w-[88%] sm:gap-2 sm:max-w-[min(40rem,88%)] ${
          isClient ? "" : "flex-row-reverse"
        }`}
      >
        {senderName && (
          <span
            className="mb-0.5 hidden h-7 w-7 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold text-white sm:flex"
            style={{ backgroundColor: senderTint }}
            title={senderName}
            aria-hidden="true"
          >
            {senderInitials(senderName)}
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          {senderName && (
            <span
              className={`mb-0.5 truncate px-1 text-xs font-semibold ${isClient ? "self-start" : "self-end"}`}
              style={{ color: senderTint }}
            >
              {senderName}
            </span>
          )}
          <div
            className={`group/bubble relative max-w-full ${isClient ? "self-start" : "self-end"} ${hasMenu ? "[@media(hover:none)]:select-none" : ""} ${hasReactions ? "mb-3" : ""}`}
            onTouchStart={hasMenu ? handleTouchStart : undefined}
            onTouchMove={hasMenu ? clearLongPress : undefined}
            onTouchEnd={hasMenu ? handleTouchEnd : undefined}
            onTouchCancel={hasMenu ? clearLongPress : undefined}
            onContextMenu={
              hasMenu
                ? (event) => {
                    // No celular o toque longo abre o nosso menu, não o do sistema.
                    if (window.matchMedia("(hover: none)").matches) {
                      event.preventDefault();
                    }
                  }
                : undefined
            }
          >
            <div className={bubbleClass}>
              {quoted && (
                <QuotedMessage
                  preview={quoted}
                  contactName={contactName}
                  onDark={quotedOnDark}
                  onClick={
                    quoted.id && onQuotedClick
                      ? () => onQuotedClick(quoted.id as string)
                      : undefined
                  }
                  className={onlyAudio || onlyDocument ? "max-w-72" : ""}
                />
              )}
              {mediaLoading &&
                (mediaType === "video" ? (
                  <div
                    className={`flex aspect-video w-72 max-w-full animate-pulse flex-col items-center justify-center gap-2 rounded-xl ${
                      isClient ? "bg-gray-200 text-gray-500" : "bg-[#fff]/15 text-white/90"
                    }`}
                    aria-label="Carregando vídeo"
                  >
                    <FilmIcon className="h-8 w-8" aria-hidden />
                    <span className="text-xs font-medium">Carregando vídeo...</span>
                  </div>
                ) : isSticker ? (
                  <div
                    className="h-32 w-32 animate-pulse rounded-2xl bg-gray-200"
                    aria-label="Carregando figurinha"
                  />
                ) : (
                  <div
                    className="h-12 w-48 max-w-full animate-pulse rounded-lg bg-black/10"
                    aria-label="Carregando mídia"
                  />
                ))}
              {mediaUrl && (
                <>
                  {mediaType === "image" && (
                    <img
                      src={mediaUrl}
                      alt="Imagem"
                      className="h-48 w-48 max-w-full cursor-zoom-in rounded-lg object-cover"
                      onClick={() => setPreviewSrc(mediaUrl)}
                    />
                  )}

                  {mediaType === "audio" && (
                    <div className="space-y-1">
                      <AudioPlayer src={mediaUrl} outgoing={!isClient} />
                      <AudioTranscriptStatus
                        status={transcriptStatus}
                        transcriptText={transcriptText}
                        onRetry={
                          onRetryTranscript
                            ? () => onRetryTranscript(message)
                            : undefined
                        }
                      />
                    </div>
                  )}

                  {mediaType === "video" && (
                    <VideoPlayer
                      src={mediaUrl}
                      outgoing={!isClient}
                      filename={message.filename}
                    />
                  )}

                  {mediaType === "document" && (
                    // Cartão do documento: nome inteiro e faixa com Abrir e Baixar.
                    // Recebido: branco. Enviado: azul (translúcido dentro do balão com legenda).
                    <div
                      className={`w-72 max-w-full overflow-hidden rounded-2xl ${
                        isClient
                          ? "border border-gray-200 bg-white shadow-sm"
                          : onlyDocument
                            ? "bg-[#0A84FF] text-white shadow-sm"
                            : "bg-[#fff]/15 text-white"
                      }`}
                    >
                      <a
                        href={mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={`Abrir ${documentFilename || "documento"}`}
                        className={`flex items-center gap-3 p-3 transition-colors ${
                          isClient ? "hover:bg-gray-50" : "hover:bg-[#fff]/10"
                        }`}
                      >
                        <div
                          className={`flex h-12 w-11 flex-shrink-0 flex-col items-center justify-center rounded-lg shadow-sm ${documentAccentClass} ${
                            isClient ? "" : "ring-1 ring-white/40"
                          }`}
                        >
                          <FileTextIcon className="h-5 w-5 text-white/90" />
                          <span className="mt-0.5 max-w-full truncate px-0.5 text-[9px] font-bold leading-none tracking-wide text-white">
                            {documentLabel}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`line-clamp-2 break-words text-sm font-semibold leading-snug ${
                              isClient ? "text-gray-900" : "text-white"
                            }`}
                          >
                            {documentFilename || "Documento"}
                          </p>
                          <p
                            className={`mt-0.5 text-xs ${
                              isClient ? "text-gray-500" : "text-blue-100"
                            }`}
                          >
                            {documentMeta}
                          </p>
                        </div>
                      </a>
                      <div
                        className={`grid grid-cols-2 divide-x border-t text-sm font-medium ${
                          isClient
                            ? "divide-gray-200 border-gray-200 text-[#0A84FF]"
                            : "divide-white/25 border-white/25 text-white"
                        }`}
                      >
                        <a
                          href={mediaUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`flex items-center justify-center gap-1.5 py-2 transition-colors ${
                            isClient ? "hover:bg-blue-50" : "hover:bg-[#fff]/10"
                          }`}
                        >
                          <ExternalLinkIcon className="h-4 w-4" />
                          Abrir
                        </a>
                        <a
                          href={mediaUrl}
                          download={documentFilename || true}
                          target="_blank"
                          rel="noreferrer"
                          className={`flex items-center justify-center gap-1.5 py-2 transition-colors ${
                            isClient ? "hover:bg-blue-50" : "hover:bg-[#fff]/10"
                          }`}
                        >
                          <DownloadIcon className="h-4 w-4" />
                          Baixar
                        </a>
                      </div>
                    </div>
                  )}

                  {mediaType === "sticker" && (
                    <img
                      src={mediaUrl}
                      alt="Figurinha"
                      className="h-32 w-32 cursor-zoom-in object-contain drop-shadow-sm"
                      onClick={() => setPreviewSrc(mediaUrl)}
                    />
                  )}
                </>
              )}

              {displayText && mediaType !== "audio" && !onlyAudio ? (
                <div className="text-sm whitespace-pre-wrap break-words">
                  <span>
                    <WhatsappText text={visibleText} />
                    {shouldTruncate && !isExpanded ? "..." : ""}
                  </span>
                  {shouldTruncate && (
                    <button
                      type="button"
                      onClick={() => setIsExpanded((prev) => !prev)}
                      className={`ml-2 text-xs font-medium ${
                        isClient
                          ? "text-blue-600 hover:text-blue-700"
                          : "text-white underline hover:text-blue-100"
                      }`}
                    >
                      {isExpanded ? "Ler menos" : "Ler mais..."}
                    </button>
                  )}
                </div>
              ) : null}

              {(pixAction || locationLink) && (
                <div
                  className={`-mx-4 -mb-3 mt-2 border-t text-sm font-medium ${
                    isClient
                      ? "border-gray-300 text-[#0A84FF]"
                      : "border-white/25 text-white"
                  }`}
                >
                  {pixAction ? (
                    <button
                      type="button"
                      onClick={handleCopyPix}
                      className={`flex w-full items-center justify-center gap-1.5 rounded-b-lg py-2 transition-colors ${
                        isClient ? "hover:bg-gray-300/60" : "hover:bg-[#fff]/10"
                      }`}
                    >
                      <Copy className="h-4 w-4" />
                      {pixAction.kind === "code" ? "Copiar código Pix" : "Copiar chave Pix"}
                    </button>
                  ) : (
                    <a
                      href={locationLink ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex w-full items-center justify-center gap-1.5 rounded-b-lg py-2 transition-colors ${
                        isClient ? "hover:bg-gray-300/60" : "hover:bg-[#fff]/10"
                      }`}
                    >
                      <MapPin className="h-4 w-4" />
                      Abrir no Google Maps
                    </a>
                  )}
                </div>
              )}
            </div>

            {hasReactions && (
              <span
                title={reactionTitle}
                className={`absolute -bottom-3 flex select-none items-center gap-0.5 rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-sm leading-none shadow-sm ${
                  isClient ? "left-2" : "right-2"
                }`}
              >
                {clientReaction && <span>{clientReaction}</span>}
                {agentReaction && agentReaction !== clientReaction && (
                  <span>{agentReaction}</span>
                )}
                {clientReaction && agentReaction && (
                  <span className="ml-0.5 text-[10px] font-medium text-gray-500">
                    2
                  </span>
                )}
              </span>
            )}

            {hasMenu && (
              <DropdownMenu.Root
                open={isMenuOpen}
                onOpenChange={setIsMenuOpen}
                modal={false}
              >
                {/* No celular o toque simples "gruda" o :hover; a seta só aparece com o menu aberto (toque longo). */}
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    title="Opções da mensagem"
                    aria-label="Opções da mensagem"
                    className={`absolute flex items-center opacity-0 transition-opacity duration-150 focus-visible:opacity-100 [@media(hover:hover)]:group-hover/bubble:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:pointer-events-none ${
                      onlyAudio || onlyDocument || isSticker || mediaType === "image" || mediaType === "video"
                        ? "right-1 top-1 h-6 w-6 justify-center rounded-full bg-white/90 text-gray-600 shadow-sm"
                        : isClient
                          ? "right-0 top-0 h-7 w-10 justify-end rounded-tr-lg bg-gradient-to-l from-gray-200 from-60% to-transparent pr-1.5 text-gray-600"
                          : "right-0 top-0 h-7 w-10 justify-end rounded-tr-lg bg-gradient-to-l from-[#0A84FF] from-60% to-transparent pr-1.5 text-white"
                    }`}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align={isClient ? "start" : "end"}
                    sideOffset={4}
                    collisionPadding={8}
                    // Responder, Editar e Apagar levam o foco para outro lugar
                    // (campo de texto ou janela): o menu não devolve o foco à setinha
                    onCloseAutoFocus={(event) => {
                      if (skipMenuFocusReturn.current) event.preventDefault();
                      skipMenuFocusReturn.current = false;
                    }}
                    className="z-[60] min-w-[200px] rounded-lg border border-gray-200 bg-white py-1.5 shadow-lg"
                  >
                    {canReactHere && (
                      <>
                        <div
                          className="flex items-center justify-between gap-0.5 px-2 pb-1.5 pt-0.5"
                          role="group"
                          aria-label="Reagir"
                        >
                          {QUICK_REACTIONS.map((emoji) => {
                            const selected = agentReaction === emoji;
                            return (
                              <DropdownMenu.Item
                                key={emoji}
                                onSelect={() =>
                                  onReact?.(message, selected ? null : emoji)
                                }
                                title={selected ? "Remover reação" : `Reagir com ${emoji}`}
                                className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-xl outline-none transition-transform data-[highlighted]:scale-110 data-[highlighted]:bg-gray-100 ${
                                  selected ? "bg-blue-100" : ""
                                }`}
                              >
                                {emoji}
                              </DropdownMenu.Item>
                            );
                          })}
                        </div>
                        <DropdownMenu.Separator className="my-1 h-px bg-gray-200" />
                      </>
                    )}
                    {canReplyHere && (
                      <DropdownMenu.Item
                        onSelect={() => {
                          skipMenuFocusReturn.current = true;
                          onReply?.(message);
                        }}
                        className={MENU_ITEM_CLASS}
                      >
                        <Reply className="h-4 w-4 text-gray-500" />
                        Responder
                      </DropdownMenu.Item>
                    )}
                    {canCopy && (
                      <DropdownMenu.Item
                        onSelect={() => void handleCopy()}
                        className={MENU_ITEM_CLASS}
                      >
                        <Copy className="h-4 w-4 text-gray-500" />
                        Copiar
                      </DropdownMenu.Item>
                    )}
                    {canFavoriteSticker && (
                      <DropdownMenu.Item
                        onSelect={() => void handleFavoriteSticker()}
                        className={MENU_ITEM_CLASS}
                      >
                        <Star className="h-4 w-4 text-gray-500" />
                        Adicionar às favoritas
                      </DropdownMenu.Item>
                    )}
                    {canDownload && (
                      <DropdownMenu.Item
                        onSelect={() => void handleDownload()}
                        className={MENU_ITEM_CLASS}
                      >
                        <DownloadIcon className="h-4 w-4 text-gray-500" />
                        Baixar
                      </DropdownMenu.Item>
                    )}
                    {canEdit && (
                      <DropdownMenu.Item
                        onSelect={openEditDialog}
                        className={MENU_ITEM_CLASS}
                      >
                        <Pencil className="h-4 w-4 text-gray-500" />
                        Editar
                      </DropdownMenu.Item>
                    )}
                    {canDelete && (
                      <>
                        {(canReplyHere || canCopy || canDownload || canEdit || canFavoriteSticker) && (
                          <DropdownMenu.Separator className="my-1 h-px bg-gray-200" />
                        )}
                        <DropdownMenu.Item
                          onSelect={() => {
                            skipMenuFocusReturn.current = true;
                            setIsDeleteDialogOpen(true);
                          }}
                          className={MENU_ITEM_CLASS}
                        >
                          <Trash2 className="h-4 w-4 text-gray-500" />
                          Apagar
                        </DropdownMenu.Item>
                      </>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}
          </div>

          {editNoticeNode}
          {statusNode}
          {errorHintNode}
          {undeliveredNode}

          <span
            className={`mt-1 flex items-center gap-1 text-xs text-gray-500 ${
              isClient ? "justify-start" : "justify-end"
            }`}
          >
            {editedLabel}
            {formatTime(message.createdAt)}
            {deliveryIcon}
          </span>
        </div>
      </div>

      {canEdit && (
        <Dialog.Root
          open={isEditDialogOpen}
          onOpenChange={(open) => {
            if (!isSavingEdit) setIsEditDialogOpen(open);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
            <Dialog.Content
              // Foco no texto com o cursor no fim, pronto para continuar escrevendo
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                const field = editFieldRef.current;
                if (!field) return;
                field.focus();
                field.setSelectionRange(field.value.length, field.value.length);
              }}
              className="fixed left-1/2 top-1/2 z-[80] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl sm:p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <Dialog.Title className="text-base font-semibold text-gray-900">
                  Editar mensagem
                </Dialog.Title>
                <CloseButton
                  className="-mr-2 -mt-1"
                  onClick={() => {
                    if (!isSavingEdit) setIsEditDialogOpen(false);
                  }}
                />
              </div>
              <Dialog.Description className="mt-1 text-sm text-gray-600">
                O cliente vê o texto novo com a marca "Editada". O WhatsApp só permite editar até 15 minutos depois do envio.
              </Dialog.Description>
              <textarea
                value={editDraft}
                onChange={(event) => setEditDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSaveEdit();
                  }
                }}
                maxLength={MAX_EDIT_TEXT_LENGTH}
                rows={4}
                ref={editFieldRef}
                aria-label="Texto da mensagem"
                className="mt-4 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
              />
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    disabled={isSavingEdit}
                    className="rounded-full border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  onClick={() => void handleSaveEdit()}
                  disabled={isSavingEdit || !editDraft.trim()}
                  className="rounded-full bg-[#0A84FF] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                  {isSavingEdit ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {canDelete && (
        <Dialog.Root
          open={isDeleteDialogOpen}
          onOpenChange={(open) => {
            if (!isDeleting) setIsDeleteDialogOpen(open);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[80] w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl sm:p-6">
              <Dialog.Title className="text-base font-semibold text-gray-900">
                {deleteMode === "everyone"
                  ? "Apagar mensagem?"
                  : "Remover mensagem?"}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-gray-600">
                {deleteMode === "everyone"
                  ? "A mensagem também será apagada no WhatsApp do cliente."
                  : "Este canal não permite apagar mensagens já entregues, então o cliente continuará vendo a mensagem. Ela será removida apenas do Unxet."}
              </Dialog.Description>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    disabled={isDeleting}
                    className="rounded-full border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="rounded-full bg-red-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                >
                  {isDeleting ? "Apagando..." : deleteLabel}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {previewSrc && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewSrc(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Escape") setPreviewSrc(null);
          }}
        >
          <img
            src={previewSrc}
            alt="Pré-visualização"
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};