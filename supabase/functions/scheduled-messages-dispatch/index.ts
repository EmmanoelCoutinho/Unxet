/**
 * scheduled-messages-dispatch — Envia as mensagens programadas que venceram
 *
 * Chamada a cada minuto pelo pg_cron (migration
 * 20261017000000_scheduled_messages.sql), autenticada pelo header
 * x-internal-secret (INTERNAL_BOT_SECRET).
 *
 * A cada rodada pega até PER_CLINIC destinatários por empresa
 * (claim_scheduled_message_recipients já os marca como "sending") e envia pelo
 * WhatsApp conectado por QR Code (Evolution) da empresa, um de cada vez e com
 * uma pausa entre eles. Empresas diferentes são processadas em paralelo.
 *
 * Cada mensagem enviada fica registrada na conversa do cliente; se ele nunca
 * conversou com a empresa, a conversa nasce encerrada (não entra na fila) e é
 * reaberta quando ele responder.
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/security.ts";
import { describeProviderError, renderScheduledText, sendDelayMs } from "../_shared/scheduledMessages.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";
// 6 por empresa a cada minuto: a rodada termina antes da próxima chamada do cron
const PER_CLINIC = 6;
const MAX_PER_RUN = 60;
const SEND_DELAY_MIN_MS = 3000;
const SEND_DELAY_MAX_MS = 6000;
const REQUEST_TIMEOUT_MS = 20000;
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
/** Conexão QR Code conectada da empresa, ou null. */ async function loadConnection(supabase, clinicId) {
  const { data, error } = await supabase.from("channel_connections").select("id, session_name, evolution_api_url, evolution_api_key").eq("clinic_id", clinicId).eq("provider", "evolution").eq("channel", "whatsapp").eq("status", "connected").order("last_connection_at", {
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
    const { data } = await supabase.from("contacts").select("id, phone").eq("clinic_id", clinicId).eq("phone", number).limit(1);
    return data?.[0] ?? null;
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
async function findOrCreateConversation(supabase, clinicId, contactId, connectionId, sentAt) {
  const { data: found, error: findErr } = await supabase.from("conversations").select("id, first_outbound_at").eq("clinic_id", clinicId).eq("contact_id", contactId).eq("channel", "whatsapp").eq("channel_connection_id", connectionId).order("last_message_at", {
    ascending: false,
    nullsFirst: false
  }).limit(1);
  if (findErr) throw findErr;
  if (found?.[0]) return found[0];
  const { data: department } = await supabase.from("departments").select("id").eq("clinic_id", clinicId).eq("is_default", true).eq("is_active", true).maybeSingle();
  if (!department?.id) throw new Error("Empresa sem departamento padrão ativo");
  // Encerrada: a empresa falou primeiro, não há ninguém esperando resposta
  const { data: created, error: createErr } = await supabase.from("conversations").insert({
    clinic_id: clinicId,
    contact_id: contactId,
    channel: "whatsapp",
    channel_connection_id: connectionId,
    department_id: department.id,
    status: "closed",
    closed_at: sentAt,
    status_changed_at: sentAt,
    last_message_at: sentAt
  }).select("id, first_outbound_at").maybeSingle();
  if (createErr) throw createErr;
  return created;
}
/** Grava a mensagem já enviada na conversa do cliente. Retorna o id da conversa. */ async function recordSentMessage(supabase, params) {
  const { recipient, connection, number, text, providerResponse } = params;
  const sentAt = new Date().toISOString();
  const contact = await findOrCreateContact(supabase, recipient.clinic_id, recipient, number);
  if (!contact?.id) throw new Error("Contato não resolvido");
  // LID resolvido para o telefone real: evita resolver de novo nos próximos envios
  if (contact.phone !== number && !looksLikePhone(onlyDigits(contact.phone))) {
    await supabase.from("contacts").update({
      phone: number
    }).eq("id", contact.id);
  }
  const conversation = await findOrCreateConversation(supabase, recipient.clinic_id, contact.id, connection.id, sentAt);
  if (!conversation?.id) throw new Error("Conversa não resolvida");
  const { error: msgErr } = await supabase.from("messages").insert({
    conversation_id: conversation.id,
    direction: "outbound",
    type: "text",
    // ID da mensagem no WhatsApp (necessário para apagar e para os status de entrega)
    meta_message_id: providerResponse?.key?.id ?? null,
    sender: connection.session,
    receiver: number,
    text,
    payload: {
      ...providerResponse && typeof providerResponse === "object" ? providerResponse : {},
      source: "scheduled-message",
      scheduled_message_id: recipient.scheduled_message_id,
      scheduled_by: recipient.created_by
    },
    sent_at: sentAt,
    created_at: sentAt,
    // Fora das métricas de tempo de resposta do atendente
    is_automated: true
  });
  if (msgErr) throw msgErr;
  const conversationUpdates = {
    updated_at: sentAt,
    last_message_at: sentAt,
    last_outbound_at: sentAt
  };
  if (!conversation.first_outbound_at) conversationUpdates.first_outbound_at = sentAt;
  await supabase.from("conversations").update(conversationUpdates).eq("id", conversation.id);
  return conversation.id;
}
/** Envia para um destinatário. Retorna o que gravar na linha dele. */ async function sendToRecipient(supabase, connection, recipient) {
  const number = await resolvePhoneNumber(connection, onlyDigits(recipient.phone));
  if (!looksLikePhone(number)) {
    return {
      status: "failed",
      error: "Não foi possível identificar o número deste contato."
    };
  }
  const text = renderScheduledText(recipient.message, recipient.name);
  let providerResponse = null;
  try {
    const resp = await fetch(`${connection.baseUrl}/message/sendText/${connection.session}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: connection.apiKey
      },
      body: JSON.stringify({
        number,
        text
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    providerResponse = await resp.json().catch(()=>null);
    if (!resp.ok) {
      console.error("[SCHEDULED_SEND_REJECTED]", {
        recipientId: recipient.recipient_id,
        status: resp.status
      });
      return {
        status: "failed",
        error: describeProviderError(resp.status, providerResponse)
      };
    }
  } catch (err) {
    console.error("[SCHEDULED_SEND_ERROR]", {
      recipientId: recipient.recipient_id,
      error: err instanceof Error ? err.message : String(err)
    });
    return {
      status: "failed",
      error: "O WhatsApp não respondeu a tempo. Confira a conversa antes de enviar de novo."
    };
  }
  // A mensagem já saiu: falha ao gravar o histórico não pode virar "falhou"
  // (a pessoa reenviaria e o cliente receberia em dobro)
  let conversationId = null;
  try {
    conversationId = await recordSentMessage(supabase, {
      recipient,
      connection,
      number,
      text,
      providerResponse
    });
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
    error: conversationId ? null : "Enviada, mas não foi possível registrar na conversa."
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
  const connection = await loadConnection(supabase, clinicId);
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
    if (!connection) {
      await finishRecipient(supabase, recipient.recipient_id, {
        status: "failed",
        error: "O WhatsApp (QR Code) da empresa estava desconectado no horário do envio."
      });
      counts.failed++;
      continue;
    }
    const result = await sendToRecipient(supabase, connection, recipient);
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
