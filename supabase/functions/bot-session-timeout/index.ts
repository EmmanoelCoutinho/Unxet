/**
 * bot-session-timeout — Encerra sessões de bot paradas há tempo demais
 *
 * Cada bot define em bots.session_timeout_hours (1 a 24h, padrão 24h) quanto
 * tempo espera pela resposta do cliente. Passado o prazo, a sessão vira
 * "expired" (motivo "timeout"), a conversa segue na fila de atendimento e, se
 * o bot tiver timeout_message, ela é enviada ao cliente.
 *
 * Chamada a cada 5 minutos pelo pg_cron (migration
 * 20261011100200_bot_session_timeout.sql), autenticada pelo header
 * x-internal-secret (INTERNAL_BOT_SECRET).
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/security.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";
const DEFAULT_TIMEOUT_HOURS = 24;
const MIN_TIMEOUT_HOURS = 1;
const HOUR_MS = 60 * 60 * 1000;
// Teto por execução; o restante fica para a próxima rodada do cron
const BATCH_SIZE = 200;
function timeoutHours(bot) {
  const hours = Number(bot?.session_timeout_hours);
  if (!Number.isFinite(hours) || hours < MIN_TIMEOUT_HOURS) return DEFAULT_TIMEOUT_HOURS;
  return Math.min(hours, DEFAULT_TIMEOUT_HOURS);
}
async function sendTimeoutMessage(supabase, session, bot, text) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/bot-sender-whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": INTERNAL_BOT_SECRET
    },
    body: JSON.stringify({
      clinicId: session.clinic_id,
      channelConnectionId: session.channel_connection_id,
      conversationId: session.conversation_id,
      type: "text",
      text
    })
  });
  const result = await resp.json().catch(()=>({}));
  if (!resp.ok) {
    // Ex.: janela de 24h do WhatsApp oficial já fechada
    console.error("[BOT_SESSION_TIMEOUT_SEND_FAILED]", {
      sessionId: session.id,
      status: resp.status
    });
    return false;
  }
  const { data: connection } = await supabase.from("channel_connections").select("provider, meta_phone_number_id").eq("id", session.channel_connection_id).maybeSingle();
  const sentAt = new Date().toISOString();
  const { error: msgErr } = await supabase.from("messages").insert({
    conversation_id: session.conversation_id,
    meta_message_id: result?.providerMessageId ?? null,
    direction: "outbound",
    type: "text",
    sender: connection?.meta_phone_number_id ?? null,
    text,
    payload: {
      provider: connection?.provider ?? "meta",
      source: "bot-session-timeout",
      author_type: "bot",
      author_name: bot.name,
      bot: {
        bot_id: bot.id,
        bot_name: bot.name,
        conversation_bot_session_id: session.id,
        node_type: "timeout_message"
      }
    },
    sent_at: sentAt,
    is_automated: true
  });
  if (msgErr) {
    console.error("[BOT_SESSION_TIMEOUT_MESSAGE_INSERT_ERROR]", msgErr);
  }
  await supabase.from("conversations").update({
    last_message_at: sentAt,
    last_outbound_at: sentAt,
    updated_at: sentAt
  }).eq("id", session.conversation_id);
  return true;
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
    const now = Date.now();
    // Pré-filtro pelo menor prazo possível; o prazo de cada bot é conferido abaixo
    const { data: sessions, error } = await supabase.from("conversation_bot_sessions").select("id, clinic_id, conversation_id, bot_id, channel_connection_id, current_node_id, last_interaction_at, bots(id, name, timeout_message, session_timeout_hours)").eq("status", "active").lt("last_interaction_at", new Date(now - MIN_TIMEOUT_HOURS * HOUR_MS).toISOString()).order("last_interaction_at", {
      ascending: true
    }).limit(BATCH_SIZE);
    if (error) {
      console.error("[BOT_SESSION_TIMEOUT_QUERY_ERROR]", error);
      return new Response(JSON.stringify({
        success: false
      }), {
        status: 500
      });
    }
    let expired = 0;
    let notified = 0;
    for (const session of sessions ?? []){
      const bot = session.bots;
      if (!bot) continue;
      const idleMs = now - new Date(session.last_interaction_at).getTime();
      if (idleMs < timeoutHours(bot) * HOUR_MS) continue;
      const endedAt = new Date().toISOString();
      // Só encerra se ninguém mexeu na sessão desde a leitura (o cliente pode
      // ter respondido neste meio-tempo)
      const { data: closed, error: closeErr } = await supabase.from("conversation_bot_sessions").update({
        status: "expired",
        ended_reason: "timeout",
        completed_at: endedAt,
        current_node_id: null,
        updated_at: endedAt
      }).eq("id", session.id).eq("status", "active").eq("last_interaction_at", session.last_interaction_at).select("id");
      if (closeErr) {
        console.error("[BOT_SESSION_TIMEOUT_UPDATE_ERROR]", closeErr);
        continue;
      }
      if (!closed?.length) continue;
      expired++;
      await supabase.from("conversation_bot_events").insert({
        clinic_id: session.clinic_id,
        conversation_bot_session_id: session.id,
        conversation_id: session.conversation_id,
        bot_id: session.bot_id,
        node_id: session.current_node_id ?? null,
        event_type: "session_completed",
        payload: {
          reason: "timeout",
          timeout_hours: timeoutHours(bot)
        }
      });
      await supabase.from("conversation_events").insert({
        conversation_id: session.conversation_id,
        event_type: "bot_session_ended",
        performed_by: null,
        metadata: {
          bot_id: session.bot_id,
          conversation_bot_session_id: session.id,
          reason: "timeout"
        }
      });
      const text = bot.timeout_message?.trim();
      if (!text) continue;
      // Só avisa o cliente se a conversa ainda está na fila: com atendente
      // (open) ou encerrada (closed) a mensagem do bot só atrapalharia.
      const { data: conversation } = await supabase.from("conversations").select("status, channel").eq("id", session.conversation_id).maybeSingle();
      if (conversation?.status !== "pending" || conversation?.channel !== "whatsapp") continue;
      try {
        if (await sendTimeoutMessage(supabase, session, bot, text)) notified++;
      } catch (err) {
        console.error("[BOT_SESSION_TIMEOUT_SEND_ERROR]", err instanceof Error ? err.message : String(err));
      }
    }
    return new Response(JSON.stringify({
      success: true,
      checked: sessions?.length ?? 0,
      expired,
      notified
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("[BOT_SESSION_TIMEOUT_UNEXPECTED_ERROR]", err);
    return new Response(JSON.stringify({
      success: false
    }), {
      status: 500
    });
  }
});
