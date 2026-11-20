// deno-lint-ignore-file
// @ts-nocheck
/**
 * sticker-library — figurinhas da empresa para o atendente enviar.
 *
 * As figurinhas recebidas, enviadas pelo celular e criadas no Unxet ficam em
 * <empresa>/stickers/ (ver _shared/stickerStore.ts). O bucket é privado, então
 * esta função lista a pasta da empresa de quem pede e devolve, para cada
 * figurinha, a URL de referência (a que vai no envio) e um link assinado
 * temporário para mostrar a miniatura. Mais recentes primeiro.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser, getClinicMembership } from "../_shared/security.ts";
import { MEDIA_BUCKET } from "../_shared/media.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

const MAX_STICKERS = 120;
const SIGNED_URL_TTL_SEC = 60 * 60;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return json(401, { error: "Unauthorized" });

    const { clinicId } = await req.json().catch(() => ({}));
    if (typeof clinicId !== "string" || !/^[0-9a-f-]{36}$/i.test(clinicId)) {
      return json(400, { error: "clinicId is required" });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const membership = await getClinicMembership(admin, user.id, clinicId);
    if (!membership) return json(403, { error: "Not allowed" });

    const folder = `${clinicId}/stickers`;
    const { data: files, error: listError } = await admin.storage
      .from(MEDIA_BUCKET)
      .list(folder, { limit: MAX_STICKERS, sortBy: { column: "created_at", order: "desc" } });
    if (listError) {
      console.error("[STICKER_LIBRARY_LIST_ERROR]", listError);
      return json(500, { error: "Não foi possível carregar as figurinhas." });
    }

    const names = (files ?? [])
      .map((file) => file?.name)
      .filter((name) => typeof name === "string" && /^[0-9a-f]{64}\.(webp|png)$/.test(name));
    if (!names.length) return json(200, { stickers: [], expiresIn: SIGNED_URL_TTL_SEC });

    const paths = names.map((name) => `${folder}/${name}`);
    const { data: signed, error: signError } = await admin.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SEC);
    if (signError) {
      console.error("[STICKER_LIBRARY_SIGN_ERROR]", signError);
      return json(500, { error: "Não foi possível carregar as figurinhas." });
    }

    const stickers = paths
      .map((path, index) => ({
        url: admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data?.publicUrl ?? null,
        previewUrl: signed?.[index]?.signedUrl ?? null
      }))
      .filter((item) => item.url && item.previewUrl);

    return json(200, { stickers, expiresIn: SIGNED_URL_TTL_SEC });
  } catch (error) {
    console.error("[STICKER_LIBRARY_UNEXPECTED]", error);
    return json(500, { error: "Internal error" });
  }
});
