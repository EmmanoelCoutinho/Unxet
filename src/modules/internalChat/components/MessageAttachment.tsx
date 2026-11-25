import React from "react";
import { DownloadIcon, FileTextIcon, ImageOffIcon, Loader2Icon } from "lucide-react";
import { AudioPlayer } from "../../../components/chat/AudioPlayer";
import { useMediaUrl } from "../../../lib/mediaUrls";
import { internalAttachmentUrl } from "../api/internalChat";
import type { InternalAttachment } from "../types/internalChat";
import { formatFileSize } from "../utils/attachments";

/** Link pronto para exibir: o arquivo local durante o envio ou o link assinado. */
function useAttachmentSrc(attachment: InternalAttachment) {
  const remote = useMediaUrl(
    attachment.localUrl || !attachment.path
      ? null
      : internalAttachmentUrl(attachment.path),
  );
  return attachment.localUrl ?? remote;
}

const Loading: React.FC<{ className?: string }> = ({ className }) => (
  <div
    className={`flex items-center justify-center rounded-lg bg-gray-100 ${className ?? ""}`}
  >
    <Loader2Icon className="h-5 w-5 animate-spin text-gray-400" aria-hidden />
  </div>
);

// Imagem e figurinha mudam a altura ao carregar: a conversa volta para o fim
type OnMediaLoad = { onMediaLoad?: () => void };

const ImageAttachment: React.FC<
  { attachment: InternalAttachment; compact: boolean } & OnMediaLoad
> = ({ attachment, compact, onMediaLoad }) => {
  const src = useAttachmentSrc(attachment);
  const [failed, setFailed] = React.useState(false);
  const size = compact ? "max-h-48 max-w-[14rem]" : "max-h-72 max-w-xs";

  if (!src) return <Loading className={compact ? "h-36 w-48" : "h-48 w-64"} />;
  if (failed) {
    return (
      <div className="flex h-24 w-40 flex-col items-center justify-center gap-1 rounded-lg bg-gray-100 text-xs text-gray-500">
        <ImageOffIcon className="h-5 w-5" aria-hidden />
        Imagem indisponível
      </div>
    );
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      title="Abrir imagem"
      className="block overflow-hidden rounded-lg"
    >
      <img
        src={src}
        alt={attachment.name ?? "Imagem"}
        className={`${size} object-contain`}
        onLoad={onMediaLoad}
        onError={() => setFailed(true)}
      />
    </a>
  );
};

const StickerAttachment: React.FC<
  { attachment: InternalAttachment } & OnMediaLoad
> = ({ attachment, onMediaLoad }) => {
  const src = useAttachmentSrc(attachment);
  if (!src) return <Loading className="h-28 w-28" />;
  return (
    <img
      src={src}
      alt="Figurinha"
      onLoad={onMediaLoad}
      className="h-28 w-28 object-contain"
    />
  );
};

const AudioAttachment: React.FC<{
  attachment: InternalAttachment;
  mine: boolean;
}> = ({ attachment, mine }) => {
  const src = useAttachmentSrc(attachment);
  if (!src) return <Loading className="h-10 w-56" />;
  return <AudioPlayer src={src} outgoing={mine} />;
};

const FileAttachment: React.FC<{
  attachment: InternalAttachment;
  mine: boolean;
}> = ({ attachment, mine }) => {
  const src = useAttachmentSrc(attachment);
  const name = attachment.name || "Arquivo";
  // Baixa com o nome original (o arquivo fica salvo com um nome aleatório)
  const href = src
    ? `${src}${src.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`
    : undefined;
  const size = formatFileSize(attachment.size);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={[
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
          mine ? "bg-white/20 text-white" : "bg-blue-50 text-[#0A84FF]",
        ].join(" ")}
      >
        <FileTextIcon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={name}>
          {name}
        </p>
        {size && (
          <p className={`text-xs ${mine ? "text-white/80" : "text-gray-500"}`}>
            {size}
          </p>
        )}
      </div>
      {attachment.path && (
        <a
          href={href}
          aria-disabled={!href}
          onClick={(event) => {
            if (!href) event.preventDefault();
          }}
          className={[
            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md",
            mine ? "hover:bg-white/20" : "text-gray-600 hover:bg-gray-100",
            href ? "" : "opacity-50",
          ].join(" ")}
          aria-label={`Baixar ${name}`}
          title="Baixar"
        >
          <DownloadIcon className="h-4 w-4" />
        </a>
      )}
    </div>
  );
};

/** Conteúdo do anexo dentro (ou no lugar) do balão da mensagem. */
export const MessageAttachment: React.FC<
  {
    attachment: InternalAttachment;
    mine: boolean;
    compact: boolean;
  } & OnMediaLoad
> = ({ attachment, mine, compact, onMediaLoad }) => {
  switch (attachment.kind) {
    case "image":
      return (
        <ImageAttachment
          attachment={attachment}
          compact={compact}
          onMediaLoad={onMediaLoad}
        />
      );
    case "sticker":
      return (
        <StickerAttachment attachment={attachment} onMediaLoad={onMediaLoad} />
      );
    case "audio":
      return <AudioAttachment attachment={attachment} mine={mine} />;
    default:
      return <FileAttachment attachment={attachment} mine={mine} />;
  }
};
