import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLinkIcon, Reply } from "lucide-react";
import type { Message as UiMessage } from "../../types";
import { useMediaUrl } from "../../lib/mediaUrls";
import { CloseButton } from "../ui/CloseButton";
import { ZoomableImage } from "./ZoomableImage";

interface MessageAlbumProps {
  messages: UiMessage[];
  isGroup?: boolean;
  /** Responder citando uma das fotos (aberta no visualizador) */
  onReply?: (message: UiMessage) => void;
}

const formatTime = (timestamp: string) =>
  new Date(timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const AlbumThumb: React.FC<{
  message: UiMessage;
  extra: number;
  onOpen: () => void;
}> = ({ message, extra, onOpen }) => {
  const url = useMediaUrl(message.mediaUrl);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative aspect-square w-full cursor-zoom-in overflow-hidden rounded-md bg-black/10"
      aria-label={extra ? `Ver mais ${extra} fotos` : "Ver foto"}
    >
      {url ? (
        <img src={url} alt="Foto do álbum" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="block h-full w-full animate-pulse bg-black/10" />
      )}
      {extra > 0 && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-3xl font-semibold text-white">
          +{extra}
        </span>
      )}
    </button>
  );
};

const ViewerImage: React.FC<{ message: UiMessage; onBackgroundClick: () => void }> = ({
  message,
  onBackgroundClick,
}) => {
  const url = useMediaUrl(message.mediaUrl);
  if (!url) {
    return <div className="h-64 w-64 animate-pulse rounded-lg bg-white/10" aria-label="Carregando foto" />;
  }
  return (
    <ZoomableImage
      src={url}
      alt="Foto do álbum"
      onBackgroundClick={onBackgroundClick}
      className="self-stretch"
    />
  );
};

const ViewerOpenLink: React.FC<{ message: UiMessage }> = ({ message }) => {
  const url = useMediaUrl(message.mediaUrl);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
    >
      <ExternalLinkIcon className="h-4 w-4" />
      Abrir
    </a>
  );
};

/**
 * Fotos seguidas como álbum (ver lib/messageAlbums.ts): as 4 primeiras em
 * grade e "+N" na última. O clique abre o visualizador com todas.
 */
export const MessageAlbum: React.FC<MessageAlbumProps> = ({ messages, isGroup, onReply }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const first = messages[0];
  const last = messages[messages.length - 1];
  const isClient = first.author === "cliente";
  const shown = messages.slice(0, 4);
  const extra = messages.length - shown.length;
  const senderName =
    !isClient || isGroup
      ? first.senderName?.trim() || (isClient ? "Participante" : undefined)
      : undefined;

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback(
    (delta: number) =>
      setOpenIndex((index) =>
        index === null ? null : (index + delta + messages.length) % messages.length,
      ),
    [messages.length],
  );

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, close, step]);

  const current = openIndex === null ? null : messages[openIndex];

  return (
    <div className={`flex w-full ${isClient ? "justify-start" : "justify-end"}`}>
      {/* Âncoras de cada foto: a citação de uma delas rola até o álbum */}
      {messages.map((message) => (
        <span key={message.id} data-message-id={message.id} className="sr-only" />
      ))}
      <div className="flex min-w-0 max-w-[88%] flex-col">
        {senderName && (
          <span
            className={`mb-0.5 truncate px-1 text-xs font-semibold text-gray-500 ${
              isClient ? "self-start" : "self-end"
            }`}
          >
            {senderName}
          </span>
        )}
        <div
          className={`grid w-72 max-w-full grid-cols-2 gap-1 rounded-lg p-1 ${
            isClient ? "self-start bg-gray-200" : "self-end bg-[#0A84FF]"
          }`}
        >
          {shown.map((message, index) => (
            <AlbumThumb
              key={message.id}
              message={message}
              extra={index === shown.length - 1 ? extra : 0}
              onOpen={() => setOpenIndex(index)}
            />
          ))}
        </div>
        <span
          className={`mt-1 flex items-center gap-1 text-xs text-gray-500 ${
            isClient ? "justify-start" : "justify-end"
          }`}
        >
          {messages.length} fotos · {formatTime(last.createdAt)}
        </span>
      </div>

      {current && openIndex !== null && (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-black/85"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Fotos do álbum"
        >
          <div
            className="flex items-center justify-between gap-3 p-3 text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="text-sm">
              {openIndex + 1} de {messages.length} · {formatTime(current.createdAt)}
            </span>
            <div className="flex items-center gap-2">
              {onReply && (
                <button
                  type="button"
                  onClick={() => {
                    onReply(current);
                    close();
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
                >
                  <Reply className="h-4 w-4" />
                  Responder
                </button>
              )}
              <ViewerOpenLink message={current} />
              <CloseButton
                onClick={close}
                className="text-white hover:bg-white/10 hover:text-white"
              />
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6">
            <ViewerImage key={current.id} message={current} onBackgroundClick={close} />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                step(-1);
              }}
              className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label="Foto anterior"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                step(1);
              }}
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label="Próxima foto"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
