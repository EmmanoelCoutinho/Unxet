// Transforma uma imagem em figurinha: quadrado de 512 px, fundo transparente
// e a imagem inteira dentro (sem cortar), em WebP. O WhatsApp usa esse
// formato; a Evolution converte de novo se precisar. Navegador que não gera
// WebP (Safari antigo) fica com PNG.

export const STICKER_SIZE = 512;
export const MAX_STICKER_SOURCE_BYTES = 10 * 1024 * 1024;
export const STICKER_SOURCE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/** Tamanho da imagem dentro do quadrado, sem cortar e sem esticar. */
export function fitInSquare(width: number, height: number, size = STICKER_SIZE) {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0, width: size, height: size };
  const scale = Math.min(size / width, size / height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return { x: Math.round((size - w) / 2), y: Math.round((size - h) / 2), width: w, height: h };
}

export async function imageToSticker(
  file: Blob,
): Promise<{ blob: Blob; extension: "webp" | "png"; mimeType: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = STICKER_SIZE;
    canvas.height = STICKER_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas_unavailable");
    const box = fitInSquare(bitmap.width, bitmap.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, box.x, box.y, box.width, box.height);

    const toBlob = (type: string, quality?: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    const webp = await toBlob("image/webp", 0.9);
    if (webp && webp.type === "image/webp") {
      return { blob: webp, extension: "webp", mimeType: "image/webp" };
    }
    const png = await toBlob("image/png");
    if (!png) throw new Error("sticker_encode_failed");
    return { blob: png, extension: "png", mimeType: "image/png" };
  } finally {
    bitmap.close();
  }
}

/** SHA-256 em hex: a mesma imagem vira o mesmo arquivo (não duplica no Storage). */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
