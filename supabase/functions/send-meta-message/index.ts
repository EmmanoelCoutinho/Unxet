import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { toProviderMediaUrl } from "../_shared/media.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error("❌ ENV faltando: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY");
}
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
function safeStr(v) {
  if (v == null) return "";
  return String(v);
}
function authHeader(req) {
  return safeStr(req.headers.get("authorization") || req.headers.get("Authorization")).trim();
}
function parseMetaConversationId(metaConversationId) {
  const raw = safeStr(metaConversationId).trim();
  if (!raw) return {
    channel: null,
    metaInboxId: null,
    counterpartyId: null
  };
  const parts = raw.split(":");
  if (parts.length < 3) return {
    channel: null,
    metaInboxId: null,
    counterpartyId: null
  };
  const channel = safeStr(parts[0]).trim() || null;
  const metaInboxId = safeStr(parts[1]).trim() || null;
  const counterpartyId = safeStr(parts.slice(2).join(":")).trim() || null;
  return {
    channel,
    metaInboxId,
    counterpartyId
  };
}
function inferOutboundType(opts) {
  const { type, mediaUrl, mediaMimeType } = opts;
  if (type) return type;
  const mime = safeStr(mediaMimeType).toLowerCase();
  if (!mediaUrl) return "text";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}
function buildMetaPayload(opts) {
  const { channel, recipientId, outboundType, text, mediaUrl, filename } = opts;
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
  if (!mediaUrl) {
    base.message = {
      text: text || " "
    };
    return base;
  }
  const attachmentType = outboundType === "image" ? "image" : outboundType === "audio" ? "audio" : "file";
  base.message = {
    attachment: {
      type: attachmentType,
      payload: {
        url: mediaUrl,
        is_reusable: true,
        ...outboundType === "document" && filename ? {
          filename
        } : {}
      }
    }
  };
  return base;
}
async function getMetaConnection(opts) {
  const { clinicId, channel } = opts;
  const { data, error } = await supabaseAdmin.from("channel_connections").select("id, access_token, meta_page_id, meta_ig_user_id").eq("provider", "meta").eq("clinic_id", clinicId).eq("channel", channel).maybeSingle();
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
async function rateLimit(opts) {
  const { rid, userId, conversationId } = opts;
  const LIMIT = 20;
  const now = new Date();
  const bucket = new Date(now);
  bucket.setSeconds(0, 0);
  const bucketIso = bucket.toISOString();
  const key = `send_meta:${userId}:${conversationId}:${bucketIso}`;
  const { data: row, error: selErr } = await supabaseAdmin.from("edge_rate_limits").select("key, count").eq("key", key).maybeSingle();
  if (selErr) {
    console.log(JSON.stringify({
      rid,
      step: "ratelimit.select_failed",
      selErr
    }, null, 2));
    return {
      ok: false,
      reason: "ratelimit_error"
    };
  }
  const count = Number(row?.count ?? 0);
  if (count >= LIMIT) {
    console.log(JSON.stringify({
      rid,
      step: "ratelimit.hit",
      key,
      count,
      LIMIT
    }, null, 2));
    return {
      ok: false,
      reason: "rate_limited"
    };
  }
  if (!row) {
    const { error: insErr } = await supabaseAdmin.from("edge_rate_limits").insert({
      key,
      user_id: userId,
      conversation_id: conversationId,
      bucket_start: bucketIso,
      count: 1
    });
    if (insErr) {
      console.log(JSON.stringify({
        rid,
        step: "ratelimit.insert_failed",
        insErr
      }, null, 2));
      return {
        ok: false,
        reason: "ratelimit_error"
      };
    }
    return {
      ok: true,
      count: 1
    };
  }
  const { error: updErr } = await supabaseAdmin.from("edge_rate_limits").update({
    count: count + 1
  }).eq("key", key);
  if (updErr) {
    console.log(JSON.stringify({
      rid,
      step: "ratelimit.update_failed",
      updErr
    }, null, 2));
    return {
      ok: false,
      reason: "ratelimit_error"
    };
  }
  return {
    ok: true,
    count: count + 1
  };
}
async function consumeNonce(opts) {
  const { rid, nonce, userId, conversationId } = opts;
  const { data: n, error } = await supabaseAdmin.from("send_nonces").select("id, user_id, conversation_id, expires_at, used_at").eq("id", nonce).maybeSingle();
  if (error || !n) {
    console.log(JSON.stringify({
      rid,
      step: "nonce.not_found",
      error,
      nonce
    }, null, 2));
    return {
      ok: false,
      reason: "nonce_invalid"
    };
  }
  if (safeStr(n.user_id) !== userId || safeStr(n.conversation_id) !== conversationId) {
    console.log(JSON.stringify({
      rid,
      step: "nonce.mismatch",
      nonce,
      userId,
      conversationId
    }, null, 2));
    return {
      ok: false,
      reason: "nonce_invalid"
    };
  }
  if (n.used_at) {
    console.log(JSON.stringify({
      rid,
      step: "nonce.used",
      nonce
    }, null, 2));
    return {
      ok: false,
      reason: "nonce_used"
    };
  }
  const exp = new Date(n.expires_at).getTime();
  if (!Number.isFinite(exp) || Date.now() > exp) {
    console.log(JSON.stringify({
      rid,
      step: "nonce.expired",
      nonce,
      expires_at: n.expires_at
    }, null, 2));
    return {
      ok: false,
      reason: "nonce_expired"
    };
  }
  const { error: updErr } = await supabaseAdmin.from("send_nonces").update({
    used_at: new Date().toISOString()
  }).eq("id", nonce).is("used_at", null);
  if (updErr) {
    console.log(JSON.stringify({
      rid,
      step: "nonce.consume_failed",
      updErr,
      nonce
    }, null, 2));
    return {
      ok: false,
      reason: "nonce_error"
    };
  }
  return {
    ok: true
  };
}
async function authorizeUserForConversation(opts) {
  const { rid, userId, clinicId, departmentId, assignedUserId } = opts;
  const { data: cu, error: cuErr } = await supabaseAdmin.from("clinic_users").select("user_id, clinic_id, role, accepted_at, department_id").eq("clinic_id", clinicId).eq("user_id", userId).maybeSingle();
  if (cuErr || !cu) {
    console.log(JSON.stringify({
      rid,
      step: "authz.clinic_users.denied",
      clinicId,
      userId,
      cuErr: cuErr ?? null
    }, null, 2));
    return {
      ok: false,
      reason: "not_in_clinic"
    };
  }
  const role = safeStr(cu.role).toLowerCase();
  const isAdmin = role === "admin";
  const isAssigned = safeStr(assignedUserId) === userId;
  if (safeStr(assignedUserId).trim()) {
    if (!isAssigned) {
      console.log(JSON.stringify({
        rid,
        step: "authz.denied.assigned_not_owner",
        role,
        isAdmin,
        isAssigned,
        assignedUserId
      }, null, 2));
      return {
        ok: false,
        reason: "assigned_not_owner"
      };
    }
    console.log(JSON.stringify({
      rid,
      step: "authz.ok.assigned_owner",
      role,
      isAdmin,
      isAssigned
    }, null, 2));
    return {
      ok: true,
      isAdmin,
      isAssigned
    };
  }
  if (isAdmin) {
    console.log(JSON.stringify({
      rid,
      step: "authz.denied.admin_unassigned",
      role
    }, null, 2));
    return {
      ok: false,
      reason: "admin_cannot_send_unassigned"
    };
  }
  const { data: dm, error: dmErr } = await supabaseAdmin.from("department_members").select("department_id, clinic_user_id").eq("department_id", departmentId).eq("clinic_user_id", userId).maybeSingle();
  if (dmErr || !dm) {
    console.log(JSON.stringify({
      rid,
      step: "authz.department_members.denied",
      departmentId,
      userId,
      dmErr: dmErr ?? null
    }, null, 2));
    return {
      ok: false,
      reason: "not_in_department"
    };
  }
  console.log(JSON.stringify({
    rid,
    step: "authz.ok.department_member",
    departmentId,
    userId
  }, null, 2));
  return {
    ok: true,
    isAdmin: false,
    isAssigned: false
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
    const auth = authHeader(req);
    if (!auth.toLowerCase().startsWith("bearer ")) {
      console.log(JSON.stringify({
        rid,
        step: "auth.missing"
      }, null, 2));
      return new Response(JSON.stringify({
        error: "Missing bearer token"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: auth
        }
      }
    });
    const { data: u, error: uErr } = await supabaseUser.auth.getUser();
    if (uErr || !u?.user) {
      console.log(JSON.stringify({
        rid,
        step: "auth.invalid",
        uErr
      }, null, 2));
      return new Response(JSON.stringify({
        error: "Invalid token"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const userId = u.user.id;
    const body = await req.json().catch(()=>({}));
    const { conversationId, nonce, text, type, mediaUrl, mediaMimeType, filename, fileSize } = body;
    const bodyText = safeStr(text).trim();
    const outboundType = inferOutboundType({
      type,
      mediaUrl,
      mediaMimeType
    });
    console.log(JSON.stringify({
      rid,
      step: "request.in",
      userId,
      conversationId: conversationId ?? null,
      outboundType,
      hasText: !!bodyText,
      hasMediaUrl: !!mediaUrl,
      mediaMimeType: mediaMimeType ?? null,
      filename: filename ?? null,
      fileSize: fileSize ?? null,
      nonceProvided: !!safeStr(nonce).trim()
    }, null, 2));
    if (!conversationId || !bodyText && !mediaUrl) {
      return new Response(JSON.stringify({
        error: "conversationId é obrigatório e é necessário texto ou mediaUrl"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const nonceValue = safeStr(nonce).trim();
    if (!nonceValue) {
      return new Response(JSON.stringify({
        error: "nonce é obrigatório",
        hint: "Chame create-send-nonce antes de enviar"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { data: conversation, error: convErr } = await supabaseAdmin.from("conversations").select("id, clinic_id, department_id, contact_id, channel, meta_conversation_id, assigned_user_id, status, first_outbound_at").eq("id", conversationId).maybeSingle();
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
    const authz = await authorizeUserForConversation({
      rid,
      userId,
      clinicId: safeStr(conversation.clinic_id),
      departmentId: safeStr(conversation.department_id),
      assignedUserId: conversation.assigned_user_id ? safeStr(conversation.assigned_user_id) : null
    });
    if (!authz.ok) {
      return new Response(JSON.stringify({
        error: authz.reason
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const rl = await rateLimit({
      rid,
      userId,
      conversationId: conversation.id
    });
    if (!rl.ok) {
      const status = rl.reason === "rate_limited" ? 429 : 500;
      return new Response(JSON.stringify({
        error: rl.reason
      }), {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const cn = await consumeNonce({
      rid,
      nonce: nonceValue,
      userId,
      conversationId: conversation.id
    });
    if (!cn.ok) {
      return new Response(JSON.stringify({
        error: cn.reason
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
      departmentId: conversation.department_id,
      meta_conversation_id: conversation.meta_conversation_id ?? null,
      metaInboxIdFromConversation: metaInboxIdFromConversation ?? null,
      counterpartyId: counterpartyId ?? null,
      rateLimitCount: rl?.count ?? null
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
      channel
    });
    if (connErr || !conn) {
      console.error(JSON.stringify({
        rid,
        step: "channel_connections.missing",
        clinicId: conversation.clinic_id,
        channel
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
      outboundType,
      text: bodyText,
      // Bucket privado: a Meta recebe um link assinado e temporário do arquivo
      mediaUrl: mediaUrl ? await toProviderMediaUrl(supabaseAdmin, mediaUrl) : null,
      filename
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
      console.error("❌ Erro Meta (outbound):", sendResult.status, sendResult.body);
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
      meta_message_id: providerMessageId || `client:${crypto.randomUUID()}`,
      direction: "outbound",
      type: outboundType,
      sender: finalSenderForDb,
      receiver: counterpartyId,
      text: outboundType === "text" ? bodyText : bodyText || null,
      payload: sendResult.body,
      sent_at: nowIso,
      is_automated: false
    };
    if (outboundType === "image") {
      messageInsert.image_url = mediaUrl ?? null;
      messageInsert.media_mime_type = mediaMimeType ?? null;
    }
    if (outboundType === "audio") {
      messageInsert.media_url = mediaUrl ?? null;
      messageInsert.media_mime_type = mediaMimeType ?? null;
    }
    if (outboundType === "document") {
      messageInsert.media_url = mediaUrl ?? null;
      messageInsert.media_mime_type = mediaMimeType ?? null;
      messageInsert.filename = filename ?? null;
      messageInsert.file_size = fileSize ?? null;
    }
    const { data: inserted, error: msgErr } = await supabaseAdmin.from("messages").insert(messageInsert).select().maybeSingle();
    if (msgErr || !inserted) {
      console.error(JSON.stringify({
        rid,
        step: "messages.insert.error",
        error: msgErr ?? "no_row"
      }, null, 2));
      return new Response(JSON.stringify({
        error: "Erro ao salvar mensagem outbound"
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
      rateLimitCount: rl?.count ?? null
    }, null, 2));
    return new Response(JSON.stringify({
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
