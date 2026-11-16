// Tipo (Content-Type) com que um arquivo vindo de fora é gravado no Storage.
//
// O "Abrir" da conversa leva o atendente direto ao link do Storage. Se o
// arquivo fosse gravado com o tipo que o remetente informou, um SVG, HTML ou
// XML com script rodaria no navegador ao ser aberto. Por isso só ficam com o
// tipo original os formatos que o navegador mostra sem executar nada
// (imagem comum, áudio, vídeo, PDF) ou que ele só baixa (Office, PFX, ZIP).
// Texto e marcação viram texto puro; o resto vira binário, que só baixa.
//
// O tipo original continua salvo na mensagem (media_mime_type), para a
// conversa mostrar o rótulo certo (XML, CSV, ...).

const KEEP_AS_IS = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/x-pkcs12",
  "application/zip",
  "application/octet-stream",
  "text/plain",
]);

/** Lista que o bucket whatsapp-media aceita (a mesma da migration). */
export const STORAGE_ALLOWED_MIME_TYPES = [...KEEP_AS_IS, "audio/*", "video/*"];

export const safeStorageContentType = (raw: string | null | undefined): string => {
  const base = String(raw ?? "").toLowerCase().split(";")[0].trim();
  if (!base) return "application/octet-stream";
  if (KEEP_AS_IS.has(base)) return base;

  const [type, subtype = ""] = base.split("/");
  if ((type === "audio" || type === "video") && /^[a-z0-9.+-]+$/.test(subtype)) return base;

  // Texto e marcação (XML, HTML, SVG, JSON, scripts, CSV, OFX...): texto puro
  if (
    type === "text" ||
    /xml|html|svg|json|javascript|ecmascript|ofx|csv/.test(subtype)
  ) {
    return "text/plain";
  }

  return "application/octet-stream";
};
