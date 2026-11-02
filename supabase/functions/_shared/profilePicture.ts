// Foto de perfil do cliente no WhatsApp (Evolution).
//
// A foto é conferida a cada mensagem recebida (com um intervalo mínimo por
// contato, para não consultar o WhatsApp a cada mensagem de uma rajada).
// O arquivo é salvo com o hash da imagem no nome: quando a foto muda, muda
// também o endereço, e o app não fica preso numa versão antiga em cache.

/** Intervalo mínimo entre duas conferências da foto do mesmo contato. */
export const PROFILE_PIC_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function profilePicFolder(clinicId: string, waId: string) {
  return `${clinicId}/${waId}/profile`;
}

export function profilePicPath(
  clinicId: string,
  waId: string,
  hash: string,
  contentType: string,
) {
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  return `${profilePicFolder(clinicId, waId)}/${hash}.${ext}`;
}

/** A foto gravada no contato já é este arquivo? */
export function isCurrentProfilePic(
  imageUrl: string | null | undefined,
  storagePath: string,
) {
  return !!imageUrl && imageUrl.split("?")[0].endsWith(`/${storagePath}`);
}

/** Primeiros 16 caracteres do SHA-256 da imagem (suficiente para o nome). */
export async function imageHash(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Lembra a última conferência de cada contato enquanto a função fica no ar.
 * Devolve true quando já passou o intervalo e marca a conferência.
 */
export function createCheckThrottle(intervalMs = PROFILE_PIC_CHECK_INTERVAL_MS) {
  const lastCheck = new Map<string, number>();
  return (key: string, now = Date.now()) => {
    const last = lastCheck.get(key);
    if (last !== undefined && now - last < intervalMs) return false;
    lastCheck.set(key, now);
    if (lastCheck.size > 5000) {
      for (const [k, t] of lastCheck) {
        if (now - t >= intervalMs) lastCheck.delete(k);
      }
    }
    return true;
  };
}
