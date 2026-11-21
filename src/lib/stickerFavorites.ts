// Figurinhas favoritas de cada atendente (tabela sticker_favorites).
// O arquivo fica em whatsapp-media/<empresa>/stickers/<hash>.webp; favoritar
// e remover só mexem na lista de quem está logado, nunca no arquivo.
import { supabase } from "./supabaseClient";

const STICKER_PATH = /^([0-9a-f-]{36})\/stickers\/[0-9a-f]{64}\.(?:webp|png)$/;

/**
 * Caminho da figurinha no bucket a partir da URL gravada na mensagem
 * (pública ou assinada). Só vale para figurinhas guardadas na pasta da
 * empresa; as antigas, de antes da pasta, não podem ser favoritadas.
 */
export function stickerPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const marker = "/whatsapp-media/";
  const at = pathname.indexOf(marker);
  if (at < 0) return null;
  let path = pathname.slice(at + marker.length);
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  return STICKER_PATH.test(path) ? path : null;
}

const clinicOfPath = (path: string) => path.match(STICKER_PATH)?.[1] ?? null;

// A modal guarda a lista por alguns minutos: favoritar ou remover limpa
const listeners = new Set<() => void>();
export function onStickerFavoritesChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const notify = () => listeners.forEach((listener) => listener());

/** "added" ou "already" (já estava nas favoritas). Lança erro se falhar. */
export async function addStickerFavorite(path: string): Promise<"added" | "already"> {
  const clinicId = clinicOfPath(path);
  if (!clinicId) throw new Error("Figurinha inválida");
  const { error } = await supabase.from("sticker_favorites").insert({ clinic_id: clinicId, path });
  if (error) {
    if (error.code === "23505") return "already";
    throw error;
  }
  notify();
  return "added";
}

export async function removeStickerFavorite(path: string): Promise<void> {
  const clinicId = clinicOfPath(path);
  if (!clinicId) return;
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Sem sessão");
  const { error } = await supabase
    .from("sticker_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("clinic_id", clinicId)
    .eq("path", path);
  if (error) throw error;
  notify();
}
