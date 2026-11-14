import React from "react";
import type { MessageReplyPreview } from "../../types";

/** Rótulo de quem escreveu a mensagem citada. */
const quotedAuthorLabel = (
  preview: MessageReplyPreview,
  contactName?: string,
) =>
  preview.author === "cliente"
    ? contactName?.trim() || "Cliente"
    : preview.senderName?.trim() || "Você";

const MEDIA_LABELS: Record<string, string> = {
  image: "📷 Foto",
  audio: "🎤 Áudio",
  video: "🎥 Vídeo",
  document: "📄 Documento",
  sticker: "Figurinha",
};

const quotedText = (preview: MessageReplyPreview) =>
  preview.text?.trim() ||
  (preview.type ? MEDIA_LABELS[preview.type] : undefined) ||
  "Mensagem";

type Props = {
  preview: MessageReplyPreview;
  contactName?: string;
  /** Dentro do balão azul (mensagem enviada) */
  onDark?: boolean;
  onClick?: () => void;
  className?: string;
};

/** Citação no estilo do WhatsApp: barra colorida, autor e começo do texto. */
export const QuotedMessage: React.FC<Props> = ({
  preview,
  contactName,
  onDark = false,
  onClick,
  className = "",
}) => {
  const isClient = preview.author === "cliente";
  const content = (
    <>
      <span
        className={`block truncate text-xs font-semibold ${
          onDark ? "text-white" : isClient ? "text-emerald-600" : "text-[#0A84FF]"
        }`}
      >
        {quotedAuthorLabel(preview, contactName)}
      </span>
      <span
        className={`line-clamp-2 break-words text-xs ${
          onDark ? "text-blue-50" : "text-gray-600"
        }`}
      >
        {quotedText(preview)}
      </span>
    </>
  );

  const base = `block w-full min-w-0 rounded-md border-l-4 px-2.5 py-1.5 text-left ${
    onDark
      ? "border-white/70 bg-[#fff]/15"
      : isClient
        ? "border-emerald-500 bg-black/5"
        : "border-[#0A84FF] bg-black/5"
  } ${className}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Ir para a mensagem"
        className={`${base} transition-opacity hover:opacity-80`}
      >
        {content}
      </button>
    );
  }
  return <div className={base}>{content}</div>;
};
