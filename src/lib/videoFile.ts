// Arquivo de vídeo, pelo tipo ou, quando o tipo não veio (ou veio genérico),
// pela extensão do nome. Vídeos ficam gravados como documento.

const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "3gp", "webm", "mkv", "avi"]);

export function isVideoFile(mimeType?: string | null, filename?: string | null): boolean {
  const mime = String(mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (mime.startsWith("video/")) return true;
  if (mime && mime !== "application/octet-stream" && mime !== "binary/octet-stream") return false;
  const extension = String(filename ?? "").toLowerCase().split(".").pop() ?? "";
  return VIDEO_EXTENSIONS.has(extension);
}
