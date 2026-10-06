/**
 * whatsapp-in — Gateway Meta WhatsApp
 *
 * Responsabilidades:
 *  1. Validar webhook Meta
 *  2. Filtrar mensagens inbound
 *  3. Resolver clinicId + channelConnectionId
 *  4. Normalizar payload
 *  5. Encaminhar para shared-in-config
 *
 * Nenhuma lógica de negócio vive aqui.
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ---------------------------------------------------------------------------
// ENV
// ---------------------------------------------------------------------------
const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "meta_verify_token";
const META_WHATSAPP_TOKEN = Deno.env.get("META_WHATSAPP_TOKEN") ?? "";
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SHARED_IN_CONFIG_URL = Deno.env.get("SHARED_IN_CONFIG_URL") ?? `${SUPABASE_URL}/functions/v1/shared-in-config`;
// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
const CHANNEL_WHATSAPP = "whatsapp";
// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function extractInteractiveReply(message) {
  const interactive = message?.interactive ?? null;
  if (!interactive) {
    return {
      kind: null,
      selectedId: null,
      selectedTitle: null,
      raw: null
    };
  }
  if (interactive.button_reply) {
    return {
      kind: "button_reply",
      selectedId: interactive.button_reply.id ?? null,
      selectedTitle: interactive.button_reply.title ?? null,
      raw: interactive.button_reply
    };
  }
  if (interactive.list_reply) {
    return {
      kind: "list_reply",
      selectedId: interactive.list_reply.id ?? null,
      selectedTitle: interactive.list_reply.title ?? null,
      raw: interactive.list_reply
    };
  }
  return {
    kind: null,
    selectedId: null,
    selectedTitle: null,
    raw: interactive
  };
}
// ---------------------------------------------------------------------------
// SERVER
// ---------------------------------------------------------------------------
serve(async (req)=>{
  try {
    const { method } = req;
    // -----------------------------------------------------------------------
    // VERIFY WEBHOOK
    // -----------------------------------------------------------------------
    if (method === "GET") {
      const url = new URL(req.url);
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
        return new Response(challenge, {
          status: 200
        });
      }
      return new Response("Erro de verificação", {
        status: 403
      });
    }
    if (method !== "POST") {
      return new Response("Method not allowed", {
        status: 405
      });
    }
    // -----------------------------------------------------------------------
    // SUPABASE
    // -----------------------------------------------------------------------
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();
    // -----------------------------------------------------------------------
    // PAYLOAD
    // -----------------------------------------------------------------------
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const contactMeta = value?.contacts?.[0];
    if (!message || !contactMeta) {
      return new Response("No message", {
        status: 200
      });
    }
    // -----------------------------------------------------------------------
    // IDS
    // -----------------------------------------------------------------------
    const providerMessageId = String(message.id ?? "").trim();
    if (!providerMessageId) {
      return new Response("Missing provider message id", {
        status: 400
      });
    }
    const phoneNumberId = value?.metadata?.phone_number_id;
    if (!phoneNumberId) {
      return new Response("Missing phone_number_id", {
        status: 400
      });
    }
    const waId = String(contactMeta.wa_id ?? "").trim();
    if (!waId) {
      return new Response("Missing wa_id", {
        status: 400
      });
    }
    const profileName = contactMeta.profile?.name ?? "Cliente";
    // -----------------------------------------------------------------------
    // IDEMPOTÊNCIA
    // -----------------------------------------------------------------------
    const { data: existingMessage, error: existingMsgErr } = await supabase.from("messages").select("id").eq("meta_message_id", providerMessageId).maybeSingle();
    if (existingMsgErr) {
      console.error("Erro ao checar idempotência:", existingMsgErr);
      return new Response("Idempotency check error", {
        status: 500
      });
    }
    if (existingMessage) {
      return new Response("Already processed", {
        status: 200
      });
    }
    // -----------------------------------------------------------------------
    // TIMESTAMP
    // -----------------------------------------------------------------------
    const rawTimestamp = Number(message.timestamp ?? Date.now());
    const timestamp = new Date(rawTimestamp * 1000);
    // -----------------------------------------------------------------------
    // MESSAGE TYPE
    // -----------------------------------------------------------------------
    const rawType = message.type ?? "text";
    const isTextMessage = rawType === "text";
    const isImageMessage = rawType === "image";
    const isAudioMessage = rawType === "audio";
    const isDocumentMessage = rawType === "document";
    const isInteractiveMessage = rawType === "interactive";
    // -----------------------------------------------------------------------
    // RESOLVE CONNECTION
    // -----------------------------------------------------------------------
    const { data: connection, error: connectionErr } = await supabase.from("channel_connections").select(`
        id,
        clinic_id,
        access_token,
        meta_phone_number_id
      `).eq("provider", "meta").eq("channel", CHANNEL_WHATSAPP).eq("meta_phone_number_id", phoneNumberId).maybeSingle();
    if (connectionErr) {
      console.error("Erro ao buscar channel_connections:", connectionErr);
      return new Response("Channel connection lookup error", {
        status: 500
      });
    }
    if (!connection) {
      return new Response("Channel connection not found", {
        status: 400
      });
    }
    const clinicId = connection.clinic_id;
    const channelConnectionId = connection.id;
    let metaTokenForMedia = META_WHATSAPP_TOKEN;
    if (connection.access_token && String(connection.access_token).trim()) {
      metaTokenForMedia = String(connection.access_token).trim();
    }
    // -----------------------------------------------------------------------
    // PARSE MESSAGE
    // -----------------------------------------------------------------------
    let text = "";
    let mediaId = null;
    let documentFilename = null;
    let mediaMimeType = null;
    let interactiveReply = {
      kind: null,
      selectedId: null,
      selectedTitle: null,
      raw: null
    };
    if (isTextMessage) {
      text = message.text?.body ?? "";
    } else if (isImageMessage) {
      text = message.image?.caption ?? "";
      mediaId = message.image?.id ?? null;
      mediaMimeType = message.image?.mime_type ?? null;
    } else if (isAudioMessage) {
      mediaId = message.audio?.id ?? null;
      mediaMimeType = message.audio?.mime_type ?? null;
    } else if (isDocumentMessage) {
      text = message.document?.caption ?? "";
      mediaId = message.document?.id ?? null;
      documentFilename = message.document?.filename ?? null;
      mediaMimeType = message.document?.mime_type ?? null;
    } else if (isInteractiveMessage) {
      interactiveReply = extractInteractiveReply(message);
      text = interactiveReply.selectedTitle || interactiveReply.selectedId || "";
    }
    // -----------------------------------------------------------------------
    // SHARED PAYLOAD
    // -----------------------------------------------------------------------
    const sharedPayload = {
      provider: "meta",
      clinicId,
      channelConnectionId,
      waId,
      profileName,
      providerMessageId,
      timestamp: timestamp.toISOString(),
      messageType: rawType,
      text,
      ...mediaId ? {
        media: {
          mediaId,
          filename: documentFilename,
          mimeType: mediaMimeType
        },
        mediaFetchToken: metaTokenForMedia
      } : {},
      ...interactiveReply.kind ? {
        interactive: interactiveReply
      } : {},
      rawPayload: body
    };
    console.log("[WHATSAPP_SHARED_PAYLOAD]", JSON.stringify(sharedPayload));
    // -----------------------------------------------------------------------
    // SEND TO SHARED
    // -----------------------------------------------------------------------
    const sharedResp = await fetch(SHARED_IN_CONFIG_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_BOT_SECRET
      },
      body: JSON.stringify(sharedPayload)
    });
    if (!sharedResp.ok) {
      const errText = await sharedResp.text();
      console.error("shared-in-config retornou erro:", sharedResp.status, errText);
      return new Response("Upstream error", {
        status: 502
      });
    }
    return new Response(JSON.stringify({
      success: true
    }), {
      status: 200
    });
  } catch (error) {
    console.error("Erro inesperado em whatsapp-in:", error);
    return new Response(JSON.stringify({
      error: "Internal error"
    }), {
      status: 500
    });
  }
});
