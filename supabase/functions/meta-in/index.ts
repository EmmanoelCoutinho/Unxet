import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { matchSurveyAnswer } from "../_shared/satisfactionSurvey.ts";
import { queueInboundPush } from "../_shared/push.ts";
const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const ALLOW_UNSIGNED_TESTS = (Deno.env.get("META_ALLOW_UNSIGNED_TESTS") ?? "false") === "true";
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";
const STATUS_OPEN = "open";
const STATUS_PENDING = "pending";
const STATUS_CLOSED = "closed";
const DIRECTION_INBOUND = "inbound";
const DIRECTION_OUTBOUND = "outbound";
const CHANNEL_MESSENGER = "messenger";
const CHANNEL_INSTAGRAM = "instagram";
const MESSAGE_TYPE_TEXT = "text";
const MESSAGE_TYPE_IMAGE = "image";
const MESSAGE_TYPE_AUDIO = "audio";
const MESSAGE_TYPE_DOCUMENT = "document";
function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++)diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function normalizeSigValue(v) {
  return v.trim().toLowerCase();
}
async function hmacHex(opts) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(opts.secret), {
    name: "HMAC",
    hash: opts.algo
  }, false, [
    "sign"
  ]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, opts.rawBody);
  return toHex(sigBuf);
}
async function verifyMetaSignature(opts) {
  const { header256, header1, rawBody, appSecret } = opts;
  if (header256) {
    const prefix = "sha256=";
    const hv = normalizeSigValue(header256);
    if (hv.startsWith(prefix)) {
      const expected = normalizeSigValue(hv.slice(prefix.length));
      const actual = await hmacHex({
        algo: "SHA-256",
        secret: appSecret,
        rawBody
      });
      if (timingSafeEqual(actual, expected)) return {
        ok: true,
        used: "sha256"
      };
    }
  }
  if (header1) {
    const prefix = "sha1=";
    const hv = normalizeSigValue(header1);
    if (hv.startsWith(prefix)) {
      const expected = normalizeSigValue(hv.slice(prefix.length));
      const actual = await hmacHex({
        algo: "SHA-1",
        secret: appSecret,
        rawBody
      });
      if (timingSafeEqual(actual, expected)) return {
        ok: true,
        used: "sha1"
      };
    }
  }
  return {
    ok: false,
    used: null
  };
}
function normalizeTimestamp(ts) {
  const n = Number(ts ?? Date.now());
  if (!Number.isFinite(n)) return new Date();
  if (n < 1_000_000_000_000) return new Date(n * 1000);
  return new Date(n);
}
function logStep(rid, step, data) {
  console.log(JSON.stringify({
    rid,
    step,
    ...data
  }, null, 2));
}
function logSbError(rid, step, error, extra = {}) {
  console.error(JSON.stringify({
    rid,
    step,
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    details: error?.details ?? null,
    hint: error?.hint ?? null,
    ...extra
  }, null, 2));
}
function safeStr(v) {
  if (v == null) return "";
  return String(v);
}
function deriveFilenameFromUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    const path = u.pathname || "";
    const last = path.split("/").filter(Boolean).pop() || "";
    const decoded = decodeURIComponent(last);
    const clean = decoded.trim();
    if (!clean) return null;
    if (clean.length > 180) return clean.slice(0, 180);
    return clean;
  } catch  {
    const noQuery = rawUrl.split("?")[0] || "";
    const last = noQuery.split("/").filter(Boolean).pop() || "";
    const clean = last.trim();
    return clean ? clean.slice(0, 180) : null;
  }
}
function extractAttachmentType(attachments) {
  if (!attachments || attachments.length === 0) return MESSAGE_TYPE_TEXT;
  const firstType = String(attachments?.[0]?.type ?? "");
  if (firstType === "image") return MESSAGE_TYPE_IMAGE;
  if (firstType === "audio") return MESSAGE_TYPE_AUDIO;
  if (firstType === "file") return MESSAGE_TYPE_DOCUMENT;
  if (firstType === "video") return MESSAGE_TYPE_DOCUMENT;
  return MESSAGE_TYPE_TEXT;
}
function extractMediaFromAttachments(attachments) {
  const out = {
    dbType: extractAttachmentType(attachments),
    image_url: null,
    media_url: null,
    media_mime_type: null,
    filename: null,
    caption: null,
    attachment_id: null,
    debug: {}
  };
  if (!attachments || attachments.length === 0) return out;
  const a = attachments[0] ?? {};
  const type = safeStr(a?.type);
  const payload = a?.payload ?? {};
  const url = safeStr(payload?.url) || safeStr(a?.url) || safeStr(payload?.src) || "";
  const attachmentId = safeStr(payload?.attachment_id) || safeStr(a?.attachment_id) || "";
  const mime = safeStr(payload?.mime_type) || safeStr(a?.mime_type) || safeStr(payload?.content_type) || "";
  const filename = safeStr(payload?.filename) || safeStr(a?.filename) || safeStr(payload?.name) || "";
  const caption = safeStr(a?.title) || safeStr(payload?.title) || safeStr(payload?.caption) || "";
  out.media_mime_type = mime || null;
  out.filename = filename || null;
  out.caption = caption || null;
  out.attachment_id = attachmentId || null;
  out.debug = {
    attachment_type: type || null,
    has_url: !!url,
    attachment_id: out.attachment_id
  };
  if (type === "image") {
    out.dbType = MESSAGE_TYPE_IMAGE;
    out.image_url = url || null;
    return out;
  }
  if (type === "audio") {
    out.dbType = MESSAGE_TYPE_AUDIO;
    out.media_url = url || null;
    return out;
  }
  if (type === "file" || type === "video") {
    out.dbType = MESSAGE_TYPE_DOCUMENT;
    out.media_url = url || null;
    if (!out.filename && out.media_url) {
      out.filename = deriveFilenameFromUrl(out.media_url);
    }
    return out;
  }
  return out;
}
function extractMediaFromMessageObject(msg, attachmentsFallback) {
  const attachments = Array.isArray(msg?.attachments) && msg.attachments.length > 0 ? msg.attachments : Array.isArray(attachmentsFallback) ? attachmentsFallback : [];
  if (attachments.length > 0) return extractMediaFromAttachments(attachments);
  const out = {
    dbType: MESSAGE_TYPE_TEXT,
    image_url: null,
    media_url: null,
    media_mime_type: null,
    filename: null,
    caption: null,
    attachment_id: null,
    debug: {
      source: "message_object_fields"
    }
  };
  const image = msg?.image ?? null;
  const audio = msg?.audio ?? null;
  const file = msg?.file ?? null;
  const video = msg?.video ?? null;
  const pick = (node)=>{
    const url = safeStr(node?.url) || safeStr(node?.link) || safeStr(node?.src) || "";
    const mime = safeStr(node?.mime_type) || safeStr(node?.content_type) || "";
    const filename = safeStr(node?.filename) || safeStr(node?.name) || "";
    const caption = safeStr(node?.caption) || safeStr(node?.title) || safeStr(node?.description) || "";
    return {
      url,
      mime,
      filename,
      caption
    };
  };
  if (image) {
    const v = pick(image);
    out.dbType = MESSAGE_TYPE_IMAGE;
    out.image_url = v.url || null;
    out.media_mime_type = v.mime || null;
    out.filename = v.filename || null;
    out.caption = v.caption || null;
    return out;
  }
  if (audio) {
    const v = pick(audio);
    out.dbType = MESSAGE_TYPE_AUDIO;
    out.media_url = v.url || null;
    out.media_mime_type = v.mime || null;
    out.filename = v.filename || null;
    out.caption = v.caption || null;
    return out;
  }
  if (file || video) {
    const v = pick(file || video);
    out.dbType = MESSAGE_TYPE_DOCUMENT;
    out.media_url = v.url || null;
    out.media_mime_type = v.mime || null;
    out.filename = v.filename || null;
    out.caption = v.caption || null;
    if (!out.filename && out.media_url) {
      out.filename = deriveFilenameFromUrl(out.media_url);
    }
    return out;
  }
  return out;
}
function detectChannel(opts) {
  const obj = String(opts.object ?? "").toLowerCase();
  const mp = String(opts.messagingProduct ?? "").toLowerCase();
  const mid = String(opts.providerMessageId ?? "");
  if (obj === "instagram") return CHANNEL_INSTAGRAM;
  if (mp === "instagram") return CHANNEL_INSTAGRAM;
  if (mid.startsWith("aWdf")) return CHANNEL_INSTAGRAM;
  return CHANNEL_MESSENGER;
}
function extractRecipientIdLoose(rawMsg, rawContainer) {
  const candidates = [];
  const push = (v)=>{
    if (v == null) return;
    if (Array.isArray(v)) for (const x of v)push(x);
    else candidates.push(v);
  };
  push(rawMsg?.to);
  push(rawMsg?.recipient);
  push(rawMsg?.recipient_id);
  push(rawMsg?.to?.id);
  push(rawMsg?.recipient?.id);
  push(rawMsg?.to?.data);
  push(rawMsg?.to?.data?.[0]);
  push(rawMsg?.to?.data?.[0]?.id);
  push(rawMsg?.to?.[0]);
  push(rawMsg?.to?.[0]?.id);
  const v = rawContainer?.value ?? rawContainer?.raw?.value ?? rawContainer?.value;
  push(v?.to);
  push(v?.recipient);
  push(v?.recipient_id);
  push(v?.to?.id);
  push(v?.recipient?.id);
  push(v?.to?.data);
  push(v?.to?.data?.[0]);
  push(v?.to?.data?.[0]?.id);
  for (const c of candidates){
    const id = typeof c === "string" ? c : typeof c === "number" ? String(c) : typeof c?.id === "string" ? c.id : typeof c?.id === "number" ? String(c.id) : "";
    const clean = String(id ?? "").trim();
    if (clean) return clean;
  }
  return null;
}
function findAnyOtherId(obj, avoid, depth = 0) {
  if (!obj || depth > 4) return null;
  if (typeof obj === "string" || typeof obj === "number") {
    const s = String(obj).trim();
    if (s && !avoid.has(s) && /^\d+$/.test(s)) return s;
    return null;
  }
  if (Array.isArray(obj)) {
    for (const it of obj){
      const r = findAnyOtherId(it, avoid, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof obj === "object") {
    if (typeof obj.id === "string" || typeof obj.id === "number") {
      const s = String(obj.id).trim();
      if (s && !avoid.has(s) && /^\d+$/.test(s)) return s;
    }
    const keys = Object.keys(obj);
    for (const k of keys){
      const r = findAnyOtherId(obj[k], avoid, depth + 1);
      if (r) return r;
    }
  }
  return null;
}
function normalizeFromMessagingArray(entry, object) {
  const metaInboxId = String(entry?.id ?? "");
  const messaging = entry?.messaging;
  if (!metaInboxId || !Array.isArray(messaging) || messaging.length === 0) return [];
  const out = [];
  for (const evt of messaging){
    const senderId = String(evt?.sender?.id ?? "");
    const recipientId = String(evt?.recipient?.id ?? "") || null;
    const msg = evt?.message;
    if (!senderId || !msg) continue;
    const providerMessageId = String(msg?.mid ?? "");
    const timestamp = normalizeTimestamp(evt?.timestamp);
    const text = String(msg?.text ?? "");
    const attachments = msg?.attachments ?? [];
    const channel = detectChannel({
      object,
      messagingProduct: null,
      providerMessageId
    });
    out.push({
      channel,
      metaInboxId,
      senderId,
      recipientId,
      providerMessageId,
      timestamp,
      text,
      attachments,
      raw: evt,
      rawMessage: msg
    });
  }
  return out;
}
function normalizeFromChanges(entry, object) {
  const metaInboxId = String(entry?.id ?? "");
  const changes = entry?.changes;
  if (!metaInboxId || !Array.isArray(changes) || changes.length === 0) return [];
  const out = [];
  for (const c of changes){
    if (c?.field !== "messages" || !c?.value) continue;
    const v = c.value;
    const messagingProduct = String(v?.messaging_product ?? v?.platform ?? "");
    const messages = Array.isArray(v?.messages) ? v.messages : [];
    const fallbackSender = String(v?.sender?.id ?? v?.from?.id ?? "");
    const fallbackRecipient = String(v?.recipient?.id ?? v?.to?.id ?? v?.recipient_id ?? "") || null;
    const fallbackTs = v?.timestamp ?? v?.time ?? null;
    if (messages.length > 0) {
      for (const m of messages){
        const senderId = String(m?.from?.id ?? fallbackSender ?? "");
        const providerMessageId = String(m?.id ?? m?.mid ?? "");
        const timestamp = normalizeTimestamp(m?.timestamp ?? fallbackTs);
        const text = typeof m?.text === "string" ? m.text : typeof m?.message === "string" ? m.message : typeof m?.message?.text === "string" ? m.message.text : "";
        const attachments = m?.attachments ?? m?.message?.attachments ?? v?.attachments ?? v?.message?.attachments ?? [];
        if (!senderId) continue;
        const channel = detectChannel({
          object,
          messagingProduct,
          providerMessageId
        });
        const explicitRecipient = String(m?.to?.id ?? m?.recipient?.id ?? "") || String(m?.to?.[0]?.id ?? "") || String(m?.to?.data?.[0]?.id ?? "") || String(fallbackRecipient ?? "") || "";
        const recipientId = explicitRecipient.trim() ? explicitRecipient.trim() : null;
        out.push({
          channel,
          metaInboxId,
          senderId,
          recipientId,
          providerMessageId,
          timestamp,
          text,
          attachments,
          raw: c,
          rawMessage: m
        });
      }
      continue;
    }
    const senderId = fallbackSender;
    const providerMessageId = String(v?.mid ?? v?.id ?? "");
    const timestamp = normalizeTimestamp(fallbackTs);
    const text = typeof v?.text === "string" ? v.text : typeof v?.message?.text === "string" ? v.message.text : "";
    const attachments = v?.attachments ?? v?.message?.attachments ?? [];
    if (!senderId) continue;
    const channel = detectChannel({
      object,
      messagingProduct,
      providerMessageId
    });
    const recipientId = fallbackRecipient;
    out.push({
      channel,
      metaInboxId,
      senderId,
      recipientId,
      providerMessageId,
      timestamp,
      text,
      attachments,
      raw: c,
      rawMessage: v
    });
  }
  return out;
}
function normalizeMetaEvents(entry, object) {
  return [
    ...normalizeFromMessagingArray(entry, object),
    ...normalizeFromChanges(entry, object)
  ];
}
function coerceSampleToWebhookBody(body) {
  const sample = body?.sample;
  if (!sample || sample?.field !== "messages") return null;
  const v = sample?.value ?? {};
  const senderId = String(v?.sender?.id ?? "");
  const recipientId = String(v?.recipient?.id ?? v?.recipient_id ?? "TEST_PAGE");
  const ts = v?.timestamp ?? Date.now();
  const mid = String(v?.message?.mid ?? "test_message_id");
  const text = String(v?.message?.text ?? "test_message");
  const attachments = v?.message?.attachments ?? [];
  if (!senderId) return null;
  return {
    object: "page",
    entry: [
      {
        id: recipientId,
        time: Math.floor(Number(ts) / 1000),
        messaging: [
          {
            sender: {
              id: senderId
            },
            recipient: {
              id: recipientId
            },
            timestamp: ts,
            message: {
              mid,
              text,
              attachments
            }
          }
        ]
      }
    ],
    __is_sample: true
  };
}
async function getAutomationSettings(opts) {
  const { supabase, clinicId, rid } = opts;
  const { data, error } = await supabase.from("conversation_automation_settings").select("reopen_on_inbound_enabled").eq("clinic_id", clinicId).maybeSingle();
  if (error) {
    logSbError(rid, "conversation_automation_settings.get", error, {
      clinicId
    });
    return {
      reopen_on_inbound_enabled: true
    };
  }
  return {
    reopen_on_inbound_enabled: data?.reopen_on_inbound_enabled === false ? false : true
  };
}
async function resolveClinicId(opts) {
  const { supabase, channel, metaInboxId, rid } = opts;
  if (channel === CHANNEL_MESSENGER) {
    const { data, error } = await supabase.from("channel_connections").select("clinic_id").eq("provider", "meta").eq("channel", "messenger").eq("meta_page_id", metaInboxId).maybeSingle();
    if (error) {
      logSbError(rid, "resolveClinicId.channel_connections.messenger", error, {
        metaInboxId
      });
    } else if (data?.clinic_id) {
      return data.clinic_id;
    }
  }
  if (channel === CHANNEL_INSTAGRAM) {
    const { data, error } = await supabase.from("channel_connections").select("clinic_id").eq("provider", "meta").eq("channel", "instagram").eq("meta_ig_user_id", metaInboxId).maybeSingle();
    if (error) {
      logSbError(rid, "resolveClinicId.channel_connections.instagram.ig_user", error, {
        metaInboxId
      });
    } else if (data?.clinic_id) {
      return data.clinic_id;
    }
    const { data: byPage, error: byPageErr } = await supabase.from("channel_connections").select("clinic_id").eq("provider", "meta").eq("channel", "instagram").eq("meta_page_id", metaInboxId).maybeSingle();
    if (byPageErr) {
      logSbError(rid, "resolveClinicId.channel_connections.instagram.page_fallback", byPageErr, {
        metaInboxId
      });
    } else if (byPage?.clinic_id) {
      return byPage.clinic_id;
    }
  }
  const { data: legacy, error: legacyErr } = await supabase.from("meta_inboxes").select("clinic_id").eq("channel", channel).eq("meta_inbox_id", metaInboxId).maybeSingle();
  if (legacyErr) {
    logSbError(rid, "resolveClinicId.meta_inboxes", legacyErr, {
      channel,
      metaInboxId
    });
  } else if (legacy?.clinic_id) {
    return legacy.clinic_id;
  }
  // Sem fallback para uma clínica padrão: mensagens de páginas/contas não
  // vinculadas seriam entregues à clínica errada.
  logStep(rid, "resolveClinicId.not_found", {
    channel,
    metaInboxId
  });
  return null;
}
async function resolveChannelConnectionId(opts) {
  const { supabase, clinicId, channel, metaInboxId, rid } = opts;
  if (channel === CHANNEL_MESSENGER) {
    const { data, error } = await supabase.from("channel_connections").select("id").eq("provider", "meta").eq("clinic_id", clinicId).eq("channel", "messenger").eq("meta_page_id", metaInboxId).maybeSingle();
    if (error) {
      logSbError(rid, "resolveChannelConnectionId.messenger", error, {
        clinicId,
        channel,
        metaInboxId
      });
      return null;
    }
    return data?.id ?? null;
  }
  if (channel === CHANNEL_INSTAGRAM) {
    const byIgUser = await supabase.from("channel_connections").select("id").eq("provider", "meta").eq("clinic_id", clinicId).eq("channel", "instagram").eq("meta_ig_user_id", metaInboxId).maybeSingle();
    if (!byIgUser.error && byIgUser.data?.id) {
      return byIgUser.data.id;
    }
    if (byIgUser.error) {
      logSbError(rid, "resolveChannelConnectionId.instagram.ig_user", byIgUser.error, {
        clinicId,
        channel,
        metaInboxId
      });
    }
    const byPage = await supabase.from("channel_connections").select("id").eq("provider", "meta").eq("clinic_id", clinicId).eq("channel", "instagram").eq("meta_page_id", metaInboxId).maybeSingle();
    if (byPage.error) {
      logSbError(rid, "resolveChannelConnectionId.instagram.page_fallback", byPage.error, {
        clinicId,
        channel,
        metaInboxId
      });
      return null;
    }
    return byPage.data?.id ?? null;
  }
  return null;
}
async function resolveDefaultDepartmentId(opts) {
  const { supabase, clinicId, rid } = opts;
  const { data, error } = await supabase.from("departments").select("id").eq("clinic_id", clinicId).eq("is_default", true).eq("is_active", true).maybeSingle();
  if (error) {
    logSbError(rid, "resolveDefaultDepartmentId", error, {
      clinicId
    });
    return null;
  }
  return data?.id ?? null;
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
async function getChannelToken(opts) {
  const { supabase, clinicId, channel, rid } = opts;
  const { data, error } = await supabase.from("channel_connections").select("access_token").eq("provider", "meta").eq("clinic_id", clinicId).eq("channel", channel).maybeSingle();
  if (error) {
    logSbError(rid, "channel_connections.token", error, {
      clinicId,
      channel
    });
    return null;
  }
  const token = String(data?.access_token ?? "").trim();
  return token || null;
}
async function fetchMessengerProfile(opts) {
  const { supabase, clinicId, senderId, rid } = opts;
  const token = await getChannelToken({
    supabase,
    clinicId,
    channel: CHANNEL_MESSENGER,
    rid
  });
  if (!token) return null;
  const r = await graphGet(`${encodeURIComponent(senderId)}?fields=first_name,last_name,profile_pic`, token);
  if (!r.ok) {
    logStep(rid, "graph.profile.messenger.failed", {
      status: r.status,
      clinicId,
      senderId
    });
    return null;
  }
  const first = String(r.body?.first_name ?? "").trim();
  const last = String(r.body?.last_name ?? "").trim();
  const full = `${first} ${last}`.trim();
  const pic = String(r.body?.profile_pic ?? "").trim();
  return {
    name: full || null,
    image_url: pic || null
  };
}
async function fetchInstagramProfile(opts) {
  const { supabase, clinicId, senderId, rid } = opts;
  const token = await getChannelToken({
    supabase,
    clinicId,
    channel: CHANNEL_INSTAGRAM,
    rid
  });
  if (!token) return null;
  const r = await graphGet(`${encodeURIComponent(senderId)}?fields=name,username,profile_pic`, token);
  if (!r.ok) {
    logStep(rid, "graph.profile.instagram.failed", {
      status: r.status,
      clinicId,
      senderId
    });
    return null;
  }
  const username = String(r.body?.username ?? "").trim();
  const name = String(r.body?.name ?? "").trim();
  const pic = String(r.body?.profile_pic ?? "").trim();
  return {
    name: username || name || null,
    image_url: pic || null
  };
}
async function resolveAttachmentUrlById(opts) {
  const { supabase, clinicId, channel, attachmentId, rid } = opts;
  const token = await getChannelToken({
    supabase,
    clinicId,
    channel,
    rid
  });
  if (!token) return null;
  const r = await graphGet(`${encodeURIComponent(attachmentId)}?fields=url,mime_type,filename,name`, token);
  if (!r.ok) {
    logStep(rid, "graph.attachment.failed", {
      status: r.status,
      clinicId,
      attachmentId,
      channel
    });
    return null;
  }
  const url = safeStr(r.body?.url);
  const mime = safeStr(r.body?.mime_type);
  const name = safeStr(r.body?.filename) || safeStr(r.body?.name);
  return {
    url: url || null,
    mime: mime || null,
    name: name || null
  };
}
serve(async (req)=>{
  const rid = crypto.randomUUID();
  try {
    const { method } = req;
    if (method === "GET") {
      const url = new URL(req.url);
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN && challenge) {
        return new Response(challenge, {
          status: 200
        });
      }
      return new Response("Erro de verificação", {
        status: 403
      });
    }
    if (method !== "POST") return new Response("Method not allowed", {
      status: 405
    });
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      logStep(rid, "env.missing", {
        hasUrl: !!supabaseUrl,
        hasServiceRole: !!supabaseKey
      });
      return new Response("Misconfigured env", {
        status: 500
      });
    }
    const raw = new Uint8Array(await req.arrayBuffer());
    const bodyText = new TextDecoder().decode(raw);
    const parsed = JSON.parse(bodyText);
    const coerced = coerceSampleToWebhookBody(parsed);
    const body = coerced ?? parsed;
    const isSample = !!body?.__is_sample;
    // Sem app secret não há como validar a origem: recusa (fail closed)
    if (!META_APP_SECRET && !ALLOW_UNSIGNED_TESTS) {
      logStep(rid, "env.missing_app_secret", {});
      return new Response("Misconfigured env", {
        status: 500
      });
    }
    if (META_APP_SECRET) {
      const signature256 = req.headers.get("x-hub-signature-256");
      const signature1 = req.headers.get("x-hub-signature");
      const { ok, used } = await verifyMetaSignature({
        header256: signature256,
        header1: signature1,
        rawBody: raw,
        appSecret: META_APP_SECRET
      });
      // Payloads "sample" são definidos por quem envia a requisição, então não
      // podem liberar a assinatura. Bypass só com META_ALLOW_UNSIGNED_TESTS=true
      // (nunca em produção).
      const bypass = (!signature256 && !signature1 && ALLOW_UNSIGNED_TESTS) === true;
      logStep(rid, "signature.check", {
        hasSignature256: !!signature256,
        hasSignature1: !!signature1,
        ok,
        used,
        bypass,
        isSample
      });
      if (!ok && !bypass) return new Response("Invalid signature", {
        status: 401
      });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    const object = body?.object ?? null;
    const entries = body?.entry ?? [];
    logStep(rid, "payload.shape", {
      isSample,
      object: object ?? null,
      entriesCount: entries.length
    });
    if (!object || entries.length === 0) return new Response("No entry", {
      status: 200
    });
    if (object !== "page" && object !== "instagram") {
      logStep(rid, "object.ignored", {
        object
      });
      return new Response("Ignored", {
        status: 200
      });
    }
    logStep(rid, "payload.meta", {
      object,
      firstEntryId: entries?.[0]?.id ?? null,
      firstEntryTime: entries?.[0]?.time ?? null,
      hasMessaging: Array.isArray(entries?.[0]?.messaging),
      hasChanges: Array.isArray(entries?.[0]?.changes)
    });
    for (const entry of entries){
      const metaInboxId = String(entry?.id ?? "");
      const normalized = normalizeMetaEvents(entry, object);
      logStep(rid, "entry.normalized", {
        metaInboxId,
        normalizedCount: normalized.length
      });
      logStep(rid, "entry.normalized.sample", {
        metaInboxId,
        object,
        sample: normalized.slice(0, 3).map((n)=>({
            channel: n.channel,
            senderId: n.senderId,
            recipientId: n.recipientId,
            providerMessageId: n.providerMessageId,
            textLen: (n.text ?? "").length,
            attachmentsCount: Array.isArray(n.attachments) ? n.attachments.length : 0
          }))
      });
      if (!metaInboxId || normalized.length === 0) continue;
      for (const e of normalized){
        const channel = e.channel;
        const senderId = e.senderId;
        const providerMessageId = e.providerMessageId;
        const timestamp = e.timestamp;
        const timestampIso = timestamp.toISOString();
        const text = e.text;
        const attachments = e.attachments ?? [];
        const rawMsg = e.rawMessage ?? {};
        if (!senderId) continue;
        const isFromBusiness = senderId === metaInboxId;
        const normalizedRecipient = e.recipientId;
        let recipientId = normalizedRecipient;
        if (!recipientId) {
          recipientId = extractRecipientIdLoose(rawMsg, e.raw);
        }
        if (!recipientId && isFromBusiness) {
          const avoid = new Set([
            String(metaInboxId),
            String(senderId)
          ]);
          const other = findAnyOtherId(e.raw, avoid) || findAnyOtherId(rawMsg, avoid);
          recipientId = other || null;
        }
        const direction = isFromBusiness ? DIRECTION_OUTBOUND : DIRECTION_INBOUND;
        const counterpartyId = isFromBusiness ? recipientId && recipientId !== metaInboxId ? recipientId : null : senderId;
        const metaConversationId = counterpartyId ? `${channel}:${metaInboxId}:${counterpartyId}` : null;
        logStep(rid, "routing.keys", {
          channel,
          metaInboxId,
          senderId,
          recipientId,
          isFromBusiness,
          direction,
          counterpartyId,
          metaConversationId
        });
        if (!counterpartyId) {
          logStep(rid, "counterparty.missing", {
            channel,
            metaInboxId,
            senderId,
            recipientId,
            providerMessageId,
            isFromBusiness
          });
          continue;
        }
        const clinicId = await resolveClinicId({
          supabase,
          channel,
          metaInboxId,
          rid
        });
        if (!clinicId) {
          logStep(rid, "clinicId.missing", {
            channel,
            metaInboxId
          });
          continue;
        }
        const channelConnectionId = await resolveChannelConnectionId({
          supabase,
          clinicId,
          channel,
          metaInboxId,
          rid
        });
        if (!channelConnectionId) {
          logStep(rid, "channel_connection_id.missing", {
            clinicId,
            channel,
            metaInboxId
          });
          continue;
        }
        const automationSettings = await getAutomationSettings({
          supabase,
          clinicId,
          rid
        });
        const defaultDepartmentId = await resolveDefaultDepartmentId({
          supabase,
          clinicId,
          rid
        });
        if (!defaultDepartmentId) {
          logStep(rid, "department.default.missing", {
            clinicId
          });
          continue;
        }
        const mediaBase = extractMediaFromMessageObject(rawMsg, attachments);
        const dbType = mediaBase.dbType === MESSAGE_TYPE_TEXT ? extractAttachmentType(attachments) : mediaBase.dbType;
        let media = mediaBase;
        const isMedia = dbType === MESSAGE_TYPE_IMAGE || dbType === MESSAGE_TYPE_AUDIO || dbType === MESSAGE_TYPE_DOCUMENT;
        if (isMedia && !media.image_url && !media.media_url && media.attachment_id) {
          const resolved = await resolveAttachmentUrlById({
            supabase,
            clinicId,
            channel,
            attachmentId: media.attachment_id,
            rid
          });
          if (resolved?.url) {
            if (dbType === MESSAGE_TYPE_IMAGE) media.image_url = resolved.url;
            else media.media_url = resolved.url;
            if (!media.media_mime_type && resolved.mime) media.media_mime_type = resolved.mime;
            if (!media.filename && resolved.name) media.filename = resolved.name;
            logStep(rid, "media.resolved_by_attachment_id", {
              channel,
              dbType,
              attachmentId: media.attachment_id,
              hasUrl: true
            });
          } else {
            logStep(rid, "media.resolve_failed", {
              channel,
              dbType,
              attachmentId: media.attachment_id,
              hasUrl: false
            });
          }
        }
        if (dbType === MESSAGE_TYPE_DOCUMENT && !media.filename) {
          const u = media.media_url || media.image_url || "";
          const derived = deriveFilenameFromUrl(u);
          if (derived) media.filename = derived;
        }
        const contactKey = `${channel}:${counterpartyId}`;
        const metaContactIdKey = `${channel}:${counterpartyId}`;
        const { data: foundContacts, error: contactFindErr } = await supabase.from("contacts").select("id, name, image_url").eq("clinic_id", clinicId).or(`phone.eq.${contactKey},meta_contact_id.eq.${metaContactIdKey}`).limit(1);
        if (contactFindErr) {
          logSbError(rid, "contacts.find", contactFindErr, {
            clinicId,
            contactKey,
            metaContactIdKey
          });
          continue;
        }
        let contact = foundContacts?.[0];
        let desiredName = null;
        let desiredImageUrl = null;
        if (channel === CHANNEL_MESSENGER) {
          const profile = await fetchMessengerProfile({
            supabase,
            clinicId,
            senderId: counterpartyId,
            rid
          });
          if (profile?.name) desiredName = profile.name;
          if (profile?.image_url) desiredImageUrl = profile.image_url;
        }
        if (channel === CHANNEL_INSTAGRAM) {
          const profile = await fetchInstagramProfile({
            supabase,
            clinicId,
            senderId: counterpartyId,
            rid
          });
          if (profile?.name) desiredName = profile.name;
          if (profile?.image_url) desiredImageUrl = profile.image_url;
        }
        if (!contact) {
          const insertPayload = {
            phone: contactKey,
            meta_contact_id: metaContactIdKey,
            name: desiredName || "Cliente",
            clinic_id: clinicId,
            first_seen_at: timestampIso,
            last_seen_at: timestampIso
          };
          if (desiredImageUrl) insertPayload.image_url = desiredImageUrl;
          const { data: newContact, error: insertErr } = await supabase.from("contacts").insert(insertPayload).select("id, name, image_url").single();
          if (insertErr) {
            if (String(insertErr?.code ?? "") === "23505") {
              const { data: retry, error: retryErr } = await supabase.from("contacts").select("id, name, image_url").eq("clinic_id", clinicId).eq("meta_contact_id", metaContactIdKey).maybeSingle();
              if (!retryErr && retry) contact = retry;
              else {
                logSbError(rid, "contacts.insert.duplicate_then_find_failed", retryErr, {
                  clinicId,
                  metaContactIdKey,
                  contactKey
                });
                continue;
              }
            } else {
              logSbError(rid, "contacts.insert", insertErr, {
                clinicId,
                contactKey,
                channel,
                metaInboxId,
                senderId,
                counterpartyId
              });
              continue;
            }
          } else {
            contact = newContact;
          }
        } else {
          const updates = {
            last_seen_at: timestampIso
          };
          const currentName = String(contact.name ?? "").trim();
          if (desiredName && (!currentName || currentName === "Cliente")) updates.name = desiredName;
          const currentImg = String(contact.image_url ?? "").trim();
          if (desiredImageUrl && (!currentImg || currentImg.length < 5)) updates.image_url = desiredImageUrl;
          const { error: updContactErr } = await supabase.from("contacts").update(updates).eq("id", contact.id);
          if (updContactErr) {
            logSbError(rid, "contacts.update", updContactErr, {
              contactId: contact.id,
              clinicId
            });
          }
          contact = {
            ...contact,
            ...updates
          };
        }
        const metaConversationIdFinal = `${channel}:${metaInboxId}:${counterpartyId}`;
        const { data: existingMessage, error: existingErr } = await supabase.from("messages").select("id").eq("meta_message_id", providerMessageId).maybeSingle();
        if (existingErr) {
          logSbError(rid, "messages.idempotency_check", existingErr, {
            providerMessageId,
            clinicId,
            channel
          });
          continue;
        }
        if (providerMessageId && existingMessage) {
          logStep(rid, "messages.idempotent.skip", {
            providerMessageId,
            clinicId,
            channel
          });
          continue;
        }
        // Resposta (nota 1 a 5) de pesquisa de satisfação pendente: registra na
        // conversa encerrada, sem reabrir nem criar novo atendimento.
        if (direction === DIRECTION_INBOUND && dbType === MESSAGE_TYPE_TEXT && channelConnectionId && contact?.id) {
          const surveyAnswer = await matchSurveyAnswer(supabase, {
            clinicId,
            contactId: contact.id,
            channelConnectionId,
            text
          });
          if (surveyAnswer) {
            const { error: surveyMsgErr } = await supabase.from("messages").insert({
              conversation_id: surveyAnswer.conversationId,
              meta_message_id: providerMessageId || `no-mid:${Date.now()}:${counterpartyId}`,
              direction,
              type: dbType,
              sender: senderId,
              receiver: metaInboxId,
              text,
              payload: e.raw,
              sent_at: timestampIso,
              is_automated: false
            });
            if (surveyMsgErr) {
              logSbError(rid, "messages.insert.survey_answer", surveyMsgErr, {
                conversationId: surveyAnswer.conversationId
              });
            }
            continue;
          }
        }
        const { data: foundConvByMeta, error: convMetaErr } = await supabase.from("conversations").select(`
            id,
            status,
            department_id,
            reopened_count,
            closed_at,
            first_inbound_at,
            first_outbound_at,
            first_unanswered_inbound_at
          `).eq("clinic_id", clinicId).eq("meta_conversation_id", metaConversationIdFinal).maybeSingle();
        if (convMetaErr) {
          logSbError(rid, "conversations.find_by_meta", convMetaErr, {
            clinicId,
            metaConversationId: metaConversationIdFinal,
            channel
          });
          continue;
        }
        let conversation = foundConvByMeta;
        // Reabertura automática desligada: mantém a conversa encerrada e abre um
        // novo atendimento. meta_conversation_id é único, então a conversa antiga
        // é desvinculada antes de criar a nova.
        if (conversation && conversation.status === STATUS_CLOSED && direction === DIRECTION_INBOUND && automationSettings.reopen_on_inbound_enabled !== true) {
          const { error: detachErr } = await supabase.from("conversations").update({
            meta_conversation_id: null
          }).eq("id", conversation.id);
          if (detachErr) {
            logSbError(rid, "conversations.detach_closed", detachErr, {
              conversationId: conversation.id,
              channel
            });
            continue;
          }
          conversation = null;
        }
        if (!conversation) {
          const insertConversationPayload = {
            clinic_id: clinicId,
            contact_id: contact.id,
            status: direction === DIRECTION_INBOUND ? STATUS_PENDING : STATUS_OPEN,
            channel,
            meta_conversation_id: metaConversationIdFinal,
            last_message_at: timestampIso,
            department_id: defaultDepartmentId,
            status_changed_at: new Date().toISOString()
          };
          if (direction === DIRECTION_INBOUND) {
            insertConversationPayload.last_inbound_at = timestampIso;
            insertConversationPayload.first_inbound_at = timestampIso;
            insertConversationPayload.first_unanswered_inbound_at = timestampIso;
          } else {
            insertConversationPayload.last_outbound_at = timestampIso;
            insertConversationPayload.first_outbound_at = timestampIso;
          }
          const { data: newConv, error: convErr } = await supabase.from("conversations").insert(insertConversationPayload).select(`
              id,
              status,
              department_id,
              reopened_count,
              closed_at,
              first_inbound_at,
              first_outbound_at,
              first_unanswered_inbound_at
            `).single();
          if (convErr) {
            if (String(convErr?.code ?? "") === "23505") {
              const { data: retryConv, error: retryConvErr } = await supabase.from("conversations").select(`
                  id,
                  status,
                  department_id,
                  reopened_count,
                  closed_at,
                  first_inbound_at,
                  first_outbound_at,
                  first_unanswered_inbound_at
                `).eq("clinic_id", clinicId).eq("meta_conversation_id", metaConversationIdFinal).maybeSingle();
              if (!retryConvErr && retryConv) {
                conversation = retryConv;
              } else {
                logSbError(rid, "conversations.insert.duplicate_then_find_failed", retryConvErr, {
                  clinicId,
                  metaConversationId: metaConversationIdFinal,
                  channel
                });
                continue;
              }
            } else {
              logSbError(rid, "conversations.insert", convErr, {
                clinicId,
                contactId: contact.id,
                channel,
                metaConversationId: metaConversationIdFinal
              });
              continue;
            }
          } else {
            conversation = newConv;
          }
        }
        if (!conversation?.id) {
          logStep(rid, "conversation.missing.after_resolve", {
            clinicId,
            channel,
            metaConversationIdFinal
          });
          continue;
        }
        const metaMessageIdFinal = providerMessageId || `no-mid:${Date.now()}:${counterpartyId}`;
        const messageInsert = {
          conversation_id: conversation.id,
          meta_message_id: metaMessageIdFinal,
          direction,
          type: dbType,
          sender: senderId,
          receiver: metaInboxId,
          text,
          payload: e.raw,
          sent_at: timestampIso,
          is_automated: false
        };
        if (isMedia) {
          if (media.image_url) messageInsert.image_url = media.image_url;
          if (media.media_url) messageInsert.media_url = media.media_url;
          if (media.media_mime_type) messageInsert.media_mime_type = media.media_mime_type;
          if (media.filename) messageInsert.filename = media.filename;
        }
        const { error: msgErr } = await supabase.from("messages").insert(messageInsert);
        if (msgErr) {
          logSbError(rid, "messages.insert", msgErr, {
            conversationId: conversation.id,
            clinicId,
            channel,
            metaInboxId,
            senderId,
            counterpartyId,
            metaMessageId: metaMessageIdFinal,
            isMedia,
            attachment_id: media.attachment_id
          });
          continue;
        }
        const shouldReopen = direction === DIRECTION_INBOUND && conversation.status === STATUS_CLOSED && automationSettings.reopen_on_inbound_enabled === true;
        const conversationUpdates = {
          last_message_at: timestampIso,
          updated_at: new Date().toISOString()
        };
        if (!conversation.department_id) {
          conversationUpdates.department_id = defaultDepartmentId;
        }
        if (direction === DIRECTION_INBOUND) {
          conversationUpdates.last_inbound_at = timestampIso;
          if (!conversation.first_inbound_at) {
            conversationUpdates.first_inbound_at = timestampIso;
          }
          if (!conversation.first_unanswered_inbound_at) {
            conversationUpdates.first_unanswered_inbound_at = timestampIso;
          }
          if (shouldReopen) {
            conversationUpdates.status = STATUS_PENDING;
            conversationUpdates.status_changed_at = new Date().toISOString();
            conversationUpdates.reopened_count = (conversation.reopened_count ?? 0) + 1;
          } else if (conversation.status !== STATUS_PENDING && conversation.status !== STATUS_CLOSED) {
            conversationUpdates.status = STATUS_PENDING;
            conversationUpdates.status_changed_at = new Date().toISOString();
          }
        } else {
          conversationUpdates.last_outbound_at = timestampIso;
          if (!conversation.first_outbound_at) {
            conversationUpdates.first_outbound_at = timestampIso;
          }
          conversationUpdates.first_unanswered_inbound_at = null;
        }
        const { error: updAfterMsgErr } = await supabase.from("conversations").update(conversationUpdates).eq("id", conversation.id);
        if (updAfterMsgErr) {
          logSbError(rid, "conversations.update.after_message", updAfterMsgErr, {
            conversationId: conversation.id,
            clinicId,
            channel
          });
          continue;
        }
        if (direction === DIRECTION_INBOUND) {
          const botCall = fetch(`${supabaseUrl}/functions/v1/bot-engine`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": INTERNAL_BOT_SECRET
            },
            body: JSON.stringify({
              clinicId,
              channelConnectionId,
              conversationId: conversation.id,
              messageId: metaMessageIdFinal,
              text,
              messageType: dbType
            })
          }).then(async (resp)=>{
            const result = await resp.json().catch(()=>null);
            logStep(rid, "bot_engine.called", {
              conversationId: conversation.id,
              clinicId,
              channel,
              channelConnectionId,
              ok: resp.ok,
              status: resp.status,
              result
            });
          }).catch((err)=>{
            console.error(JSON.stringify({
              rid,
              step: "bot_engine.call_failed",
              conversationId: conversation.id,
              clinicId,
              channel,
              channelConnectionId,
              message: err?.message ?? String(err)
            }, null, 2));
          });
          queueInboundPush(supabase, {
            conversationId: conversation.id,
            messageType: dbType,
            after: botCall
          });
        }
        if (shouldReopen) {
          const { error: evErr } = await supabase.from("conversation_events").insert({
            conversation_id: conversation.id,
            event_type: "reopened_automatically",
            performed_by: null,
            metadata: {
              reason: "incoming_message",
              channel,
              meta_message_id: metaMessageIdFinal,
              from_status: STATUS_CLOSED,
              to_status: STATUS_PENDING
            }
          });
          if (evErr) {
            logSbError(rid, "conversation_events.reopened.insert", evErr, {
              conversationId: conversation.id,
              clinicId,
              channel,
              meta_message_id: metaMessageIdFinal
            });
          }
        }
        logStep(rid, "messages.inserted", {
          channel,
          dbType,
          direction,
          metaMessageId: metaMessageIdFinal,
          hasText: !!text,
          filename: messageInsert.filename ?? null,
          counterpartyId
        });
      }
    }
    return new Response("OK", {
      status: 200
    });
  } catch (err) {
    console.error(JSON.stringify({
      rid,
      step: "unexpected_error",
      message: err?.message ?? String(err),
      stack: err?.stack ?? null
    }, null, 2));
    return new Response("Internal error", {
      status: 500
    });
  }
});
