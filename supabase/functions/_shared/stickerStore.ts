// Figurinha guardada uma vez por empresa.
//
// Cada figurinha do WhatsApp traz o SHA-256 do arquivo (stickerMessage.
// fileSha256): a mesma figurinha tem sempre o mesmo hash. O arquivo fica em
// <empresa>/stickers/<hash>.webp e as mensagens seguintes com a mesma
// figurinha apontam para ele, sem baixar de novo pela Evolution.
//
// Apagar mensagem é só lógico (o arquivo fica). Ao apagar a empresa, a pasta
// dela inteira sai (platform_delete_clinic lista <empresa>/%).
import { toBytes } from "./messageEdit.ts";

const MEDIA_BUCKET = "whatsapp-media";
const STICKER_FOLDER = "stickers";

/** Hash (hex) da figurinha, ou null se não veio ou veio estranho. */
export function stickerHash(stickerMessage: any): string | null {
  const bytes = toBytes(stickerMessage?.fileSha256);
  if (!bytes || bytes.length !== 32) return null;
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function stickerStoragePath(clinicId: string, hash: string): string {
  return `${clinicId}/${STICKER_FOLDER}/${hash}.webp`;
}

/** Caminho é de figurinha desta empresa (o shared-in-config confere o que recebe). */
export function isClinicStickerPath(path: unknown, clinicId: string): path is string {
  return (
    typeof path === "string" &&
    new RegExp(`^${clinicId.replace(/[^0-9a-f-]/gi, "")}/${STICKER_FOLDER}/[0-9a-f]{64}\\.webp$`).test(path)
  );
}

/** A figurinha já está guardada? Erro na consulta conta como "não" (baixa de novo). */
export async function stickerExists(supabase, path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  try {
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).list(folder, { search: name, limit: 1 });
    if (error) {
      console.warn("[STICKER_LOOKUP_ERROR]", error.message ?? error);
      return false;
    }
    return (data ?? []).some((item) => item?.name === name);
  } catch (err) {
    console.warn("[STICKER_LOOKUP_ERROR]", err);
    return false;
  }
}
