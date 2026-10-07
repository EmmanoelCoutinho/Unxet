import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET");
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret"
};
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTERNAL_BOT_SECRET) {
  console.error("❌ ENV faltando: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / INTERNAL_BOT_SECRET");
}
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
function safeStr(v) {
  if (v == null) return "";
  return String(v);
}
function internalSecretHeader(req) {
  return safeStr(req.headers.get("x-internal-secret")).trim();
}
function parseMetaConversationId(metaConversationId) {
  const raw = safeStr(metaConversationId).trim();
  if (!raw) return {
    channel: null,
    metaInboxId: null,
    counterpartyId: null
  };
  const parts = raw.split(":");
  if (parts.length < 3) {
    return {
      channel: null,
      metaInboxId: null,
      counterpartyId: null
    };
  }
  const channel = safeStr(parts[0]).trim() || null;
  const metaInboxId = safeStr(parts[1]).trim() || null;
  const counterpartyId = safeStr(parts.slice(2).join(":")).trim() || null;
  return {
    channel,
    metaInboxId,
    counterpartyId
  };
}
function buildMetaPayload(opts) {
  const { channel, recipientId, outboundType, text } = opts;
  const base = {
    recipient: {
      id: recipientId
    }
  };
  if (channel === "instagram") base.messaging_product = "instagram";
  if (channel === "messenger") base.messaging_type = "RESPONSE";
  if (outboundType === "text") {
    base.message = {
      text: text || " "
    };
    return base;
  }
  base.message = {
    text: text || " "
  };
  return base;
}
async function getMetaConnection(opts) {
  const { clinicId, channel, channelConnectionId } = opts;
  const { data, error } = await supabaseAdmin.from("channel_connections").select("id, access_token, meta_page_id, meta_ig_user_id, provider, channel, clinic_id").eq("id", channelConnectionId).eq("provider", "meta").eq("clinic_id", clinicId).eq("channel", channel).maybeSingle();
  if (error) {
    console.error("❌ Erro ao buscar channel_connections:", error);
    return {
      conn: null,
      error
    };
  }
  return {
    conn: data ?? null,
    error: null
  };
}
function resolveSenderIdForChannel(opts) {
  const { channel, conn, metaInboxIdFromConversation } = opts;
  if (channel === "messenger") {
    const pageId = safeStr(conn?.meta_page_id).trim();
    return pageId || safeStr(metaInboxIdFromConversation).trim() || null;
  }
  if (channel === "instagram") {
    const igUserId = safeStr(conn?.meta_ig_user_id).trim();
    if (igUserId) return igUserId;
    const pageFallback = safeStr(conn?.meta_page_id).trim();
    if (pageFallback) return pageFallback;
    return safeStr(metaInboxIdFromConversation).trim() || null;
  }
  return safeStr(metaInboxIdFromConversation).trim() || null;
}
async function graphGet(path, accessToken) {
  const url = new URL(`https://graph.facebook.com/v21.0/${path}`);
  url.searchParams.set("access_token", accessToken);
  const resp = await fetch(url.toString(), {
    method: "GET"
  });
  const body = await resp.json().catch(()=>({}));
  return {
    ok: resp.ok,
    status: resp.status,
    body
  };
}
async function debugTokenIfPossible(rid, inputToken) {
  const appId = safeStr(META_APP_ID).trim();
  const appSecret = safeStr(META_APP_SECRET).trim();
  if (!appId || !appSecret) {
    console.log(JSON.stringify({
      rid,
      step: "debug_token.skipped",
      reason: "META_APP_ID/META_APP_SECRET não definidos"
    }, null, 2));
    return;
  }
  const appAccessToken = `${appId}|${appSecret}`;
  const url = new URL("https://graph.facebook.com/v21.0/debug_token");
  url.searchParams.set("input_token", inputToken);
  url.searchParams.set("access_token", appAccessToken);
  const resp = await fetch(url.toString(), {
    method: "GET"
  });
  const body = await resp.json().catch(()=>({}));
  console.log(JSON.stringify({
    rid,
    step: "debug_token.result",
    ok: resp.ok,
    status: resp.status,
    data: body?.data ?? null,
    scopes: body?.data?.scopes ?? null,
    granular_scopes: body?.data?.granular_scopes ?? null,
    app_id: body?.data?.app_id ?? null,
    type: body?.data?.type ?? null,
    is_valid: body?.data?.is_valid ?? null,
    user_id: body?.data?.user_id ?? null,
    issued_at: body?.data?.issued_at ?? null,
    expires_at: body?.data?.expires_at ?? null
  }, null, 2));
}
function pickProviderMessageId(metaBody) {
  const a = safeStr(metaBody?.message_id).trim() || safeStr(metaBody?.message?.mid).trim() || safeStr(metaBody?.id).trim() || "";
  return a || null;
}
async function sendToMeta(opts) {
  const { rid, channel, senderId, recipientId, token, payload } = opts;
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(senderId)}/messages`;
  console.log(JSON.stringify({
    rid,
    step: "meta.send.attempt",
    channel,
    senderId,
    recipientId,
    url,
    payloadPreview: {
      hasRecipient: !!payload?.recipient?.id,
      hasMessageText: typeof payload?.message?.text === "string",
      hasAttachment: !!payload?.message?.attachment,
      messaging_product: payload?.messaging_product ?? null,
      messaging_type: payload?.messaging_type ?? null
    }
  }, null, 2));
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await resp.json().catch(()=>({}));
  console.log(JSON.stringify({
    rid,
    step: "meta.send.result",
    channel,
    senderId,
    ok: resp.ok,
    status: resp.status,
    error: body?.error ?? null,
    message_id: pickProviderMessageId(body)
  }, null, 2));
  return {
    ok: resp.ok,
    status: resp.status,
    body
  };
}
serve(async (req)=>{
  const rid = crypto.randomUUID();
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders
      });
    }
    const internalSecret = internalSecretHeader(req);
    if (!INTERNAL_BOT_SECRET || internalSecret !== INTERNAL_BOT_SECRET) {
      console.log(JSON.stringify({
        rid,
        step: "auth.invalid_internal_secret"
      }, null, 2));
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const body = await req.json().catch(()=>({}));
    const clinicId = safeStr(body.clinicId).trim();
    const conversationId = safeStr(body.conversationId).trim();
    const channelConnectionId = safeStr(body.channelConnectionId).trim();
    const botId = safeStr(body.botId).trim();
    const sessionId = safeStr(body.sessionId).trim() || null;
    const eventId = safeStr(body.eventId).trim() || null;
    const text = safeStr(body.text).trim();
    const messageType = safeStr(body.messageType || "text").trim();
    const metadata = body.metadata ?? {};
    console.log(JSON.stringify({
      rid,
      step: "request.in",
      clinicId: clinicId || null,
      conversationId: conversationId || null,
      channelConnectionId: channelConnectionId || null,
      botId: botId || null,
      sessionId,
      eventId,
      hasText: !!text,
      messageType
    }, null, 2));
    if (!clinicId || !conversationId || !channelConnectionId || !botId || !text) {
      return new Response(JSON.stringify({
        error: "clinicId, conversationId, channelConnectionId, botId e text são obrigatórios"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (messageType !== "text") {
      return new Response(JSON.stringify({
        error: "A V1 do bot-sender-meta suporta apenas messageType=text"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { data: conversation, error: convErr } = await supabaseAdmin.from("conversations").select("id, clinic_id, department_id, contact_id, channel, meta_conversation_id, assigned_user_id, status, first_outbound_at, channel_connection_id").eq("id", conversationId).maybeSingle();
    if (convErr || !conversation) {
      console.error(JSON.stringify({
        rid,
        step: "conversation.fetch.error",
        error: convErr ?? "not_found"
      }, null, 2));
      return new Response(JSON.stringify({
        error: "Conversa não encontrada"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (safeStr(conversation.clinic_id) !== clinicId) {
      return new Response(JSON.stringify({
        error: "Conversa não pertence à clinicId informada"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (safeStr(conversation.channel_connection_id) !== channelConnectionId) {
      return new Response(JSON.stringify({
        error: "channelConnectionId não corresponde ao canal da conversa"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const convChannel = safeStr(conversation.channel).trim();
    if (convChannel !== "messenger" && convChannel !== "instagram") {
      console.error(JSON.stringify({
        rid,
        step: "conversation.channel.invalid",
        channel: conversation.channel ?? null
      }, null, 2));
      return new Response(JSON.stringify({
        error: "Canal da conversa inválido (esperado messenger/instagram)"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const parsedMeta = parseMetaConversationId(conversation.meta_conversation_id ?? null);
    const channel = convChannel;
    const metaInboxIdFromConversation = parsedMeta.metaInboxId;
    const counterpartyId = parsedMeta.counterpartyId;
    console.log(JSON.stringify({
      rid,
      step: "routing.keys",
      channel,
      conversationId: conversation.id,
      clinicId: conversation.clinic_id,
      meta_conversation_id: conversation.meta_conversation_id ?? null,
      metaInboxIdFromConversation: metaInboxIdFromConversation ?? null,
      counterpartyId: counterpartyId ?? null
    }, null, 2));
    if (!counterpartyId) {
      return new Response(JSON.stringify({
        error: "meta_conversation_id inválido (sem counterpartyId)"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { conn, error: connErr } = await getMetaConnection({
      clinicId: conversation.clinic_id,
      channel,
      channelConnectionId
    });
    if (connErr || !conn) {
      console.error(JSON.stringify({
        rid,
        step: "channel_connections.missing",
        clinicId: conversation.clinic_id,
        channel,
        channelConnectionId
      }, null, 2));
      return new Response(JSON.stringify({
        error: "Conexão Meta não encontrada para clinic/channel"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const token = safeStr(conn.access_token).trim();
    if (!token) {
      console.error(JSON.stringify({
        rid,
        step: "token.missing",
        channel
      }, null, 2));
      return new Response(JSON.stringify({
        error: "access_token não configurado em channel_connections"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const me = await graphGet("me?fields=id,name", token);
    console.log(JSON.stringify({
      rid,
      step: "token.me",
      ok: me.ok,
      status: me.status,
      body: me.body
    }, null, 2));
    await debugTokenIfPossible(rid, token);
    const senderId = resolveSenderIdForChannel({
      channel,
      conn: {
        meta_page_id: safeStr(conn.meta_page_id).trim() || null,
        meta_ig_user_id: safeStr(conn.meta_ig_user_id).trim() || null
      },
      metaInboxIdFromConversation
    });
    const senderIdIgPreferred = channel === "instagram" ? safeStr(conn.meta_ig_user_id).trim() || null : null;
    const senderIdPageFallback = safeStr(conn.meta_page_id).trim() || null;
    if (!senderId) {
      console.error(JSON.stringify({
        rid,
        step: "senderId.missing",
        channel
      }, null, 2));
      return new Response(JSON.stringify({
        error: "Não foi possível resolver senderId (page_id/ig_user_id)"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const metaPayload = buildMetaPayload({
      channel,
      recipientId: counterpartyId,
      outboundType: "text",
      text
    });
    let sendResult = await sendToMeta({
      rid,
      channel,
      senderId,
      recipientId: counterpartyId,
      token,
      payload: metaPayload
    });
    const code = sendResult?.body?.error?.code ?? null;
    const msg = safeStr(sendResult?.body?.error?.message);
    const isCapabilityError = code === 3 || msg.includes("capability");
    if (channel === "instagram" && !sendResult.ok && isCapabilityError && senderIdIgPreferred && senderIdPageFallback && senderId !== senderIdPageFallback) {
      console.log(JSON.stringify({
        rid,
        step: "instagram.fallback_to_page_id",
        reason: "capability_error",
        ig_sender_id: senderIdIgPreferred,
        page_sender_id: senderIdPageFallback
      }, null, 2));
      sendResult = await sendToMeta({
        rid,
        channel,
        senderId: senderIdPageFallback,
        recipientId: counterpartyId,
        token,
        payload: metaPayload
      });
    }
    if (!sendResult.ok) {
      console.error("❌ Erro Meta (bot outbound):", sendResult.status, sendResult.body);
      return new Response(JSON.stringify({
        error: "Erro ao enviar mensagem para Meta (Messenger/Instagram)",
        meta: sendResult.body
      }), {
        status: 502,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const providerMessageId = pickProviderMessageId(sendResult.body);
    const nowIso = new Date().toISOString();
    const finalSenderForDb = channel === "instagram" && senderIdPageFallback && !senderIdIgPreferred ? senderIdPageFallback : senderId;
    const messageInsert = {
      conversation_id: conversation.id,
      meta_message_id: providerMessageId || `bot:${crypto.randomUUID()}`,
      direction: "outbound",
      type: "text",
      sender: finalSenderForDb,
      receiver: counterpartyId,
      text,
      payload: {
        provider_response: sendResult.body,
        automation: {
          source: "bot-sender-meta",
          bot_id: botId,
          session_id: sessionId,
          event_id: eventId,
          metadata
        }
      },
      sent_at: nowIso,
      is_automated: true
    };
    const { data: inserted, error: msgErr } = await supabaseAdmin.from("messages").insert(messageInsert).select().maybeSingle();
    if (msgErr || !inserted) {
      console.error(JSON.stringify({
        rid,
        step: "messages.insert.error",
        error: msgErr ?? "no_row"
      }, null, 2));
      return new Response(JSON.stringify({
        error: "Erro ao salvar mensagem outbound do bot"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const conversationUpdates = {
      last_message_at: nowIso,
      last_outbound_at: nowIso,
      updated_at: nowIso,
      first_unanswered_inbound_at: null
    };
    if (!conversation.first_outbound_at) {
      conversationUpdates.first_outbound_at = nowIso;
    }
    const { error: convUpdErr } = await supabaseAdmin.from("conversations").update(conversationUpdates).eq("id", conversation.id);
    if (convUpdErr) {
      console.error(JSON.stringify({
        rid,
        step: "conversations.update.error",
        error: convUpdErr
      }, null, 2));
      return new Response(JSON.stringify({
        error: "Erro ao atualizar conversa"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(JSON.stringify({
      rid,
      step: "done",
      conversationId: conversation.id,
      insertedMessageId: inserted.id,
      providerMessageId: providerMessageId ?? null,
      channel,
      botId,
      sessionId,
      eventId
    }, null, 2));
    return new Response(JSON.stringify({
      ok: true,
      messageId: inserted.id,
      providerMessageId: providerMessageId ?? null,
      conversationId: conversation.id,
      channelConnectionId,
      message: inserted,
      meta: sendResult.body
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error(JSON.stringify({
      rid,
      step: "unexpected_error",
      message: err?.message ?? String(err),
      stack: err?.stack ?? null
    }, null, 2));
    return new Response(JSON.stringify({
      error: "Internal error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
