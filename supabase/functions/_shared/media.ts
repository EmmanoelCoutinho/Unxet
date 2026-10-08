// deno-lint-ignore-file
// @ts-nocheck
// Mídia do bucket privado whatsapp-media.
//
// No banco continuamos guardando a URL no formato público
// (.../storage/v1/object/public/whatsapp-media/<caminho>) como referência
// estável do arquivo. Como o bucket é privado, essa URL não abre sozinha:
// quem precisa do arquivo recebe um link assinado e temporário.

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");

export const MEDIA_BUCKET = "whatsapp-media";

// Provedores (Meta/Evolution) baixam o arquivo logo após o envio
const PROVIDER_LINK_TTL_SEC = 6 * 60 * 60;

const OBJECT_PREFIXES = [
  `/storage/v1/object/public/${MEDIA_BUCKET}/`,
  `/storage/v1/object/sign/${MEDIA_BUCKET}/`,
  `/storage/v1/object/authenticated/${MEDIA_BUCKET}/`,
];

/** Caminho do arquivo no bucket a partir de uma URL do nosso Storage (ou null). */
export const mediaPathFromUrl = (url: unknown): string | null => {
  if (typeof url !== "string" || !url.trim()) return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  if (`${parsed.protocol}//${parsed.host}` !== SUPABASE_URL) return null;

  for (const prefix of OBJECT_PREFIXES) {
    if (parsed.pathname.startsWith(prefix)) {
      const path = decodeURIComponent(parsed.pathname.slice(prefix.length));
      // Bloqueia caminhos relativos
      if (!path || path.split("/").some((part) => part === ".." || part === "")) return null;
      return path;
    }
  }
  return null;
};

/**
 * Link que o provedor (Meta/Evolution) consegue baixar. URLs de fora do nosso
 * Storage são devolvidas sem alteração.
 */
export const toProviderMediaUrl = async (admin, url: string | null | undefined) => {
  if (!url) return url ?? null;
  const path = mediaPathFromUrl(url);
  if (!path) return url;

  const { data, error } = await admin.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(path, PROVIDER_LINK_TTL_SEC);

  if (error || !data?.signedUrl) {
    console.error("[MEDIA] erro ao assinar link para o provedor:", error);
    throw new Error("media_sign_failed");
  }
  return data.signedUrl;
};
