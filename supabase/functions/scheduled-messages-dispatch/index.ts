/**
 * scheduled-messages-dispatch — Envia as mensagens programadas que venceram
 *
 * Chamada a cada minuto pelo pg_cron (migration
 * 20261017000000_scheduled_messages.sql), autenticada pelo header
 * x-internal-secret (INTERNAL_BOT_SECRET).
 *
 * A cada rodada pega até PER_CLINIC destinatários por empresa
 * (claim_scheduled_message_recipients já os marca como "sending") e envia pelo
 * número de WhatsApp escolhido na campanha, um de cada vez e com uma pausa
 * longa e aleatória entre eles. Empresas diferentes são processadas em paralelo.
 *
 * QR Code (Evolution): texto livre, com um anexo opcional (foto, vídeo, áudio
 * ou documento; o texto vira legenda). WhatsApp oficial (Meta): o modelo aprovado
 * da campanha (scheduled_messages.template_id), com o nome do cliente como
 * parâmetro; a Meta não deixa puxar conversa com texto livre.
 *
 * Ritmo (foco em não derrubar o número do cliente): 2 por empresa a cada
 * minuto, com 22 a 32 s entre os dois da rodada e um atraso inicial de até 8 s.
 * Na prática sai uma mensagem a cada ~30 s (nunca menos de ~15 s), cerca de
 * 120 por hora: 300 destinatários levam umas 2h30.
 *
 * Cada mensagem enviada fica registrada na conversa do cliente; se ele nunca
 * conversou com a empresa, a conversa nasce encerrada (não entra na fila) e é
 * reaberta quando ele responder.
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/security.ts";
import { clinicIsSuspended } from "../_shared/plan.ts";
import { findContactByPhone } from "../_shared/startConversation.ts";
import { blockIdentifiers, isIdentifierBlocked } from "../_shared/contactBlock.ts";
import { describeProviderError, renderScheduledText, sendDelayMs } from "../_shared/scheduledMessages.ts";
import { loadConnectionDepartment, pickDefaultDepartmentId } from "../_shared/connectionDepartment.ts";
import { buildTemplateMessage, describeTemplateSendError, renderTemplateText } from "../_shared/metaTemplates.ts";
import { isClinicMediaUrl, toProviderMediaUrl } from "../_shared/media.ts";
// META_GRAPH_URL só no ambiente local (simulador da Meta); sem ela, a Graph API real
const GRAPH = (Deno.env.get("META_GRAPH_URL") || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";
// 2 por empresa a cada minuto: a rodada (até ~45 s) termina antes da próxima
// chamada do cron. Mesmo ritmo de CAMPAIGN_SENDS_PER_MINUTE no frontend.
const PER_CLINIC = 2;
const MAX_PER_RUN = 60;
const START_JITTER_MAX_MS = 8000;
const SEND_DELAY_MIN_MS = 22000;
const SEND_DELAY_MAX_MS = 32000;
const REQUEST_TIMEOUT_MS = 20000;
// Com anexo a Evolution baixa o arquivo antes de responder
const MEDIA_REQUEST_TIMEOUT_MS = 60000;
const MEDIA_KINDS = new Set([
  "image",
  "audio",
  "video",
  "document"
]);
const sleep = (ms)=>new Promise((resolve)=>setTimeout(resolve, ms));
const onlyDigits = (value)=>String(value ?? "").replace(/\D/g, "");
// Números reais têm 10-13 dígitos; acima disso é LID do WhatsApp (mesma regra
// do send-evoluation-message)
const looksLikePhone = (value)=>/^\d{10,13}$/.test(value);
async function resolvePhoneNumber(connection, rawNumber) {
  if (looksLikePhone(rawNumber)) return rawNumber;
  try {
    for (const candidate of [
      `${rawNumber}@lid`,
      rawNumber
    ]){
      const resp = await fetch(`${connection.baseUrl}/chat/whatsappNumbers/${connection.session}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: connection.apiKey
        },
        body: JSON.stringify({
          numbers: [
            candidate
          ]
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!resp.ok) {
        await resp.body?.cancel();
        continue;
      }
      const json = await resp.json().catch(()=>null);
      const resolved = onlyDigits(json?.[0]?.number ?? json?.[0]?.jid?.split("@")[0] ?? "");
      if (looksLikePhone(resolved)) return resolved;
    }
  } catch (err) {
    console.error("[SCHEDULED_RESOLVE_PHONE_ERROR]", err instanceof Error ? err.message : String(err));
  }
  return rawNumber;
}
/** Número oficial (Meta) conectado, com token e o whatsapp_numbers dele, ou null. */ async function loadMetaConnection(supabase, clinicId, connectionId) {
  const { data: row, error } = await supabase.from("channel_connections").select("id, access_token, meta_phone_number_id").eq("id", connectionId).eq("clinic_id", clinicId).eq("provider", "meta").eq("channel", "whatsapp").eq("status", "connected").is("archived_at", null).maybeSingle();
  if (error) {
    console.error("[SCHEDULED_META_CONNECTION_ERROR]", error);
    return null;
  }
  const token = String(row?.access_token ?? "").trim();
  const phoneNumberId = String(row?.meta_phone_number_id ?? "").trim();
  if (!row?.id || !token || !phoneNumberId) return null;
  // Mesmo vínculo que o shared-in-config usa: a resposta do cliente cai na mesma conversa
  const { data: number } = await supabase.from("whatsapp_numbers").select("id").eq("channel_connection_id", row.id).maybeSingle();
  return {
    provider: "meta",
    id: row.id,
    token,
    phoneNumberId,
    whatsappNumberId: number?.id ?? null,
    // Remetente gravado na mensagem
    session: phoneNumberId
  };
}
/**
 * Número conectado por onde a programação sai, ou null.
 * Programação sem número escolhido (criada antes de existir a escolha) sai
 * pelo QR Code conectado mais recente da empresa.
 */ async function loadConnection(supabase, clinicId, connectionId) {
  if (connectionId) {
    const { data: kind } = await supabase.from("channel_connections").select("provider").eq("id", connectionId).eq("clinic_id", clinicId).maybeSingle();
    if (kind?.provider === "meta") return await loadMetaConnection(supabase, clinicId, connectionId);
  }
  let query = supabase.from("channel_connections").select("id, session_name, evolution_api_url, evolution_api_key").eq("clinic_id", clinicId).eq("provider", "evolution").eq("channel", "whatsapp").eq("status", "connected").is("archived_at", null);
  if (connectionId) query = query.eq("id", connectionId);
  const { data, error } = await query.order("last_connection_at", {
    ascending: false,
    nullsFirst: false
  }).limit(1);
  if (error) {
    console.error("[SCHEDULED_CONNECTION_QUERY_ERROR]", error);
    return null;
  }
  const row = data?.[0];
  if (!row?.session_name || !row.evolution_api_url || !row.evolution_api_key) return null;
  return {
    provider: "evolution",
    id: row.id,
    session: row.session_name,
    baseUrl: String(row.evolution_api_url).replace(/\/$/, ""),
    apiKey: row.evolution_api_key
  };
}
async function findOrCreateContact(supabase, clinicId, recipient, number) {
  if (recipient.contact_id) {
    const { data } = await supabase.from("contacts").select("id, phone").eq("id", recipient.contact_id).eq("clinic_id", clinicId).maybeSingle();
    if (data) return data;
  }
  const findByPhone = async ()=>{
    const { contact } = await findContactByPhone(supabase, clinicId, number, "id, phone");
    return contact;
  };
  const found = await findByPhone();
  if (found) return found;
  const { data: created, error } = await supabase.from("contacts").insert({
    clinic_id: clinicId,
    phone: number,
    name: recipient.name || number,
    meta_contact_id: number
  }).select("id, phone").maybeSingle();
  // Outra rodada (ou o cliente escrevendo) criou o contato no mesmo instante
  if (error?.code === "23505") return await findByPhone();
  if (error) throw error;
  return created;
}
async function findOrCreateConversation(supabase, clinicId, contactId, connectionId, sentAt, whatsappNumberId = null) {
  let findQuery = supabase.from("conversations").select("id, first_outbound_at").eq("clinic_id", clinicId).eq("contact_id", contactId).eq("channel", "whatsapp").eq("channel_connection_id", connectionId);
  if (whatsappNumberId) findQuery = findQuery.eq("whatsapp_number_id", whatsappNumberId);
  const { data: found, error: findErr } = await findQuery.order("last_message_at", {
    ascending: false,
    nullsFirst: false
  }).limit(1);
  if (findErr) throw findErr;
  if (found?.[0]) return found[0];
  const [{ data: department }, connectionDepartment] = await Promise.all([
    supabase.from("departments").select("id").eq("clinic_id", clinicId).eq("is_default", true).eq("is_active", true).maybeSingle(),
    loadConnectionDepartment(supabase, connectionId)
  ]);
  const departmentId = pickDefaultDepartmentId(connectionDepartment, clinicId, department?.id ?? null);
  if (!departmentId) throw new Error("Empresa sem departamento padrão ativo");
  // Encerrada: a empresa falou primeiro, não há ninguém esperando resposta
  const { data: created, error: createErr } = await supabase.from("conversations").insert({
    clinic_id: clinicId,
    contact_id: contactId,
    channel: "whatsapp",
    channel_connection_id: connectionId,
    ...whatsappNumberId ? {
      whatsapp_number_id: whatsappNumberId
    } : {},
    department_id: departmentId,
    status: "closed",
    closed_at: sentAt,
    status_changed_at: sentAt,
    last_message_at: sentAt
  }).select("id, first_outbound_at").maybeSingle();
  if (createErr) throw createErr;
  return created;
}
/** Grava a mensagem já enviada na conversa do cliente. Retorna os ids da conversa e da mensagem. */ async function recordSentMessage(supabase, params) {
  const { recipient, connection, number, text, providerResponse, template, media } = params;
  const isMeta = connection.provider === "meta";
  const sentAt = new Date().toISOString();
  const contact = await findOrCreateContact(supabase, recipient.clinic_id, recipient, number);
  if (!contact?.id) throw new Error("Contato não resolvido");
  // LID resolvido para o telefone real: evita resolver de novo nos próximos envios
  if (contact.phone !== number && !looksLikePhone(onlyDigits(contact.phone))) {
    await supabase.from("contacts").update({
      phone: number
    }).eq("id", contact.id);
  }
  const conversation = await findOrCreateConversation(supabase, recipient.clinic_id, contact.id, connection.id, sentAt, isMeta ? connection.whatsappNumberId : null);
  if (!conversation?.id) throw new Error("Conversa não resolvida");
  const { data: savedMessage, error: msgErr } = await supabase.from("messages").insert({
    conversation_id: conversation.id,
    direction: "outbound",
    type: media?.kind ?? "text",
    ...media ? {
      media_url: media.url,
      media_mime_type: media.mimeType,
      filename: media.filename
    } : {},
    // ID da mensagem no WhatsApp (necessário para apagar e para os status de entrega)
    meta_message_id: (isMeta ? providerResponse?.messages?.[0]?.id : providerResponse?.key?.id) ?? null,
    sender: connection.session,
    receiver: number,
    text,
    payload: {
      ...providerResponse && typeof providerResponse === "object" ? providerResponse : {},
      ...template ? {
        template: {
          id: template.id,
          name: template.meta_template_name,
          footer: template.footer ?? null,
          buttons: template.buttons ?? []
        }
      } : {},
      source: "scheduled-message",
      scheduled_message_id: recipient.scheduled_message_id,
      scheduled_by: recipient.created_by
    },
    sent_at: sentAt,
    created_at: sentAt,
    // Fora das métricas de tempo de resposta do atendente
    is_automated: true
  }).select("id").maybeSingle();
  if (msgErr) throw msgErr;
  const conversationUpdates = {
    updated_at: sentAt,
    last_message_at: sentAt,
    last_outbound_at: sentAt
  };
  if (!conversation.first_outbound_at) conversationUpdates.first_outbound_at = sentAt;
  await supabase.from("conversations").update(conversationUpdates).eq("id", conversation.id);
  return {
    conversationId: conversation.id,
    messageId: savedMessage?.id ?? null
  };
}
/** Manda o modelo aprovado pela Meta. Retorna { failure } ou { text, providerResponse }. */ async function sendMetaTemplate(connection, recipient, template, number) {
  const payload = buildTemplateMessage({
    to: number,
    metaTemplateName: template.meta_template_name,
    languageCode: template.language_code,
    body: template.body,
    name: recipient.name
  });
  try {
    const resp = await fetch(`${GRAPH}/${encodeURIComponent(connection.phoneNumberId)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const providerResponse = await resp.json().catch(()=>null);
    if (!resp.ok) {
      console.error("[SCHEDULED_META_SEND_REJECTED]", {
        recipientId: recipient.recipient_id,
        status: resp.status,
        code: providerResponse?.error?.code ?? null
      });
      return {
        failure: describeTemplateSendError(resp.status, providerResponse)
      };
    }
    return {
      text: renderTemplateText(template.body, recipient.name),
      providerResponse
    };
  } catch (err) {
    console.error("[SCHEDULED_META_SEND_ERROR]", {
      recipientId: recipient.recipient_id,
      error: err instanceof Error ? err.message : String(err)
    });
    return {
      failure: "O WhatsApp não respondeu a tempo. Confira a conversa antes de enviar de novo."
    };
  }
}
/**
 * Manda pela Evolution: só texto, ou o anexo com o texto de legenda. Áudio vai
 * sem legenda e o texto (se houver) sai logo depois, numa mensagem separada.
 * Retorna { failure } ou { providerResponse, textAfterAudio?, partialError? }.
 */ async function sendEvolution(supabase, connection, recipient, number, text, media) {
  const post = async (route, body)=>{
    const resp = await fetch(`${connection.baseUrl}/message/${route}/${connection.session}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: connection.apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(route === "sendText" ? REQUEST_TIMEOUT_MS : MEDIA_REQUEST_TIMEOUT_MS)
    });
    const json = await resp.json().catch(()=>null);
    return {
      ok: resp.ok,
      status: resp.status,
      json
    };
  };
  try {
    if (!media) {
      const resp = await post("sendText", {
        number,
        text
      });
      if (!resp.ok) {
        console.error("[SCHEDULED_SEND_REJECTED]", {
          recipientId: recipient.recipient_id,
          status: resp.status
        });
        return {
          failure: describeProviderError(resp.status, resp.json)
        };
      }
      return {
        providerResponse: resp.json
      };
    }
    let mediaLink;
    try {
      mediaLink = await toProviderMediaUrl(supabase, media.url);
    } catch  {
      return {
        failure: "Não foi possível preparar o arquivo para envio. Tente de novo."
      };
    }
    const resp = media.kind === "audio" ? await post("sendWhatsAppAudio", {
      number,
      audio: mediaLink,
      encoding: true
    }) : await post("sendMedia", {
      number,
      mediatype: media.kind,
      media: mediaLink,
      ...media.mimeType ? {
        mimetype: media.mimeType
      } : {},
      caption: text,
      ...media.kind === "document" ? {
        fileName: media.filename || "arquivo"
      } : {}
    });
    if (!resp.ok) {
      console.error("[SCHEDULED_MEDIA_REJECTED]", {
        recipientId: recipient.recipient_id,
        kind: media.kind,
        status: resp.status
      });
      return {
        failure: describeProviderError(resp.status, resp.json)
      };
    }
    if (media.kind !== "audio" || !text) return {
      providerResponse: resp.json
    };
    // O áudio já saiu: se o texto falhar, não marca como "falhou" (reenviar
    // mandaria o áudio de novo)
    await sleep(1500);
    try {
      const textResp = await post("sendText", {
        number,
        text
      });
      if (textResp.ok) return {
        providerResponse: resp.json,
        textAfterAudio: textResp.json
      };
    } catch  {
    // segue para o aviso abaixo
    }
    return {
      providerResponse: resp.json,
      partialError: "O áudio foi enviado, mas o texto não. Confira a conversa."
    };
  } catch (err) {
    console.error("[SCHEDULED_SEND_ERROR]", {
      recipientId: recipient.recipient_id,
      error: err instanceof Error ? err.message : String(err)
    });
    return {
      failure: "O WhatsApp não respondeu a tempo. Confira a conversa antes de enviar de novo."
    };
  }
}
/** Envia para um destinatário. Retorna o que gravar na linha dele. */ async function sendToRecipient(supabase, connection, recipient, template, media) {
  const isMeta = connection.provider === "meta";
  // A Meta recebe o número como está; o QR Code pode precisar trocar o LID pelo telefone
  const number = isMeta ? onlyDigits(recipient.phone) : await resolvePhoneNumber(connection, onlyDigits(recipient.phone));
  if (!looksLikePhone(number)) {
    return {
      status: "failed",
      error: "Não foi possível identificar o número deste contato."
    };
  }
  // Contato bloqueado: a empresa também não envia para ele
  if (await isIdentifierBlocked(supabase, recipient.clinic_id, blockIdentifiers(number, onlyDigits(recipient.phone)))) {
    return {
      status: "failed",
      error: "Contato bloqueado."
    };
  }
  let text = renderScheduledText(recipient.message, recipient.name);
  let providerResponse = null;
  // Áudio não tem legenda: o texto sai numa segunda mensagem
  let textAfterAudio = null;
  let partialError = null;
  if (isMeta) {
    if (!template) {
      return {
        status: "failed",
        error: "A campanha está sem modelo aprovado pela Meta."
      };
    }
    const sent = await sendMetaTemplate(connection, recipient, template, number);
    if (sent.failure) return {
      status: "failed",
      error: sent.failure
    };
    text = sent.text;
    providerResponse = sent.providerResponse;
  } else {
    const sent = await sendEvolution(supabase, connection, recipient, number, text, media);
    if (sent.failure) return {
      status: "failed",
      error: sent.failure
    };
    providerResponse = sent.providerResponse;
    textAfterAudio = sent.textAfterAudio ?? null;
    partialError = sent.partialError ?? null;
  }
  // A mensagem já saiu: falha ao gravar o histórico não pode virar "falhou"
  // (a pessoa reenviaria e o cliente receberia em dobro)
  let conversationId = null;
  let messageId = null;
  try {
    const sentMedia = isMeta ? null : media;
    ({ conversationId, messageId } = await recordSentMessage(supabase, {
      recipient,
      connection,
      number,
      // Áudio: o texto fica na mensagem seguinte
      text: sentMedia?.kind === "audio" ? "" : text,
      providerResponse,
      template: isMeta ? template : null,
      media: sentMedia
    }));
    if (textAfterAudio) {
      await recordSentMessage(supabase, {
        recipient,
        connection,
        number,
        text,
        providerResponse: textAfterAudio,
        template: null,
        media: null
      });
    }
  } catch (err) {
    console.error("[SCHEDULED_RECORD_ERROR]", {
      recipientId: recipient.recipient_id,
      error: err instanceof Error ? err.message : JSON.stringify(err)
    });
  }
  return {
    status: "sent",
    sent_at: new Date().toISOString(),
    conversation_id: conversationId,
    // Liga ao "entregue" e "lida" que o webhook grava na mensagem
    message_id: messageId,
    error: partialError ?? (conversationId ? null : "Enviada, mas não foi possível registrar na conversa.")
  };
}
const finishRecipient = async (supabase, recipientId, patch)=>{
  const { error } = await supabase.from("scheduled_message_recipients").update(patch).eq("id", recipientId).eq("status", "sending");
  if (error) console.error("[SCHEDULED_RECIPIENT_UPDATE_ERROR]", recipientId, error);
};
async function processClinic(supabase, clinicId, recipients) {
  const counts = {
    sent: 0,
    failed: 0,
    cancelled: 0
  };
  // Uma busca por número de saída (chave vazia = programação sem número escolhido)
  const connections = new Map();
  const connectionFor = async (connectionId)=>{
    const key = connectionId ?? "";
    if (!connections.has(key)) connections.set(key, await loadConnection(supabase, clinicId, connectionId));
    return connections.get(key);
  };
  // Modelo da Meta (só campanhas pelo número oficial) e anexo de cada envio
  const extras = new Map();
  const extrasFor = async (scheduledMessageId)=>{
    if (!extras.has(scheduledMessageId)) {
      const { data } = await supabase.from("scheduled_messages").select("media_url, media_mime_type, media_filename, media_kind, template:message_templates(id, meta_template_name, language_code, body, footer, buttons, status)").eq("id", scheduledMessageId).maybeSingle();
      const template = data?.template ?? null;
      const media = data?.media_url && MEDIA_KINDS.has(data.media_kind) && isClinicMediaUrl(data.media_url, clinicId) ? {
        url: data.media_url,
        kind: data.media_kind,
        mimeType: data.media_mime_type ?? null,
        filename: data.media_filename ?? null
      } : null;
      extras.set(scheduledMessageId, {
        template: template?.meta_template_name ? template : null,
        media
      });
    }
    return extras.get(scheduledMessageId);
  };
  const suspended = await clinicIsSuspended(supabase, clinicId);
  // Empresas diferentes não disparam todas no mesmo segundo
  await sleep(sendDelayMs(0, START_JITTER_MAX_MS));
  for(let index = 0; index < recipients.length; index++){
    const recipient = recipients[index];
    // Cancelada enquanto a rodada estava em andamento
    const { data: parent } = await supabase.from("scheduled_messages").select("status").eq("id", recipient.scheduled_message_id).maybeSingle();
    if (parent?.status !== "processing") {
      await finishRecipient(supabase, recipient.recipient_id, {
        status: "cancelled"
      });
      counts.cancelled++;
      continue;
    }
    if (suspended) {
      await finishRecipient(supabase, recipient.recipient_id, {
        status: "failed",
        error: "O acesso da empresa estava pausado no horário do envio."
      });
      counts.failed++;
      continue;
    }
    const connection = await connectionFor(recipient.channel_connection_id ?? null);
    if (!connection) {
      await finishRecipient(supabase, recipient.recipient_id, {
        status: "failed",
        error: recipient.channel_connection_id ? "O número de WhatsApp escolhido estava desconectado no horário do envio." : "O WhatsApp (QR Code) da empresa estava desconectado no horário do envio."
      });
      counts.failed++;
      continue;
    }
    const { template, media } = await extrasFor(recipient.scheduled_message_id);
    const result = await sendToRecipient(supabase, connection, recipient, connection.provider === "meta" ? template : null, media);
    await finishRecipient(supabase, recipient.recipient_id, result);
    counts[result.status === "sent" ? "sent" : "failed"]++;
    if (index < recipients.length - 1) {
      await sleep(sendDelayMs(SEND_DELAY_MIN_MS, SEND_DELAY_MAX_MS));
    }
  }
  return counts;
}
serve(async (req)=>{
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405
      });
    }
    const providedSecret = req.headers.get("x-internal-secret") ?? "";
    if (!INTERNAL_BOT_SECRET || !timingSafeEqual(providedSecret, INTERNAL_BOT_SECRET)) {
      return new Response("Unauthorized", {
        status: 401
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: claimed, error } = await supabase.rpc("claim_scheduled_message_recipients", {
      p_per_clinic: PER_CLINIC,
      p_max: MAX_PER_RUN
    });
    if (error) {
      console.error("[SCHEDULED_CLAIM_ERROR]", error);
      return new Response(JSON.stringify({
        success: false
      }), {
        status: 500
      });
    }
    const byClinic = new Map();
    for (const recipient of claimed ?? []){
      const list = byClinic.get(recipient.clinic_id) ?? [];
      list.push(recipient);
      byClinic.set(recipient.clinic_id, list);
    }
    const totals = {
      sent: 0,
      failed: 0,
      cancelled: 0
    };
    const results = await Promise.allSettled(Array.from(byClinic.entries()).map(([clinicId, recipients])=>processClinic(supabase, clinicId, recipients)));
    for (const result of results){
      if (result.status === "rejected") {
        // Os destinatários dessa empresa ficam "sending" e viram "falhou" na
        // recuperação da próxima rodada
        console.error("[SCHEDULED_CLINIC_ERROR]", result.reason);
        continue;
      }
      totals.sent += result.value.sent;
      totals.failed += result.value.failed;
      totals.cancelled += result.value.cancelled;
    }
    const { error: finalizeErr } = await supabase.rpc("finalize_scheduled_messages");
    if (finalizeErr) console.error("[SCHEDULED_FINALIZE_ERROR]", finalizeErr);
    console.log("[SCHEDULED_DISPATCH]", JSON.stringify({
      claimed: claimed?.length ?? 0,
      clinics: byClinic.size,
      ...totals
    }));
    return new Response(JSON.stringify({
      success: true,
      claimed: claimed?.length ?? 0,
      ...totals
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("[SCHEDULED_DISPATCH_FATAL_ERROR]", err);
    return new Response(JSON.stringify({
      success: false
    }), {
      status: 500
    });
  }
});
