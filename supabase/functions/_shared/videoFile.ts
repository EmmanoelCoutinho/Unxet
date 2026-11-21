// Vídeo fica gravado como documento (type "document" com arquivo video/*),
// no WhatsApp via QR Code e na Meta. Para rótulos ("🎥 Vídeo" na citação e na
// notificação) vale o tipo do arquivo ou, sem ele, a extensão do nome.
// Mesma regra de src/lib/videoFile.ts.

const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "3gp", "webm", "mkv", "avi"]);

export function isVideoFile(mimeType?: string | null, filename?: string | null): boolean {
  const mime = String(mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (mime.startsWith("video/")) return true;
  if (mime && mime !== "application/octet-stream" && mime !== "binary/octet-stream") return false;
  const extension = String(filename ?? "").toLowerCase().split(".").pop() ?? "";
  return VIDEO_EXTENSIONS.has(extension);
}

/** Tipo para exibir: documento que é vídeo vira "video". */
export function displayMessageType(
  type: string | null | undefined,
  mimeType?: string | null,
  filename?: string | null,
): string {
  const value = String(type ?? "") || "text";
  if ((value === "document" || value === "video") && isVideoFile(mimeType, filename)) return "video";
  return value;
}
