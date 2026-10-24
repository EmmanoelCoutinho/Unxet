import React from "react";
import { FileTextIcon, Loader2Icon, XIcon } from "lucide-react";

export type PendingAttachment = {
  id: string;
  kind: "image" | "document";
  file: File;
  mimeType: string;
  extension: string;
  /** Prévia local da imagem (URL do navegador), liberada ao remover. */
  previewUrl?: string;
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

type AttachmentTrayProps = {
  items: PendingAttachment[];
  onRemove: (id: string) => void;
  /** Enquanto envia: "Enviando 2 de 3…" e sem remover. */
  sending?: { done: number; total: number } | null;
  /** Legenda vai junto do primeiro arquivo; em outros canais, como mensagem separada. */
  captionHint: string;
};

/** Arquivos escolhidos aguardando o envio, acima do campo de mensagem. */
export const AttachmentTray: React.FC<AttachmentTrayProps> = ({
  items,
  onRemove,
  sending,
  captionHint,
}) => {
  if (items.length === 0) return null;

  return (
    <div className="mb-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-2">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map((item) =>
          item.kind === "image" && item.previewUrl ? (
            <div
              key={item.id}
              className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-[#E5E7EB] bg-white"
              title={item.file.name}
            >
              <img
                src={item.previewUrl}
                alt={item.file.name}
                className="h-full w-full object-cover"
              />
              {!sending && (
                <RemoveButton name={item.file.name} onClick={() => onRemove(item.id)} />
              )}
            </div>
          ) : (
            <div
              key={item.id}
              className="relative flex h-16 w-48 flex-shrink-0 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white py-2 pl-2 pr-6"
              title={item.file.name}
            >
              <div className="flex h-10 w-9 flex-shrink-0 flex-col items-center justify-center rounded-md bg-[#0A84FF] text-white">
                <FileTextIcon className="h-4 w-4" />
                <span className="mt-0.5 max-w-full truncate px-0.5 text-[8px] font-bold leading-none">
                  {item.extension.toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[#111827]">
                  {item.file.name}
                </p>
                <p className="text-[11px] text-[#6B7280]">
                  {formatSize(item.file.size)}
                </p>
              </div>
              {!sending && (
                <RemoveButton name={item.file.name} onClick={() => onRemove(item.id)} />
              )}
            </div>
          ),
        )}
      </div>
      <p className="mt-1 flex items-center gap-1.5 px-0.5 text-[11px] text-[#6B7280]">
        {sending ? (
          <>
            <Loader2Icon className="h-3.5 w-3.5 animate-spin text-[#0A84FF]" />
            Enviando {Math.min(sending.done + 1, sending.total)} de {sending.total}…
          </>
        ) : (
          <>
            {items.length === 1 ? "1 arquivo pronto" : `${items.length} arquivos prontos`}
            {" · "}
            {captionHint}
          </>
        )}
      </p>
    </div>
  );
};

const RemoveButton: React.FC<{ name: string; onClick: () => void }> = ({
  name,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={`Remover ${name}`}
    title="Remover"
    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
  >
    <XIcon className="h-3 w-3" />
  </button>
);
