// deno-lint-ignore-file
// @ts-nocheck
/**
 * media-urls — links assinados (temporários) para a mídia do bucket privado.
 *
 * Recebe as URLs que o front quer exibir e só assina as que pertencem a uma
 * mensagem ou contato visível para o usuário. A checagem é feita com o JWT do
 * próprio usuário, então vale o RLS (clínica + isolamento por departamento).
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MEDIA_BUCKET, mediaPathFromUrl } from "../_shared/media.ts";

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

const MAX_URLS = 50;
const SIGNED_URL_TTL_SEC = 60 * 60;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return json(401, { error: "Unauthorized" });

  const body = await req.json().catch(() => ({}));
  const requested: string[] = Array.isArray(body?.urls)
    ? Array.from(new Set(body.urls.filter((u) => typeof u === "string"))).slice(0, MAX_URLS)
    : [];

  // Só URLs do nosso bucket
  const pathByUrl = new Map<string, string>();
  for (const url of requested) {
    const path = mediaPathFromUrl(url);
    if (path) pathByUrl.set(url, path);
  }
  const urls = Array.from(pathByUrl.keys());
  if (!urls.length) return json(200, { urls: {} });

  // Quais dessas URLs o usuário pode ver (RLS de messages e contacts)
  const [byMedia, byImage, byAvatar] = await Promise.all([
    userClient.from("messages").select("media_url").in("media_url", urls),
    userClient.from("messages").select("image_url").in("image_url", urls),
    userClient.from("contacts").select("image_url").in("image_url", urls)
  ]);

  const queryError = byMedia.error ?? byImage.error ?? byAvatar.error;
  if (queryError) {
    console.error("[MEDIA_URLS] erro ao verificar acesso:", queryError);
    return json(500, { error: "Failed to check access" });
  }

  const allowed = new Set<string>([
    ...(byMedia.data ?? []).map((row) => row.media_url),
    ...(byImage.data ?? []).map((row) => row.image_url),
    ...(byAvatar.data ?? []).map((row) => row.image_url)
  ]);

  const allowedUrls = urls.filter((url) => allowed.has(url));
  if (!allowedUrls.length) return json(200, { urls: {} });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: signed, error: signError } = await admin.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(allowedUrls.map((url) => pathByUrl.get(url)), SIGNED_URL_TTL_SEC);

  if (signError) {
    console.error("[MEDIA_URLS] erro ao assinar:", signError);
    return json(500, { error: "Failed to sign urls" });
  }

  const result: Record<string, string> = {};
  (signed ?? []).forEach((item, index) => {
    if (item?.signedUrl) result[allowedUrls[index]] = item.signedUrl;
  });

  return json(200, { urls: result, expiresIn: SIGNED_URL_TTL_SEC });
});
