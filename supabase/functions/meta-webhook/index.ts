// deno-lint-ignore-file
// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SECRET_KEY")! // ✅ usa a nova secret key
);

const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// Comparação em tempo constante para não vazar a assinatura por timing
const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

// Valida o header X-Hub-Signature-256 enviado pela Meta (HMAC-SHA256 do corpo bruto)
const isValidSignature = async (
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
) => {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody),
  );

  return safeEqual(`sha256=${toHex(signature)}`, signatureHeader);
};

serve(async (req) => {
  try {
    const url = new URL(req.url);

    // 1️⃣ GET — Verificação do webhook pela Meta
    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      const verifyToken = Deno.env.get("META_VERIFY_TOKEN");

      if (mode === "subscribe" && verifyToken && token === verifyToken) {
        console.log("✅ Webhook verificado com sucesso!");
        return new Response(challenge, { status: 200 });
      }

      return new Response("Erro de verificação", { status: 403 });
    }

    // 2️⃣ POST — Recebimento de mensagens
    if (req.method === "POST") {
      const appSecret = Deno.env.get("META_APP_SECRET");
      if (!appSecret) {
        console.error("❌ META_APP_SECRET não configurado");
        return new Response("Internal error", { status: 500 });
      }

      const rawBody = await req.text();
      const validSignature = await isValidSignature(
        rawBody,
        req.headers.get("x-hub-signature-256"),
        appSecret,
      );

      if (!validSignature) {
        console.warn("⚠️ Assinatura inválida no webhook Meta");
        return new Response("Invalid signature", { status: 401 });
      }

      const body = JSON.parse(rawBody);

      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const messages = change.value?.messages;
          const contacts = change.value?.contacts;
          if (!messages || !contacts) continue;

          // 🧩 0. Identifica a clínica dona do número que recebeu a mensagem
          const phoneNumberId = change.value?.metadata?.phone_number_id;
          if (!phoneNumberId) continue;

          const { data: connection, error: connectionError } = await supabase
            .from("channel_connections")
            .select("clinic_id")
            .eq("meta_phone_number_id", phoneNumberId)
            .maybeSingle();

          if (connectionError) throw connectionError;
          if (!connection?.clinic_id) {
            console.warn("⚠️ Nenhuma conexão para phone_number_id", phoneNumberId);
            continue;
          }

          const clinicId = connection.clinic_id;
          const contact = contacts[0];
          const waId = contact.wa_id;
          const name = contact.profile?.name;

          for (const msg of messages) {
            const messageId = msg.id;
            const timestamp = new Date(Number(msg.timestamp) * 1000);
            const text = msg.text?.body ?? null;
            const type = msg.type ?? "text";
            const payload = msg ?? null;
            const caption =
              msg.text?.body ??
              msg.image?.caption ??
              msg.document?.caption ??
              null;

            // 🧩 1. Busca ou cria o contato dentro da clínica
            const { data: contactId, error: contactError } = await supabase.rpc(
              "find_or_create_contact_for_conversation",
              {
                p_clinic_id: clinicId,
                p_phone: waId,
                p_name: name ?? null,
                p_meta_contact_id: waId,
              },
            );

            if (contactError) throw contactError;

            // 🧩 2. Buscar ou criar conversa
            let { data: conversation } = await supabase
              .from("conversations")
              .select("*")
              .eq("clinic_id", clinicId)
              .eq("contact_id", contactId)
              .eq("status", "open")
              .maybeSingle();

            if (!conversation) {
              const { data: newConv, error: convError } = await supabase
                .from("conversations")
                .insert({
                  clinic_id: clinicId,
                  contact_id: contactId,
                  status: "open",
                  channel: "whatsapp",
                  assigned_user_id: null,
                  last_message_at: timestamp,
                })
                .select()
                .single();
              if (convError) throw convError;
              conversation = newConv;
            }

            // 🧩 3. Inserir mensagem
            const { error: msgError } = await supabase
              .from("messages")
              .upsert({
                meta_message_id: messageId,
                conversation_id: conversation.id,
                direction: "inbound",
                type,
                sender: waId,
                text: text ?? caption,
                payload,
                sent_at: timestamp,
              });
            if (msgError) throw msgError;

            // 🧩 4. Atualizar last_message_at
            await supabase
              .from("conversations")
              .update({ last_message_at: timestamp })
              .eq("id", conversation.id);
          }
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    console.error("❌ Erro no webhook Meta:", err);
    return new Response("Internal error", { status: 500 });
  }
});
