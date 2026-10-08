import React, { useEffect, useMemo, useState } from "react";
import { DownloadIcon, FileIcon, Trash2 } from "lucide-react"; // 🔥 Importado Trash2 para o visual do botão
import type { Message as UiMessage } from "../../types";
import { AudioTranscriptStatus } from "./AudioTranscriptStatus";
import { getSupabaseTransformedImageUrl } from "../../lib/imageUtils";

interface MessageBubbleProps {
  message: UiMessage;
  contactAvatar?: string;
  contactName?: string;

  /**
   * Opcional: usado para permitir "Reenviar" quando a mensagem é local e falhou.
   * Você deve passar essa função a partir do Chat.tsx.
   */
  onRetry?: (message: UiMessage) => void;
  onRetryTranscript?: (message: UiMessage) => Promise<void> | void;
  onDeleteMessage?: (messageId: string) => Promise<void>;
  /**
   * "everyone": o provedor apaga também no WhatsApp do cliente (Evolution).
   * "system": a API não permite (Meta); a mensagem some apenas do Unxet.
   */
  deleteMode?: "everyone" | "system";
}

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
      return "bg-emerald-500";
    case "PPT":
    case "PPTX":
      return "bg-amber-500";
    case "TXT":
      return "bg-gray-600";
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
  onRetryTranscript,
  onDeleteMessage,
  deleteMode = "system",
}) => {
  const payload = message.payload ?? {};
  const isClient = message.author === "cliente";
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // UI-only metadata (falha/envio)
  const local = (message as unknown as LocalMeta) ?? {};
  const localStatus = local.localStatus;
  const localError = local.localError;

  const mediaUrl =
    message.mediaUrl ??
    (payload?.image?.url ||
      payload?.audio?.url ||
      payload?.sticker?.url ||
      payload?.video?.url ||
      payload?.document?.url ||
      undefined);

  const mediaType =
    message.type ??
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
    ? `${documentLabel} - ${documentSize}`
    : documentLabel;
  const documentAccentClass = getDocumentAccentClass(documentLabel);

  const hasMedia = Boolean(mediaUrl);
  const imageThumbnailUrl =
    mediaType === "image" && mediaUrl
      ? getSupabaseTransformedImageUrl(mediaUrl, {
          width: 384,
          height: 384,
          quality: 78,
          resize: "cover",
        })
      : mediaUrl;
  const imagePreviewUrl =
    mediaType === "image" && mediaUrl
      ? getSupabaseTransformedImageUrl(mediaUrl, {
          width: 1600,
          quality: 88,
          resize: "contain",
        })
      : mediaUrl;

  const onlyAudio = mediaType === "audio";
  const onlyDocument =
    mediaType === "document" && (!displayText || !displayText.trim());

  const bubbleBase = "space-y-2";
  const bubblePadding = hasMedia ? "p-2" : "px-4 py-3";

  const bubbleClass =
    onlyAudio || onlyDocument
      ? bubbleBase
      : `${bubbleBase} ${
          isClient
            ? `rounded-lg ${bubblePadding} bg-[#E5E7EB] text-[#1E1E1E]`
            : `rounded-lg ${bubblePadding} bg-[#0A84FF] text-white`
        }`;

  const showStatusRow =
    !isClient && (localStatus === "sending" || localStatus === "failed");
  const canRetryFailedMessage =
    localStatus === "failed" && typeof onRetry === "function";

  const maxPreviewLength = 200;
  const shouldTruncate = displayText.length > maxPreviewLength;
  const visibleText =
    shouldTruncate && !isExpanded
      ? displayText.slice(0, maxPreviewLength).trimEnd()
      : displayText;

  const statusNode = useMemo(() => {
    if (!showStatusRow) return null;

    if (localStatus === "sending") {
      return (
        <div className="flex items-center justify-end gap-2 mt-1">
          <span className="text-xs text-gray-400">Enviando...</span>
        </div>
      );
    }

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

  const deleteLabel =
    deleteMode === "everyone" ? "Apagar para todos" : "Remover do Unxet";

  const handleDeleteClick = async () => {
    if (!onDeleteMessage) return;
    const confirmed = window.confirm(
      deleteMode === "everyone"
        ? "Apagar esta mensagem para todos? Ela também será apagada no WhatsApp do cliente."
        : "Remover esta mensagem do Unxet? Este canal não permite apagar mensagens já entregues, então o cliente continuará vendo a mensagem.",
    );
    if (confirmed) {
      await onDeleteMessage(message.id);
    }
  };

  const canDelete =
    !isClient &&
    !!onDeleteMessage &&
    !message.deletedAt &&
    !message.id.startsWith("local-") &&
    localStatus !== "sending";

  return (
    <div className={`flex w-full group ${isClient ? "justify-start" : "justify-end"}`}>
      <div
        className={`flex min-w-0 items-end gap-1 max-w-[88%] sm:gap-2 sm:max-w-md ${
          isClient ? "" : "flex-row-reverse"
        }`}
      >
        {canDelete && (
          <div className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 flex items-center mb-6 transition-opacity duration-150 order-first">
            <button
              type="button"
              onClick={handleDeleteClick}
              className="p-1.5 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
              title={deleteLabel}
              aria-label={deleteLabel}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex min-w-0 flex-col">
          <div className={bubbleClass}>
            {mediaUrl && (
              <>
                {mediaType === "image" && (
                  <img
                    src={imageThumbnailUrl}
                    alt="Imagem"
                    className="h-48 w-48 max-w-full cursor-zoom-in rounded-lg object-cover"
                    onError={(event) => {
                      if (event.currentTarget.src !== mediaUrl) {
                        event.currentTarget.src = mediaUrl;
                      }
                    }}
                    onClick={() => setPreviewSrc(imagePreviewUrl ?? mediaUrl)}
                  />
                )}

                {mediaType === "audio" && (
                  <div className="space-y-1">
                    <div
                      className={`
                        flex items-center gap-3 rounded-2xl px-3 py-2
                        ${isClient ? "bg-[#E5E7EB]" : "bg-[#0A84FF]"}
                        text-[#1E1E1E]
                      `}
                    >
                      <audio
                        controls
                        className="w-56 max-w-full h-9 bg-transparent outline-none"
                        src={mediaUrl}
                      >
                        Seu navegador não suporta o player de áudio.
                      </audio>
                    </div>
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
                  <video
                    controls
                    className="h-48 w-48 rounded-lg object-cover"
                    src={mediaUrl}
                  />
                )}

                {mediaType === "document" && (
                  <a
                    href={mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-[#1E1E1E] transition hover:bg-[#F3F4F6]"
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${documentAccentClass}`}
                    >
                      <FileIcon className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#111827] truncate">
                        {documentFilename || "Documento"}
                      </p>
                      <p className="text-xs text-[#6B7280]">{documentMeta}</p>
                    </div>
                    <div className="ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-[#D1D5DB] text-[#6B7280]">
                      <DownloadIcon className="h-4 w-4" />
                    </div>
                  </a>
                )}

                {mediaType === "sticker" && (
                  <img
                    src={mediaUrl}
                    alt="Figurinha"
                    className="h-24 w-24 rounded-lg object-cover"
                  />
                )}
              </>
            )}

            {displayText && mediaType !== "audio" && !onlyAudio ? (
              <div className="text-sm whitespace-pre-wrap break-words">
                <span>
                  {visibleText}
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
          </div>

          {statusNode}
          {errorHintNode}

          <span
            className={`text-xs text-gray-500 mt-1 ${
              isClient ? "text-left" : "text-right"
            }`}
          >
            {formatTime(message.createdAt)}
          </span>
        </div>
      </div>

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