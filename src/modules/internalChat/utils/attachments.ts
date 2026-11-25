import type {
  InternalAttachment,
  InternalAttachmentKind,
} from "../types/internalChat";

// Anexos do chat interno. Migration 20261205000000_internal_chat_attachments.

export const INTERNAL_MEDIA_BUCKET = "whatsapp-media";

export const MAX_INTERNAL_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_INTERNAL_FILE_BYTES = 50 * 1024 * 1024;

// Imagens que aparecem na conversa (as mesmas que o bucket aceita)
const INLINE_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

// Documentos gravados com o próprio tipo; o resto vira binário (download), o
// que impede HTML/SVG de rodar script no navegador de quem abre o link.
// Manter dentro de allowed_mime_types do bucket (migration 20261126000000).
const DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "text/plain",
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};

const baseMime = (mime: string | null | undefined) =>
  (mime ?? "").toLowerCase().split(";")[0].trim();

export const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "";
};

export type ClassifiedFile =
  | {
      ok: true;
      kind: Exclude<InternalAttachmentKind, "sticker">;
      /** Tipo gravado no Storage. */
      contentType: string;
      extension: string;
    }
  | { ok: false; reason: string };

/** Como o arquivo escolhido vai para a conversa (ou o motivo de recusar). */
export function classifyInternalFile(file: {
  name: string;
  type: string;
  size: number;
}): ClassifiedFile {
  if (file.size === 0) return { ok: false, reason: "O arquivo está vazio." };

  const mime = baseMime(file.type);
  const extension = extensionOf(file.name) || EXTENSION_BY_MIME[mime] || "bin";

  if (INLINE_IMAGE_MIMES.has(mime)) {
    if (file.size > MAX_INTERNAL_IMAGE_BYTES) {
      return { ok: false, reason: "A imagem deve ter no máximo 10 MB." };
    }
    return { ok: true, kind: "image", contentType: mime, extension };
  }

  if (file.size > MAX_INTERNAL_FILE_BYTES) {
    return { ok: false, reason: "O arquivo deve ter no máximo 50 MB." };
  }

  if (mime.startsWith("audio/")) {
    return { ok: true, kind: "audio", contentType: mime, extension };
  }

  // Vídeos sobem com o próprio tipo (o bucket aceita video/*) e aparecem como arquivo
  const contentType =
    DOCUMENT_MIMES.has(mime) || mime.startsWith("video/")
      ? mime
      : "application/octet-stream";
  return { ok: true, kind: "file", contentType, extension };
}

/** Caminho do arquivo novo, na pasta da conversa. */
export const internalAttachmentPath = (
  clinicId: string,
  threadId: string,
  extension: string,
) => `${clinicId}/internal-chat/${threadId}/${crypto.randomUUID()}.${extension}`;

/** Texto curto para a prévia na lista e nos avisos. */
export function attachmentLabel(
  attachment: Pick<InternalAttachment, "kind" | "name"> | null | undefined,
) {
  switch (attachment?.kind) {
    case "image":
      return "📷 Imagem";
    case "audio":
      return "🎤 Áudio";
    case "sticker":
      return "🖼️ Figurinha";
    case "file":
      return `📎 ${attachment.name || "Arquivo"}`;
    default:
      return "";
  }
}

/** Prévia da mensagem: o texto ou, sem texto, o tipo do anexo. */
export const messagePreview = (message: {
  body: string;
  attachment: InternalAttachment | null;
}) => message.body || attachmentLabel(message.attachment);

export const formatFileSize = (bytes: number | null | undefined) => {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace(".", ",") : Math.round(mb)} MB`;
};

export const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
