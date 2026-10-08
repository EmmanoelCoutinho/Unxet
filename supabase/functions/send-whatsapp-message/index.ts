import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { queueTranscription, runInBackground, TRANSCRIPTION_BUCKET } from "../_shared/transcription.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const META_WABA_TOKEN = Deno.env.get("META_WABA_TOKEN");
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
function inferOutboundType(opts) {
  const { type, mediaUrl, mediaMimeType } = opts;
  if (type) return type;
  const mime = safeStr(mediaMimeType).toLowerCase();
  if (!mediaUrl) return "text";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}
function extractStoragePathFromPublicUrl(opts) {
  const { supabaseUrl, bucket, url } = opts;
  const u = safeStr(url).trim();
  if (!u) return null;
  const base = supabaseUrl.replace(/\/+$/, "");
  const prefix = `${base}/storage/v1/object/public/${bucket}/`;
  if (!u.startsWith(prefix)) return null;
  const path = u.slice(prefix.length);
  return path ? decodeURIComponent(path) : null;
}
async function rateLimit(opts) {
  const { rid, userId, conversationId } = opts;
  const LIMIT = 20;
  const now = new Date();
  const bucket = new Date(now);
  bucket.setSeconds(0, 0);
  const bucketIso = bucket.toISOString();
  const key = `send_whatsapp:${userId}:${conversationId}:${bucketIso}`;
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
  }).eq("id", nonce);
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
async function authorizeSendForConversation(opts) {
  const { rid, userId, clinicId, departmentId, assignedUserId } = opts;
  const { data: cu, error: cuErr } = await supabaseAdmin.from("clinic_users").select("user_id, clinic_id, role, accepted_at").eq("clinic_id", clinicId).eq("user_id", userId).maybeSingle();
  if (cuErr || !cu) {
    console.log(JSON.stringify({
      rid,
      step: "authz_send.not_in_clinic",
      clinicId,
      userId,
      cuErr: cuErr ?? null
    }, null, 2));
    return {
      ok: false,
      reason: "Not allowed"
    };
  }
  if (assignedUserId) {
    const isAssigned = safeStr(assignedUserId) === userId;
    if (!isAssigned) {
      console.log(JSON.stringify({
        rid,
        step: "authz_send.denied.not_assigned",
        assignedUserId,
        userId
      }, null, 2));
      return {
        ok: false,
        reason: "Not allowed"
      };
    }
    console.log(JSON.stringify({
      rid,
      step: "authz_send.ok.assigned",
      userId,
      assignedUserId
    }, null, 2));
    return {
      ok: true
    };
  }
  const { data: dm, error: dmErr } = await supabaseAdmin.from("department_members").select("department_id, clinic_user_id").eq("department_id", departmentId).eq("clinic_user_id", userId).maybeSingle();
  if (dmErr || !dm) {
    console.log(JSON.stringify({
      rid,
      step: "authz_send.denied.not_in_department",
      departmentId,
      userId,
      dmErr: dmErr ?? null
    }, null, 2));
    return {
      ok: false,
      reason: "Not allowed"
    };
  }
  console.log(JSON.stringify({
    rid,
    step: "authz_send.ok.department_member",
    departmentId,
    userId
  }, null, 2));
  return {
    ok: true
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
    console.log("📤 Tipo outbound:", outboundType, "| mediaUrl:", mediaUrl, "| mime:", mediaMimeType, "| text:", bodyText);
    const { data: conversation, error: convErr } = await supabaseAdmin.from("conversations").select("id, clinic_id, department_id, contact_id, whatsapp_number_id, assigned_user_id, first_outbound_at").eq("id", conversationId).maybeSingle();
    if (convErr || !conversation) {
      console.error("❌ Erro ao buscar conversa:", convErr);
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
    const authz = await authorizeSendForConversation({
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
    const { data: contact, error: contactErr } = await supabaseAdmin.from("contacts").select("id, phone").eq("id", conversation.contact_id).maybeSingle();
    if (contactErr || !contact) {
      console.error("❌ Erro ao buscar contato:", contactErr);
      return new Response(JSON.stringify({
        error: "Contato não encontrado"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const waId = contact.phone;
    const numberQuery = supabaseAdmin.from("whatsapp_numbers").select("id, meta_phone_number_id, clinic_id, channel_connection_id").eq("clinic_id", conversation.clinic_id).limit(1);
    const { data: waNumber, error: waNumberErr } = conversation.whatsapp_number_id ? await numberQuery.eq("id", conversation.whatsapp_number_id).maybeSingle() : await numberQuery.maybeSingle();
    if (waNumberErr || !waNumber) {
      console.error("❌ Erro ao buscar whatsapp_numbers para clinic_id:", conversation.clinic_id, waNumberErr);
      return new Response(JSON.stringify({
        error: "Número do WhatsApp não configurado para essa clínica"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const phoneNumberId = waNumber.meta_phone_number_id;
    const channelConnectionId = waNumber.channel_connection_id ?? null;
    let tokenToUse = (META_WABA_TOKEN ?? "").trim();
    if (channelConnectionId) {
      const { data: conn, error: connErr } = await supabaseAdmin.from("channel_connections").select("access_token").eq("id", channelConnectionId).maybeSingle();
      if (connErr) {
        console.error("❌ Erro ao buscar channel_connections:", connErr);
      } else if (conn?.access_token && String(conn.access_token).trim().length > 0) {
        tokenToUse = String(conn.access_token).trim();
      }
    }
    if (!tokenToUse) {
      console.error("❌ Token do WhatsApp não configurado (db/env)");
      return new Response(JSON.stringify({
        error: "Token do WhatsApp não configurado"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (outboundType === "audio" && mediaUrl) {
      const m = (mediaMimeType ?? "").toLowerCase();
      const isOgg = m.includes("audio/ogg") || (mediaUrl ?? "").toLowerCase().includes(".ogg");
      if (!isOgg) {
        return new Response(JSON.stringify({
          error: "Áudio precisa ser OGG/Opus para voice message. Envie audio/ogg.",
          receivedMime: mediaMimeType ?? null
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const metaPayload = {
      messaging_product: "whatsapp",
      to: waId
    };
    if (outboundType === "image" && mediaUrl) {
      metaPayload.type = "image";
      metaPayload.image = {
        link: mediaUrl,
        ...bodyText ? {
          caption: bodyText
        } : {}
      };
    } else if (outboundType === "audio" && mediaUrl) {
      metaPayload.type = "audio";
      metaPayload.audio = {
        link: mediaUrl,
        voice: true
      };
    } else if (outboundType === "document" && mediaUrl) {
      metaPayload.type = "document";
      metaPayload.document = {
        link: mediaUrl,
        filename: filename || "documento.pdf",
        ...bodyText ? {
          caption: bodyText
        } : {}
      };
    } else {
      metaPayload.type = "text";
      metaPayload.text = {
        body: bodyText || " "
      };
    }
    console.log("➡️ Enviando OUTBOUND para Meta:", JSON.stringify(metaPayload));
    const metaResp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenToUse}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(metaPayload)
    });
    const metaBody = await metaResp.json().catch(()=>({}));
    if (!metaResp.ok) {
      console.error("❌ Erro Meta WhatsApp (outbound):", metaResp.status, metaBody);
      return new Response(JSON.stringify({
        error: "Erro ao enviar mensagem para WhatsApp",
        meta: metaBody
      }), {
        status: 502,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("✅ Mensagem OUTBOUND enviada para Meta:", metaBody);
    const providerMessageId = metaBody?.messages?.[0]?.id ?? null;
    const nowIso = new Date().toISOString();
    const messageInsert = {
      conversation_id: conversation.id,
      meta_message_id: providerMessageId,
      direction: "outbound",
      type: outboundType,
      sender: phoneNumberId,
      text: outboundType === "text" ? bodyText : bodyText || null,
      payload: metaBody,
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
      console.error("❌ Erro inserindo mensagem outbound:", msgErr);
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
    if (outboundType === "audio") {
      const queued = await queueTranscription(supabaseAdmin, {
        messageId: inserted.id,
        storagePath: extractStoragePathFromPublicUrl({
          supabaseUrl: SUPABASE_URL,
          bucket: TRANSCRIPTION_BUCKET,
          url: mediaUrl
        })
      });
      runInBackground(queued?.done);
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
      console.error("❌ Erro ao sincronizar conversa outbound:", convUpdErr);
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
    console.log("✅ Mensagem OUTBOUND salva:", inserted.id);
    return new Response(JSON.stringify({
      message: inserted
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("❌ Erro inesperado em send-whatsapp-message:", err);
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
