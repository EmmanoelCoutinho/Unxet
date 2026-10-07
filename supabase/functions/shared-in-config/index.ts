/**
 * shared-in-config — Cérebro de processamento de mensagens inbound
 *
 * Recebe o payload normalizado de qualquer gateway (whatsapp-in, evolution-in)
 * e executa toda a lógica de negócio:
 *
 *  1.  Idempotência (evita reprocessar a mesma mensagem)
 *  2.  findOrCreateContact
 *  3.  findOrCreateConversation
 *  4.  Download + upload de mídia para o Storage (Meta e Evolution)
 *  5.  Insert da mensagem no banco
 *  6.  Atualização da conversa (timestamps, reopen, etc.)
 *  7.  Chamada ao bot-engine
 *  8.  Evento de reabertura (conversation_events)
 *  9.  Job de transcrição de áudio (transcription_jobs)
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STATUS_OPEN = "open";
const STATUS_PENDING = "pending";
const STATUS_CLOSED = "closed";
const CHANNEL_WHATSAPP = "whatsapp";
const DIRECTION_INBOUND = "inbound";
const MESSAGE_TYPE_TEXT = "text";
const MESSAGE_TYPE_IMAGE = "image";
const MESSAGE_TYPE_AUDIO = "audio";
const MESSAGE_TYPE_DOCUMENT = "document";
const MESSAGE_TYPE_INTERACTIVE = "interactive";
const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";
// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req)=>{
  try {
    // ── Validação básica ──────────────────────────────────────────────────
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405
      });
    }
    const secret = req.headers.get("x-internal-secret");
    if (INTERNAL_BOT_SECRET && secret !== INTERNAL_BOT_SECRET) {
      return new Response("Unauthorized", {
        status: 401
      });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes.");
      return new Response("Misconfigured env", {
        status: 500
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const payload = await req.json();
    const { provider, clinicId, channelConnectionId, waId, profileName, providerMessageId, timestamp: timestampIso, messageType, text, media, interactive, mediaFetchToken, rawPayload } = payload;
    // ── Validação dos campos obrigatórios ─────────────────────────────────
    if (!clinicId || !channelConnectionId || !waId || !providerMessageId) {
      console.error("Payload inválido — campos obrigatórios ausentes:", {
        clinicId,
        channelConnectionId,
        waId,
        providerMessageId
      });
      return new Response("Invalid payload", {
        status: 400
      });
    }
    const isTextMessage = messageType === MESSAGE_TYPE_TEXT;
    const isImageMessage = messageType === MESSAGE_TYPE_IMAGE;
    const isAudioMessage = messageType === MESSAGE_TYPE_AUDIO;
    const isDocumentMessage = messageType === MESSAGE_TYPE_DOCUMENT;
    const isInteractiveMessage = messageType === MESSAGE_TYPE_INTERACTIVE;
    const hasMedia = isImageMessage || isAudioMessage || isDocumentMessage;
    // ── 1. Idempotência ───────────────────────────────────────────────────
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
    // ── 2. Automation settings ────────────────────────────────────────────
    const automationSettings = await getAutomationSettings(supabase, clinicId);
    // ── 3. Departamento padrão ────────────────────────────────────────────
    const { data: defaultDept, error: defaultDeptErr } = await supabase.from("departments").select("id").eq("clinic_id", clinicId).eq("is_default", true).eq("is_active", true).maybeSingle();
    if (defaultDeptErr) {
      console.error("Erro ao buscar departamento padrão:", defaultDeptErr);
      return new Response("Default department lookup error", {
        status: 500
      });
    }
    const defaultDepartmentId = defaultDept?.id ?? null;
    if (!defaultDepartmentId) {
      console.error("Nenhum departamento padrão ativo encontrado para clinic:", clinicId);
      return new Response("Clinic missing default department", {
        status: 400
      });
    }
    // ── 4. findOrCreateContact ────────────────────────────────────────────
    const contact = await findOrCreateContact({
      supabase,
      clinicId,
      waId,
      profileName,
      timestampIso
    });
    // ── 5. whatsapp_number_id (Meta only) ─────────────────────────────────
    // Para a Evolution não existe whatsapp_numbers — usamos null.
    let whatsappNumberId = null;
    if (provider === "meta") {
      const { data: numberMap } = await supabase.from("whatsapp_numbers").select("id").eq("channel_connection_id", channelConnectionId).maybeSingle();
      whatsappNumberId = numberMap?.id ?? null;
    }
    // ── 6. findOrCreateConversation ───────────────────────────────────────
    const conversation = await findOrCreateConversation({
      supabase,
      clinicId,
      contactId: contact.id,
      channelConnectionId,
      whatsappNumberId,
      defaultDepartmentId,
      timestampIso
    });
    const wasClosed = conversation.status === STATUS_CLOSED;
    // ── 7. Processamento de mídia ─────────────────────────────────────────
    let imageUrl = null;
    let audioUrl = null;
    let documentUrl = null;
    let documentFilename = media?.filename ?? null;
    let mediaMimeType = media?.mimeType ?? null;
    let audioStoragePath = null;
    if (hasMedia && media) {
      try {
        let fileBytes = null;
        let resolvedContentType = mediaMimeType ?? "application/octet-stream";
        if (media.base64) {
          // Evolution envia alguns arquivos como:
          // data:image/jpeg;base64,...
          // então precisamos limpar o prefixo antes do atob.
          const cleanBase64 = media.base64.includes("base64,") ? media.base64.split("base64,")[1] : media.base64;
          const binaryStr = atob(cleanBase64);
          const bytes = new Uint8Array(binaryStr.length);
          for(let i = 0; i < binaryStr.length; i++){
            bytes[i] = binaryStr.charCodeAt(i);
          }
          fileBytes = bytes;
          if (media.mimeType) {
            resolvedContentType = media.mimeType;
          }
          console.log("[EVOLUTION_MEDIA_DECODED]", JSON.stringify({
            mimeType: resolvedContentType,
            size: bytes.length
          }));
        } else if (media.mediaId && mediaFetchToken) {
          // Meta: precisa primeiro buscar a URL via Graph API
          const mediaInfoResp = await fetch(`https://graph.facebook.com/v21.0/${media.mediaId}`, {
            headers: {
              Authorization: `Bearer ${mediaFetchToken}`
            }
          });
          if (mediaInfoResp.ok) {
            const mediaJson = await mediaInfoResp.json();
            const fileUrl = mediaJson.url;
            const fileResp = await fetch(fileUrl, {
              headers: {
                Authorization: `Bearer ${mediaFetchToken}`
              }
            });
            if (fileResp.ok && fileResp.body) {
              resolvedContentType = fileResp.headers.get("content-type") ?? resolvedContentType;
              fileBytes = await fileResp.arrayBuffer();
            } else {
              console.error("Erro ao baixar arquivo de mídia da Meta:", fileResp.status, await fileResp.text());
            }
          } else {
            console.error("Erro ao buscar media info na Meta:", mediaInfoResp.status, await mediaInfoResp.text());
          }
        }
        if (fileBytes) {
          if (!mediaMimeType) mediaMimeType = resolvedContentType;
          console.log('fileBytes', fileBytes);
          const ext = resolveExtension(resolvedContentType, media.filename);
          console.log('ext', ext);
          const safeFilename = (media.filename ?? "").trim();
          const fileName = safeFilename || `${media.mediaId ?? providerMessageId ?? Date.now()}.${ext}`;
          const folder = isImageMessage ? "inbound-images" : isAudioMessage ? "inbound-audios" : "inbound-documents";
          const path = `${clinicId}/${waId}/${folder}/${fileName}`;
          const { error: uploadError } = await supabase.storage.from(WHATSAPP_MEDIA_BUCKET).upload(path, fileBytes, {
            contentType: resolvedContentType,
            upsert: true
          });
          if (!uploadError) {
            const { data: publicData } = supabase.storage.from(WHATSAPP_MEDIA_BUCKET).getPublicUrl(path);
            const publicUrl = publicData?.publicUrl ?? null;
            if (isImageMessage) imageUrl = publicUrl;
            else if (isAudioMessage) {
              audioUrl = publicUrl;
              audioStoragePath = path;
            } else if (isDocumentMessage) {
              documentUrl = publicUrl;
              if (!documentFilename) documentFilename = media.filename ?? null;
            }
          } else {
            console.error("Erro ao fazer upload no Storage:", uploadError);
          }
        }
      } catch (e) {
        console.error("Erro inesperado ao processar mídia:", e);
      }
    }
    // ── 8. Insert da mensagem ─────────────────────────────────────────────
    const messageInsert = {
      conversation_id: conversation.id,
      meta_message_id: providerMessageId,
      direction: DIRECTION_INBOUND,
      type: messageType,
      sender: waId,
      text,
      payload: rawPayload,
      sent_at: timestampIso,
      is_automated: false
    };
    if (imageUrl) {
      messageInsert.image_url = imageUrl;
    }
    if (audioUrl) {
      messageInsert.media_url = audioUrl;
      if (mediaMimeType) messageInsert.media_mime_type = mediaMimeType;
    }
    if (documentUrl) {
      messageInsert.media_url = documentUrl;
      if (mediaMimeType) messageInsert.media_mime_type = mediaMimeType;
      if (documentFilename) messageInsert.filename = documentFilename;
    }
    const { data: insertedMsg, error: msgErr } = await supabase.from("messages").insert(messageInsert).select("id").maybeSingle();
    if (msgErr) {
      console.error("Erro inserindo mensagem:", msgErr);
      return new Response("Message insert error", {
        status: 500
      });
    }
    if (!insertedMsg?.id) {
      return new Response("Message insert failed", {
        status: 500
      });
    }
    // ── 9. Atualização da conversa ────────────────────────────────────────
    const shouldReopen = conversation.status === STATUS_CLOSED && automationSettings.reopen_on_inbound_enabled === true;
    const conversationUpdates = {
      last_message_at: timestampIso,
      last_inbound_at: timestampIso,
      updated_at: new Date().toISOString()
    };
    if (!conversation.first_inbound_at) {
      conversationUpdates.first_inbound_at = timestampIso;
    }
    if (!conversation.first_unanswered_inbound_at) {
      conversationUpdates.first_unanswered_inbound_at = timestampIso;
    }
    if (!conversation.department_id) {
      conversationUpdates.department_id = defaultDepartmentId;
    }
    if (shouldReopen) {
      conversationUpdates.status = STATUS_PENDING;
      conversationUpdates.status_changed_at = new Date().toISOString();
      conversationUpdates.reopened_count = (conversation.reopened_count ?? 0) + 1;
    }
    const { error: convUpdErr } = await supabase.from("conversations").update(conversationUpdates).eq("id", conversation.id);
    if (convUpdErr) {
      console.error("Erro ao sincronizar conversa inbound:", convUpdErr);
      return new Response("Conversation update error", {
        status: 500
      });
    }
    // ── 10. Bot-engine ────────────────────────────────────────────────────
    // Mensagens interativas NUNCA devem sinalizar reopenedFromClosed=true:
    // isso faria o engine cancelar a sessão em curso e reiniciar o fluxo,
    // ignorando a opção selecionada pelo usuário.
    try {
      const reopenedFromClosed = wasClosed && !isInteractiveMessage;
      const botResp = await fetch(`${SUPABASE_URL}/functions/v1/bot-engine`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_BOT_SECRET
        },
        body: JSON.stringify({
          clinicId,
          channelConnectionId,
          conversationId: conversation.id,
          messageId: insertedMsg.id,
          text,
          messageType,
          interactive: isInteractiveMessage ? {
            kind: interactive?.kind ?? null,
            selectedId: interactive?.selectedId ?? null,
            selectedTitle: interactive?.selectedTitle ?? null
          } : null,
          reopenedFromClosed
        })
      });
      if (!botResp.ok) {
        console.error("bot-engine retornou erro:", botResp.status, await botResp.text());
      }
    } catch (err) {
      console.error("Erro chamando bot-engine:", err);
    }
    // ── 11. Evento de reabertura ──────────────────────────────────────────
    if (shouldReopen) {
      const { error: evErr } = await supabase.from("conversation_events").insert({
        conversation_id: conversation.id,
        event_type: "reopened_automatically",
        performed_by: null,
        metadata: {
          reason: "incoming_message",
          channel: CHANNEL_WHATSAPP,
          provider,
          meta_message_id: providerMessageId,
          from_status: STATUS_CLOSED,
          to_status: STATUS_PENDING
        }
      });
      if (evErr) {
        console.error("Erro ao inserir evento de reabertura:", evErr);
      }
    }
    // ── 12. Job de transcrição de áudio ───────────────────────────────────
    if (isAudioMessage && audioStoragePath) {
      const { data: job, error: jobErr } = await supabase.from("transcription_jobs").insert({
        message_id: insertedMsg.id,
        bucket: WHATSAPP_MEDIA_BUCKET,
        storage_path: audioStoragePath,
        status: "PENDING"
      }).select("id").maybeSingle();
      if (!jobErr && job?.id) {
        fetch(`${SUPABASE_URL}/functions/v1/transcribe-worker`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            job_id: job.id,
            language: "pt"
          })
        }).catch((err)=>{
          console.error("Erro disparando transcribe-worker:", err);
        });
      } else if (jobErr) {
        console.error("Erro ao criar transcription_job:", jobErr);
      }
    }
    return new Response("OK", {
      status: 200
    });
  } catch (err) {
    console.error("Erro inesperado em shared-in-config:", err);
    return new Response("Internal error", {
      status: 500
    });
  }
});
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Resolve extensão de arquivo a partir do content-type ou nome do arquivo.
 */ function resolveExtension(contentType, filename) {
  if (filename) {
    const parts = filename.split(".");
    if (parts.length > 1) return parts[parts.length - 1];
  }
  console.log(contentType);
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("msword")) return "doc";
  if (contentType.includes("officedocument.wordprocessingml")) return "docx";
  if (contentType.includes("officedocument.spreadsheetml")) return "xlsx";
  if (contentType.includes("officedocument.presentationml")) return "pptx";
  if (contentType.includes("plain")) return "txt";
  return "bin";
}
async function getAutomationSettings(supabase, clinicId) {
  const { data, error } = await supabase.from("conversation_automation_settings").select("reopen_on_inbound_enabled").eq("clinic_id", clinicId).maybeSingle();
  if (error) {
    console.error("Erro ao buscar conversation_automation_settings:", error);
    return {
      reopen_on_inbound_enabled: true
    };
  }
  return {
    reopen_on_inbound_enabled: data?.reopen_on_inbound_enabled === false ? false : true
  };
}
async function findOrCreateContact(params) {
  const { supabase, clinicId, waId, profileName, timestampIso } = params;
  const { data: foundContacts, error: contactFindErr } = await supabase.from("contacts").select("*").eq("phone", waId).eq("clinic_id", clinicId).limit(1);
  if (contactFindErr) {
    console.error("Erro ao buscar contato:", contactFindErr);
    throw new Error("Contact lookup error");
  }
  let contact = foundContacts?.[0];
  if (!contact) {
    const { data: newContact, error: insertErr } = await supabase.from("contacts").insert({
      phone: waId,
      name: profileName,
      clinic_id: clinicId,
      meta_contact_id: waId,
      first_seen_at: timestampIso,
      last_seen_at: timestampIso
    }).select().limit(1);
    if (insertErr) {
      console.error("Erro ao inserir contato:", insertErr);
      throw new Error("Contact insert error");
    }
    contact = newContact?.[0];
  } else {
    const updates = {
      last_seen_at: timestampIso
    };
    if (!contact.name && profileName) {
      updates.name = profileName;
    }
    const { error: updateErr } = await supabase.from("contacts").update(updates).eq("id", contact.id);
    if (updateErr) {
      console.error("Erro ao atualizar contato:", updateErr);
      throw new Error("Contact update error");
    }
    contact = {
      ...contact,
      ...updates
    };
  }
  if (!contact?.id) {
    throw new Error("Contact not resolved");
  }
  return contact;
}
async function findOrCreateConversation(params) {
  const { supabase, clinicId, contactId, channelConnectionId, whatsappNumberId, defaultDepartmentId, timestampIso } = params;
  // Busca conversa existente filtrando por channel_connection_id —
  // isso garante isolamento correto entre Meta e Evolution mesmo que
  // o mesmo número de telefone exista em ambos os providers.
  const baseQuery = supabase.from("conversations").select("*").eq("clinic_id", clinicId).eq("contact_id", contactId).eq("channel", CHANNEL_WHATSAPP).eq("channel_connection_id", channelConnectionId).in("status", [
    STATUS_OPEN,
    STATUS_PENDING,
    STATUS_CLOSED
  ]).order("last_message_at", {
    ascending: false
  }).limit(1);
  const { data: foundConversations, error: convFindErr } = whatsappNumberId ? await baseQuery.eq("whatsapp_number_id", whatsappNumberId) : await baseQuery;
  if (convFindErr) {
    console.error("Erro ao buscar conversa:", convFindErr);
    throw new Error("Conversation lookup error");
  }
  let conversation = foundConversations?.[0];
  // -------------------------------------------------------------------
  // CREATE
  // -------------------------------------------------------------------
  if (!conversation) {
    const newConvPayload = {
      contact_id: contactId,
      clinic_id: clinicId,
      channel: CHANNEL_WHATSAPP,
      channel_connection_id: channelConnectionId,
      department_id: defaultDepartmentId,
      status: STATUS_PENDING,
      last_message_at: timestampIso,
      last_inbound_at: timestampIso,
      first_inbound_at: timestampIso,
      first_unanswered_inbound_at: timestampIso,
      status_changed_at: new Date().toISOString()
    };
    if (whatsappNumberId) {
      newConvPayload.whatsapp_number_id = whatsappNumberId;
    }
    const { data: newConv, error: convErr } = await supabase.from("conversations").insert(newConvPayload).select("*").maybeSingle();
    // ---------------------------------------------------------------
    // CONCORRÊNCIA / DUPLICIDADE
    // ---------------------------------------------------------------
    if (convErr?.code === "23505") {
      console.log("[CONVERSATION_ALREADY_EXISTS]", {
        clinicId,
        contactId,
        whatsappNumberId,
        channelConnectionId
      });
      // Outro processo criou primeiro.
      // Rebusca e reutiliza.
      const refetchBaseQuery = supabase.from("conversations").select("*").eq("clinic_id", clinicId).eq("contact_id", contactId).eq("channel", CHANNEL_WHATSAPP).eq("channel_connection_id", channelConnectionId).in("status", [
        STATUS_OPEN,
        STATUS_PENDING,
        STATUS_CLOSED
      ]).order("last_message_at", {
        ascending: false
      }).limit(1);
      const { data: refetchedConversations, error: refetchErr } = whatsappNumberId ? await refetchBaseQuery.eq("whatsapp_number_id", whatsappNumberId) : await refetchBaseQuery;
      if (refetchErr) {
        console.error("[CONVERSATION_REFETCH_ERROR]", refetchErr);
        throw new Error("Conversation refetch error");
      }
      conversation = refetchedConversations?.[0];
      if (!conversation?.id) {
        throw new Error("Conversation refetch failed");
      }
    } else if (convErr) {
      console.error("Erro ao inserir conversa:", convErr);
      throw new Error("Conversation insert error");
    } else {
      conversation = newConv;
    }
  }
  // -------------------------------------------------------------------
  // VALIDATION
  // -------------------------------------------------------------------
  if (!conversation?.id) {
    throw new Error("Conversation not resolved");
  }
  return conversation;
}
