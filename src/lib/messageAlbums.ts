import type { Message as UiMessage } from "../types";

// Fotos seguidas viram álbum na conversa, como no WhatsApp: 4 ou mais fotos
// sem legenda, da mesma pessoa, com até 1 minuto entre uma e outra. Foto com
// legenda ou resposta citando outra mensagem fica sozinha.

export const ALBUM_MIN_PHOTOS = 4;
const ALBUM_MAX_GAP_MS = 60_000;

const isAlbumPhoto = (message: UiMessage) =>
  message.type === "image" &&
  !!message.mediaUrl &&
  !message.deletedAt &&
  !message.replyTo &&
  !(message.text ?? "").trim() &&
  // ainda enviando (id "local-...", ver isLocalOptimisticId)
  !String(message.id).startsWith("local-");

const authorKey = (message: UiMessage) =>
  `${message.direction ?? message.author}:${message.senderUserId ?? message.senderName ?? ""}`;

/**
 * Junta as fotos seguidas de cada pessoa. Recebe a linha do tempo já
 * ordenada e devolve os itens com { kind: "album", messages } no lugar das fotos.
 */
export function groupAlbums<T extends { kind: string; message?: UiMessage }>(
  items: T[],
): Array<T | { kind: "album"; messages: UiMessage[] }> {
  const out: Array<T | { kind: "album"; messages: UiMessage[] }> = [];
  let run: T[] = [];

  const flush = () => {
    if (run.length >= ALBUM_MIN_PHOTOS) {
      out.push({ kind: "album", messages: run.map((item) => item.message as UiMessage) });
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const item of items) {
    const message = item.kind === "message" ? item.message : undefined;
    if (!message || !isAlbumPhoto(message)) {
      flush();
      out.push(item);
      continue;
    }
    const last = run[run.length - 1]?.message;
    const sameRun =
      last &&
      authorKey(last) === authorKey(message) &&
      Math.abs(new Date(message.createdAt).getTime() - new Date(last.createdAt).getTime()) <=
        ALBUM_MAX_GAP_MS;
    if (!sameRun) flush();
    run.push(item);
  }
  flush();
  return out;
}
