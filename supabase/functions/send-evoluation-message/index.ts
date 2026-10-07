import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json"
};
// ---------------------------------------------------------------------------
// Helper: resolve LID ou número suspeito para telefone real via Evolution API
// ---------------------------------------------------------------------------
async function resolvePhoneNumber(params) {
  const { evolutionApiUrl, evolutionApiKey, instanceName, rawNumber } = params;
  // Números reais brasileiros têm 10-13 dígitos (55 + DDD + número)
  // LIDs do WhatsApp têm tipicamente 14-15 dígitos
  const looksLikePhone = /^\d{10,13}$/.test(rawNumber);
  if (looksLikePhone) {
    return rawNumber;
  }
  console.log("[RESOLVE_PHONE] Número suspeito (possível LID), resolvendo:", rawNumber);
  try {
    const candidates = [
      `${rawNumber}@lid`,
      rawNumber
    ];
    for (const candidate of candidates){
      const resp = await fetch(`${evolutionApiUrl.replace(/\/$/, "")}/chat/whatsappNumbers/${instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: evolutionApiKey
        },
        body: JSON.stringify({
          numbers: [
            candidate
          ]
        })
      });
      if (!resp.ok) continue;
      const json = await resp.json();
      console.log("[RESOLVE_PHONE] Resposta whatsappNumbers:", JSON.stringify(json));
      const resolved = json?.[0]?.number ?? json?.[0]?.jid?.replace("@s.whatsapp.net", "").replace("@lid", "") ?? null;
      if (resolved && /^\d{10,13}$/.test(resolved.replace(/\D/g, ""))) {
        const clean = resolved.replace(/\D/g, "");
        console.log("[RESOLVE_PHONE] Resolvido com sucesso:", {
          rawNumber,
          resolved: clean
        });
        return clean;
      }
    }
    console.warn("[RESOLVE_PHONE] Não resolvido, usando original:", rawNumber);
  } catch (err) {
    console.error("[RESOLVE_PHONE] Erro:", err);
  }
  return rawNumber;
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    /*
     * =========================================================
     * AUTH
     * =========================================================
     */ const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: "Missing authorization header"
      }), {
        status: 401,
        headers: corsHeaders
      });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const adminSupabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: corsHeaders
      });
    }
    /*
     * =========================================================
     * BODY
     * =========================================================
     */ const body = await req.json();
    console.log("[EVOLUTION_SEND_FULL]", JSON.stringify(body, null, 2));
    const { conversationId, text, mediaUrl, fileName, mimeType, mediaMimeType, nonce, type } = body;
    const finalMimeType = mimeType || mediaMimeType || "";
    if (!conversationId) {
      return new Response(JSON.stringify({
        error: "conversationId is required"
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    /*
     * =========================================================
     * CONVERSATION
     * =========================================================
     */ const { data: conversation, error: conversationError } = await adminSupabase.from("conversations").select(`*, contacts (*), channel_connections (*)`).eq("id", conversationId).single();
    if (conversationError || !conversation) {
      return new Response(JSON.stringify({
        error: "Conversation not found"
      }), {
        status: 404,
        headers: corsHeaders
      });
    }
    /*
     * =========================================================
     * PROVIDER VALIDATION
     * =========================================================
     */ const connection = conversation.channel_connections;
    if (!connection) {
      return new Response(JSON.stringify({
        error: "Channel connection not found"
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    if (connection.provider !== "evolution") {
      return new Response(JSON.stringify({
        error: "Conversation is not using Evolution provider"
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    if (!connection.evolution_api_url || !connection.evolution_api_key || !connection.session_name) {
      return new Response(JSON.stringify({
        error: "Evolution connection is incomplete"
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    const baseUrl = connection.evolution_api_url.replace(/\/$/, "");
    const apiKey = connection.evolution_api_key;
    const session = connection.session_name;
    /*
     * =========================================================
     * CONTACT + RESOLVE NÚMERO REAL
     * =========================================================
     */ const contact = conversation.contacts;
    if (!contact?.phone) {
      return new Response(JSON.stringify({
        error: "Contact phone not found"
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    // Limpeza inicial — remove tudo que não é dígito
    const rawNumber = String(contact.phone).replace(/\D/g, "").trim();
    // Resolve LID → telefone real se necessário
    const number = await resolvePhoneNumber({
      evolutionApiUrl: baseUrl,
      evolutionApiKey: apiKey,
      instanceName: session,
      rawNumber
    });
    console.log("[SEND] Número final para envio:", {
      rawNumber,
      number
    });
    // Valida que é telefone real (10-13 dígitos) antes de enviar
    // Números com 14-15 dígitos são LIDs que não foram resolvidos
    if (!/^\d{10,13}$/.test(number)) {
      return new Response(JSON.stringify({
        error: "Não foi possível resolver o número do contato",
        rawNumber,
        resolvedNumber: number
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    /*
     * =========================================================
     * INFERIR TIPO DE MÍDIA
     * =========================================================
     */ const mime = finalMimeType.toLowerCase();
    const lowerFile = (fileName || "").toLowerCase();
    const isAudio = mime.startsWith("audio/");
    const isImage = type === "image" || mime.startsWith("image/") || lowerFile.endsWith(".jpg") || lowerFile.endsWith(".jpeg") || lowerFile.endsWith(".png") || lowerFile.endsWith(".webp");
    const isDocument = !!mediaUrl && !isAudio && !isImage;
    let outboundType = "text";
    if (mediaUrl) {
      if (isAudio) outboundType = "audio";
      else if (isImage) outboundType = "image";
      else outboundType = "document";
    }
    /*
     * =========================================================
     * SEND MESSAGE
     * =========================================================
     */ let evolutionResponse = null;
    // ── ÁUDIO ─────────────────────────────────────────────────────────────
    // Rota dedicada: /message/sendWhatsAppAudio
    // Aceita URL pública diretamente — Baileys converte internamente.
    // Não é necessário converter para ogg como na Meta API.
    if (isAudio && mediaUrl) {
      console.log("[EVOLUTION_SEND_AUDIO]", JSON.stringify({
        number,
        mediaUrl
      }));
      const resp = await fetch(`${baseUrl}/message/sendWhatsAppAudio/${session}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey
        },
        body: JSON.stringify({
          number,
          audio: mediaUrl,
          encoding: true
        })
      });
      evolutionResponse = await resp.json();
      if (!resp.ok) {
        console.error("[EVOLUTION_AUDIO_ERROR]", evolutionResponse);
        return new Response(JSON.stringify({
          error: "Failed to send audio",
          details: evolutionResponse
        }), {
          status: 500,
          headers: corsHeaders
        });
      }
    } else if (isImage && mediaUrl) {
      console.log("[EVOLUTION_SEND_IMAGE]", JSON.stringify({
        number,
        mediaUrl
      }));
      const resp = await fetch(`${baseUrl}/message/sendMedia/${session}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey
        },
        body: JSON.stringify({
          number,
          mediatype: "image",
          media: mediaUrl,
          caption: text ?? ""
        })
      });
      evolutionResponse = await resp.json();
      if (!resp.ok) {
        console.error("[EVOLUTION_IMAGE_ERROR]", evolutionResponse);
        return new Response(JSON.stringify({
          error: "Failed to send image",
          details: evolutionResponse
        }), {
          status: 500,
          headers: corsHeaders
        });
      }
    } else if (isDocument && mediaUrl) {
      console.log("[EVOLUTION_SEND_DOCUMENT]", JSON.stringify({
        number,
        mediaUrl,
        fileName
      }));
      const resp = await fetch(`${baseUrl}/message/sendMedia/${session}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey
        },
        body: JSON.stringify({
          number,
          mediatype: "document",
          media: mediaUrl,
          caption: text ?? "",
          fileName: fileName ?? `file-${Date.now()}`
        })
      });
      evolutionResponse = await resp.json();
      if (!resp.ok) {
        console.error("[EVOLUTION_DOCUMENT_ERROR]", evolutionResponse);
        return new Response(JSON.stringify({
          error: "Failed to send document",
          details: evolutionResponse
        }), {
          status: 500,
          headers: corsHeaders
        });
      }
    } else {
      console.log("[EVOLUTION_SEND_TEXT]", JSON.stringify({
        number,
        text
      }));
      const resp = await fetch(`${baseUrl}/message/sendText/${session}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey
        },
        body: JSON.stringify({
          number,
          text
        })
      });
      evolutionResponse = await resp.json();
      if (!resp.ok) {
        console.error("[EVOLUTION_TEXT_ERROR]", evolutionResponse);
        return new Response(JSON.stringify({
          error: "Failed to send message",
          details: evolutionResponse
        }), {
          status: 500,
          headers: corsHeaders
        });
      }
    }
    /*
     * =========================================================
     * SAVE MESSAGE
     * =========================================================
     */ const providerMessageId = evolutionResponse?.key?.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const { error: messageError } = await adminSupabase.from("messages").insert({
      conversation_id: conversation.id,
      direction: "outbound",
      type: outboundType,
      sender: session,
      receiver: number,
      text: text ?? "",
      media_url: mediaUrl ?? null,
      media_mime_type: mimeType ?? null,
      filename: fileName ?? null,
      payload: evolutionResponse,
      sent_at: now,
      created_at: now
    });
    if (messageError) {
      console.error("[SAVE_MESSAGE_ERROR]", messageError);
    }
    /*
     * =========================================================
     * UPDATE CONVERSATION
     * =========================================================
     */ await adminSupabase.from("conversations").update({
      updated_at: now,
      last_message_at: now,
      last_outbound_at: now
    }).eq("id", conversation.id);
    // Atualiza o phone do contato para o número resolvido,
    // evitando nova resolução nas próximas mensagens
    if (rawNumber !== number) {
      await adminSupabase.from("contacts").update({
        phone: number
      }).eq("id", contact.id);
      console.log("[CONTACT_PHONE_UPDATED]", {
        contactId: contact.id,
        oldPhone: rawNumber,
        newPhone: number
      });
    }
    /*
     * =========================================================
     * SUCCESS
     * =========================================================
     */ return new Response(JSON.stringify({
      success: true,
      providerMessageId,
      response: evolutionResponse
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("[SEND_EVOLUTION_MESSAGE_ERROR]", error);
    return new Response(JSON.stringify({
      error: "Internal server error"
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
