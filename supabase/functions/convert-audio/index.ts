// deno-lint-ignore-file
// @ts-nocheck
// Proxy autenticado para o conversor de áudio (webm -> ogg).
// A chave do conversor fica apenas no servidor (AUDIO_CONVERTER_KEY).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_AUDIO_BYTES = 16 * 1024 * 1024; // 16 MB (limite de áudio do WhatsApp)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonError = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonError(405, "Method not allowed");
  }

  const converterUrl = Deno.env.get("AUDIO_CONVERTER_URL");
  const converterKey = Deno.env.get("AUDIO_CONVERTER_KEY");
  if (!converterUrl || !converterKey) {
    console.error("AUDIO_CONVERTER_URL / AUDIO_CONVERTER_KEY não configurados");
    return jsonError(500, "Conversor de áudio não configurado");
  }

  // Garante que quem chama é um usuário autenticado vinculado a uma clínica.
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return jsonError(401, "Não autenticado");
  }

  const { data: membership } = await supabase
    .from("clinic_users")
    .select("clinic_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (!membership?.clinic_id) {
    return jsonError(403, "Usuário sem clínica vinculada");
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return jsonError(400, "Corpo da requisição inválido");
  }

  if (!file || file.size === 0) {
    return jsonError(400, "Arquivo de áudio ausente");
  }

  if (file.size > MAX_AUDIO_BYTES) {
    return jsonError(413, "Arquivo de áudio muito grande");
  }

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, file.name || `voice-${Date.now()}.webm`);

  const upstream = await fetch(
    `${converterUrl.replace(/\/+$/, "")}/v1/convert-webm-to-ogg`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${converterKey}` },
      body: upstreamForm,
    },
  );

  if (!upstream.ok) {
    console.error("Falha no conversor de áudio:", upstream.status);
    return jsonError(502, `Falha ao converter áudio (HTTP ${upstream.status})`);
  }

  // application/octet-stream faz o supabase-js devolver um Blob em functions.invoke
  return new Response(upstream.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/octet-stream" },
  });
});
