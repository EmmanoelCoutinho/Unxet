import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/security.ts";
import { clinicHasFeature } from "../_shared/plan.ts";
import { classifyUnmatchedInput } from "../_shared/botInput.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";
const CHANNEL_WHATSAPP = "whatsapp";
const STATUS_OPEN = "open";
const STATUS_PENDING = "pending";
const DIRECTION_INBOUND = "inbound";
const DIRECTION_OUTBOUND = "outbound";
const MESSAGE_TYPE_TEXT = "text";
const MESSAGE_TYPE_INTERACTIVE = "interactive";
const SESSION_STATUS_ACTIVE = "active";
const SESSION_STATUS_COMPLETED = "completed";
const SESSION_STATUS_CANCELLED = "cancelled";
const SESSION_STATUS_EXPIRED = "expired";
const DEFAULT_SESSION_TIMEOUT_HOURS = 24;
// Silêncio que o bot espera antes de responder, para juntar mensagens seguidas
const BATCH_QUIET_MS = 4000;
// Mensagens do cliente com até esse intervalo contam como uma sequência
const BURST_WINDOW_MS = 15000;
const MAX_BATCH_MESSAGES = 20;
const UNRECOGNIZED_HANDOFF_TEXT = "Certo! Vou encaminhar sua mensagem para um de nossos atendentes. Aguarde um momento, por favor.";
function logStep(step, meta) {
  console.log(`[bot-engine] ${step}`, meta ? JSON.stringify(meta, null, 2) : "");
}
serve(async (req)=>{
  try {
    if (req.method !== "POST") {
      return json(405, {
        error: "Method not allowed"
      });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, {
        error: "Missing Supabase env"
      });
    }
    const providedSecret = req.headers.get("x-internal-secret") ?? "";
    if (!INTERNAL_BOT_SECRET || !timingSafeEqual(providedSecret, INTERNAL_BOT_SECRET)) {
      return json(401, {
        error: "Unauthorized"
      });
    }
    const body = await req.json();
    if (!body?.clinicId || !body?.channelConnectionId || !body?.conversationId || !body?.messageId) {
      return json(400, {
        error: "Missing required payload fields"
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const inboundMessage = await getMessageById(supabase, body.messageId, body.conversationId);
    if (!inboundMessage) {
      return json(404, {
        error: "Inbound message not found"
      });
    }
    if (inboundMessage.direction !== DIRECTION_INBOUND) {
      return json(400, {
        error: "messageId is not inbound"
      });
    }
    const conversation = await getConversation(supabase, body.clinicId, body.conversationId);
    if (!conversation) {
      return json(404, {
        error: "Conversation not found"
      });
    }
    if (conversation.channel !== CHANNEL_WHATSAPP) {
      return json(200, {
        ok: true,
        skipped: "channel_not_supported"
      });
    }
    if (conversation.channel_connection_id && conversation.channel_connection_id !== body.channelConnectionId) {
      return json(400, {
        error: "channelConnectionId does not match conversation"
      });
    }
    const contact = await getContact(supabase, conversation.contact_id);
    if (!contact?.phone) {
      return json(400, {
        error: "Contact phone not found"
      });
    }
    const channelConnection = await getChannelConnection(supabase, body.clinicId, body.channelConnectionId);
    if (!channelConnection) {
      return json(404, {
        error: "Channel connection not found"
      });
    }
    // Plano sem bots (ex.: rebaixado): o bot antigo para de responder
    if (!await clinicHasFeature(supabase, body.clinicId, "bots")) {
      await revealConversation(supabase, body.conversationId);
      return json(200, {
        ok: true,
        skipped: "plan_without_bots"
      });
    }
    const binding = await getActiveBinding(supabase, body.clinicId, body.channelConnectionId);
    if (!binding) {
      await revealConversation(supabase, body.conversationId);
      return json(200, {
        ok: true,
        skipped: "no_active_binding"
      });
    }
    const bot = await getBot(supabase, body.clinicId, binding.bot_id);
    if (!bot) {
      await revealConversation(supabase, body.conversationId);
      return json(200, {
        ok: true,
        skipped: "bot_not_found"
      });
    }
    if (bot.status !== "active") {
      await revealConversation(supabase, body.conversationId);
      return json(200, {
        ok: true,
        skipped: "bot_not_active"
      });
    }
    const isInteractiveMessage = body.messageType === MESSAGE_TYPE_INTERACTIVE;
    const selectionCandidates = [
      body.interactive?.selectedId,
      body.interactive?.selectedTitle,
      body.text,
      inboundMessage.text
    ].map((value)=>String(value ?? "").trim()).filter(Boolean);
    const selectedOptionValue = String(body.interactive?.selectedId ?? body.interactive?.selectedTitle ?? body.text ?? inboundMessage.text ?? "").trim();
    const inboundCount = await getInboundCount(supabase, body.conversationId);
    // Falha na contagem (null) não pode ser lida como "primeira mensagem"
    const isFirstInbound = inboundCount !== null && inboundCount <= 1;
    const reopenedFromClosed = body.reopenedFromClosed === true;
    let activeSession = await getActiveSession(supabase, body.conversationId, bot.id, body.channelConnectionId);
    if (activeSession && isSessionExpired(activeSession, bot)) {
      await insertBotEvent(supabase, {
        clinicId: body.clinicId,
        conversationId: body.conversationId,
        botId: bot.id,
        conversationBotSessionId: activeSession.id,
        nodeId: activeSession.current_node_id,
        eventType: "session_completed",
        payload: {
          reason: "timeout"
        }
      });
      await finishSession({
        supabase,
        sessionId: activeSession.id,
        status: SESSION_STATUS_EXPIRED,
        endedReason: "timeout"
      });
      await insertConversationEvent(supabase, body.conversationId, "bot_session_ended", {
        bot_id: bot.id,
        conversation_bot_session_id: activeSession.id,
        reason: "timeout"
      });
      activeSession = null;
    }
    // Um atendente assumiu a conversa: o bot sai de cena em vez de responder
    // "opção inválida" para o que o cliente escreve ao humano.
    if (conversation.status === STATUS_OPEN) {
      if (activeSession) {
        await insertBotEvent(supabase, {
          clinicId: body.clinicId,
          conversationId: body.conversationId,
          botId: bot.id,
          conversationBotSessionId: activeSession.id,
          nodeId: activeSession.current_node_id,
          eventType: "session_cancelled",
          payload: {
            reason: "human_reply"
          }
        });
        await finishSession({
          supabase,
          sessionId: activeSession.id,
          status: SESSION_STATUS_CANCELLED,
          endedReason: "human_reply"
        });
      }
      await revealConversation(supabase, body.conversationId);
      return json(200, {
        ok: true,
        skipped: "human_attending"
      });
    }
    const shouldResetSessionOnReopen = reopenedFromClosed && activeSession && !isInteractiveMessage;
    if (shouldResetSessionOnReopen) {
      logStep("resetting_session_on_reopen", {
        conversationId: body.conversationId,
        previousSessionId: activeSession.id,
        reopenedFromClosed
      });
      await insertBotEvent(supabase, {
        clinicId: body.clinicId,
        conversationId: body.conversationId,
        botId: bot.id,
        conversationBotSessionId: activeSession.id,
        nodeId: activeSession.current_node_id,
        eventType: "session_cancelled",
        payload: {
          reason: "manual_stop",
          cause: "conversation_reopened",
          previous_session_id: activeSession.id
        }
      });
      await endActiveSessionsForConversation({
        supabase,
        conversationId: body.conversationId,
        botId: bot.id,
        channelConnectionId: body.channelConnectionId,
        status: SESSION_STATUS_CANCELLED,
        endedReason: "manual_stop"
      });
      activeSession = null;
    }
    const shouldStart = !activeSession && binding.trigger_type === "first_inbound" && (isFirstInbound || reopenedFromClosed);
    logStep("flow_context", {
      inboundCount,
      isFirstInbound,
      reopenedFromClosed,
      isInteractiveMessage,
      hasActiveSession: !!activeSession,
      shouldStart,
      messageType: body.messageType
    });
    if (shouldStart) {
      const rootNode = await getRootNode(supabase, body.clinicId, bot.id);
      if (!rootNode) {
        await revealConversation(supabase, body.conversationId);
        return json(200, {
          ok: true,
          skipped: "root_node_not_found"
        });
      }
      activeSession = await createSession({
        supabase,
        clinicId: body.clinicId,
        conversationId: body.conversationId,
        botId: bot.id,
        channelConnectionId: body.channelConnectionId,
        currentNodeId: rootNode.id
      });
      await hideConversationWhileBotAnswers(supabase, body.conversationId);
      await insertBotEvent(supabase, {
        clinicId: body.clinicId,
        conversationId: body.conversationId,
        botId: bot.id,
        conversationBotSessionId: activeSession.id,
        nodeId: rootNode.id,
        eventType: "session_started",
        payload: {
          trigger_type: binding.trigger_type,
          reopened_from_closed: reopenedFromClosed
        }
      });
      if (bot.start_message?.trim()) {
        await sendBotText({
          supabase,
          clinicId: body.clinicId,
          channelConnectionId: body.channelConnectionId,
          conversationId: body.conversationId,
          channelConnection,
          bot,
          text: bot.start_message.trim(),
          session: activeSession,
          nodeContext: {
            nodeId: rootNode.id,
            nodeKey: rootNode.node_key,
            nodeType: "start_message"
          }
        });
      }
      await executeNode({
        supabase,
        clinicId: body.clinicId,
        conversationId: body.conversationId,
        channelConnectionId: body.channelConnectionId,
        bot,
        contact,
        channelConnection,
        session: activeSession,
        node: rootNode
      });
      return json(200, {
        ok: true,
        action: "session_started"
      });
    }
    // Cliente mandou várias mensagens de uma vez no começo da conversa: a
    // primeira pode estar abrindo a sessão agora mesmo. Espera um pouco antes
    // de concluir que não há bot.
    const mayBeStartingSession = inboundCount !== null && inboundCount <= 5;
    if (!activeSession && !isInteractiveMessage && mayBeStartingSession && await hasRecentInbound(supabase, body.conversationId, inboundMessage)) {
      await sleep(3000);
      activeSession = await getActiveSession(supabase, body.conversationId, bot.id, body.channelConnectionId);
    }
    if (!activeSession) {
      await revealConversation(supabase, body.conversationId);
      return json(200, {
        ok: true,
        skipped: "no_active_session"
      });
    }
    const currentNode = activeSession.current_node_id ? await getNodeById(supabase, body.clinicId, activeSession.current_node_id) : null;
    if (!currentNode) {
      await revealConversation(supabase, body.conversationId);
      return json(200, {
        ok: true,
        skipped: "session_current_node_not_found"
      });
    }
    await touchSession(supabase, activeSession.id);
    if (currentNode.node_type !== "menu") {
      await revealConversation(supabase, body.conversationId);
      return json(200, {
        ok: true,
        skipped: "current_node_not_menu"
      });
    }
    // Mensagens do cliente que o bot vai responder agora. Clique em lista/botão
    // é resposta explícita: segue na hora. Texto e mídia esperam alguns
    // segundos para juntar as mensagens seguidas numa resposta só.
    let pendingInputs = [
      {
        type: inboundMessage.type ?? body.messageType,
        text: inboundMessage.text,
        candidates: selectionCandidates
      }
    ];
    if (isInteractiveMessage) {
      // Marca como respondida para não voltar a contar no próximo menu
      await claimInboundForSession(supabase, activeSession.id, inboundMessage.created_at);
    } else {
      const batch = await collectCustomerBatch({
        supabase,
        conversationId: body.conversationId,
        session: activeSession,
        inboundMessage
      });
      if (batch.skipped) {
        logStep("inbound_skipped", {
          conversationId: body.conversationId,
          messageId: inboundMessage.id,
          reason: batch.skipped
        });
        return json(200, {
          ok: true,
          skipped: batch.skipped
        });
      }
      pendingInputs = batch.messages.map((msg)=>({
          type: msg.type,
          text: msg.text,
          candidates: msg.id === inboundMessage.id ? selectionCandidates : [
            String(msg.text ?? "").trim()
          ].filter(Boolean)
        }));
    }
    const options = await getOptionsByNodeId(supabase, currentNode.id);
    // A mensagem mais recente que bater com uma opção é a escolha do cliente
    let selectedOption = null;
    let selectedRawInput = selectedOptionValue;
    for (const input of [
      ...pendingInputs
    ].reverse()){
      const match = findOptionForCandidates(options, input.candidates);
      if (match) {
        selectedOption = match;
        selectedRawInput = input.candidates[0] ?? selectedOptionValue;
        break;
      }
    }
    if (!selectedOption) {
      const rawInput = pendingInputs.map((input)=>String(input.text ?? "").trim() || `[${input.type ?? "mensagem"}]`).join(" | ");
      const unmatchedKind = classifyUnmatchedInput(pendingInputs);
      // Áudio, foto, documento ou uma frase de verdade: quem resolve é uma
      // pessoa. Responder "Não entendi" aqui só irrita o cliente.
      if (unmatchedKind !== "invalid" && bot.human_handoff_enabled !== false) {
        await handoffUnrecognizedInput({
          supabase,
          clinicId: body.clinicId,
          conversationId: body.conversationId,
          channelConnectionId: body.channelConnectionId,
          bot,
          channelConnection,
          session: activeSession,
          node: currentNode,
          reason: unmatchedKind,
          rawInput
        });
        return json(200, {
          ok: true,
          action: "handoff_unrecognized_input",
          reason: unmatchedKind
        });
      }
      await handleInvalidOption({
        supabase,
        clinicId: body.clinicId,
        conversationId: body.conversationId,
        channelConnectionId: body.channelConnectionId,
        bot,
        channelConnection,
        session: activeSession,
        node: currentNode,
        rawInput
      });
      return json(200, {
        ok: true,
        action: "invalid_option"
      });
    }
    await insertBotEvent(supabase, {
      clinicId: body.clinicId,
      conversationId: body.conversationId,
      botId: bot.id,
      conversationBotSessionId: activeSession.id,
      nodeId: currentNode.id,
      optionId: selectedOption.id,
      eventType: "option_selected",
      payload: {
        option_value: selectedOption.option_value,
        option_label: selectedOption.label,
        raw_input: selectedRawInput,
        interactive: body.interactive ?? null
      }
    });
    await processSelectedOption({
      supabase,
      clinicId: body.clinicId,
      conversationId: body.conversationId,
      channelConnectionId: body.channelConnectionId,
      bot,
      contact,
      channelConnection,
      session: activeSession,
      currentNode,
      option: selectedOption
    });
    return json(200, {
      ok: true,
      action: "option_processed"
    });
  } catch (err) {
    console.error("bot-engine unexpected error:", err);
    return json(500, {
      error: "Internal error"
    });
  }
});
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
function normalizeOptionValue(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
function findOptionForCandidates(options, candidates) {
  return options.find((opt)=>{
    const optionValueNormalized = normalizeOptionValue(opt.option_value);
    const labelNormalized = normalizeOptionValue(opt.label);
    return candidates.some((candidate)=>{
      const normalizedCandidate = normalizeOptionValue(candidate);
      return normalizedCandidate === optionValueNormalized || normalizedCandidate === labelNormalized;
    });
  }) ?? null;
}
function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
}
// ---------------------------------------------------------------------------
// Mensagens seguidas do cliente
// ---------------------------------------------------------------------------
async function hasRecentInbound(supabase, conversationId, inboundMessage) {
  const createdAt = new Date(inboundMessage.created_at).getTime();
  if (!Number.isFinite(createdAt)) return false;
  const { data, error } = await supabase.from("messages").select("id").eq("conversation_id", conversationId).eq("direction", DIRECTION_INBOUND).neq("id", inboundMessage.id).lte("created_at", inboundMessage.created_at).gte("created_at", new Date(createdAt - BURST_WINDOW_MS).toISOString()).limit(1);
  if (error) {
    console.error("hasRecentInbound error:", error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
/**
 * Junta as mensagens do cliente que o bot ainda não respondeu nesta sessão.
 *
 * - Mensagem escrita antes de o menu sair não é resposta ao menu: ignora.
 * - Espera BATCH_QUIET_MS; se chegou mensagem mais nova, ela responde por todas.
 * - A trava (last_handled_inbound_at) impede duas execuções de responderem
 *   às mesmas mensagens.
 *
 * Retorna { messages } com as mensagens a responder, ou { skipped: motivo }.
 */ async function collectCustomerBatch(params) {
  const { supabase, conversationId, session, inboundMessage } = params;
  const current = [
    {
      id: inboundMessage.id,
      type: inboundMessage.type,
      text: inboundMessage.text,
      created_at: inboundMessage.created_at
    }
  ];
  const messageAt = inboundMessage.created_at;
  // 1. O bot já tinha falado nesta sessão quando o cliente escreveu?
  const { data: firstBotMessage, error: firstBotErr } = await supabase.from("messages").select("created_at").eq("conversation_id", conversationId).eq("direction", DIRECTION_OUTBOUND).gte("created_at", session.started_at).lt("created_at", messageAt).order("created_at", {
    ascending: true
  }).limit(1).maybeSingle();
  if (firstBotErr) {
    console.error("collectCustomerBatch first bot message error:", firstBotErr);
    return {
      messages: current
    };
  }
  if (!firstBotMessage) {
    return {
      skipped: "sent_before_menu"
    };
  }
  // 2. Espera o cliente terminar de escrever
  await sleep(BATCH_QUIET_MS);
  const { data: newer, error: newerErr } = await supabase.from("messages").select("id").eq("conversation_id", conversationId).eq("direction", DIRECTION_INBOUND).gt("created_at", messageAt).limit(1);
  if (newerErr) {
    console.error("collectCustomerBatch newer message error:", newerErr);
  } else if ((newer?.length ?? 0) > 0) {
    return {
      skipped: "newer_message_pending"
    };
  }
  // 3. Trava
  const claim = await claimInboundForSession(supabase, session.id, messageAt);
  if (claim.skipped) {
    return {
      skipped: claim.skipped
    };
  }
  // 4. Mensagens ainda não respondidas, da mais antiga para a mais nova
  let query = supabase.from("messages").select("id, type, text, created_at").eq("conversation_id", conversationId).eq("direction", DIRECTION_INBOUND).gt("created_at", firstBotMessage.created_at).lte("created_at", messageAt);
  if (claim.previous) {
    query = query.gt("created_at", claim.previous);
  }
  const { data: rows, error: rowsErr } = await query.order("created_at", {
    ascending: true
  }).limit(MAX_BATCH_MESSAGES);
  if (rowsErr) {
    console.error("collectCustomerBatch batch error:", rowsErr);
    return {
      messages: current
    };
  }
  const messages = rows?.length ? rows : current;
  if (!messages.some((msg)=>msg.id === inboundMessage.id)) {
    messages.push(current[0]);
  }
  return {
    messages
  };
}
/**
 * Marca a mensagem como respondida (compare-and-swap em
 * last_handled_inbound_at). Retorna a marca anterior em { previous }, ou
 * { skipped } se outra execução já cuidou de uma mensagem igual ou mais nova.
 * Sem a coluna (migration não aplicada), segue sem trava.
 */ async function claimInboundForSession(supabase, sessionId, messageAt) {
  const messageTime = new Date(messageAt).getTime();
  for(let attempt = 0; attempt < 3; attempt++){
    const { data: row, error } = await supabase.from("conversation_bot_sessions").select("status, last_handled_inbound_at").eq("id", sessionId).maybeSingle();
    if (error) {
      console.warn("claimInboundForSession: seguindo sem trava", error.message);
      return {
        previous: null
      };
    }
    if (!row || row.status !== SESSION_STATUS_ACTIVE) {
      return {
        skipped: "session_not_active"
      };
    }
    const previous = row.last_handled_inbound_at ?? null;
    if (previous && new Date(previous).getTime() >= messageTime) {
      return {
        skipped: "already_handled"
      };
    }
    let update = supabase.from("conversation_bot_sessions").update({
      last_handled_inbound_at: messageAt
    }).eq("id", sessionId).eq("status", SESSION_STATUS_ACTIVE);
    update = previous ? update.eq("last_handled_inbound_at", previous) : update.is("last_handled_inbound_at", null);
    const { data: updated, error: updateErr } = await update.select("id");
    if (updateErr) {
      console.warn("claimInboundForSession: seguindo sem trava", updateErr.message);
      return {
        previous
      };
    }
    if ((updated?.length ?? 0) > 0) {
      return {
        previous
      };
    }
  }
  return {
    skipped: "claim_contention"
  };
}
function isSessionExpired(session, bot) {
  const configured = Number(bot.session_timeout_hours);
  const hours = Number.isFinite(configured) && configured >= 1 ? Math.min(configured, DEFAULT_SESSION_TIMEOUT_HOURS) : DEFAULT_SESSION_TIMEOUT_HOURS;
  const lastInteraction = new Date(session.last_interaction_at).getTime();
  if (!Number.isFinite(lastInteraction)) return false;
  return Date.now() - lastInteraction >= hours * 60 * 60 * 1000;
}
function truncateText(value, max) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max);
}
async function getMessageById(supabase, messageId, conversationId) {
  const { data, error } = await supabase.from("messages").select("id, conversation_id, direction, type, text, sent_at, created_at, is_automated, payload").eq("id", messageId).eq("conversation_id", conversationId).maybeSingle();
  if (error) {
    console.error("getMessageById error:", error);
    return null;
  }
  return data ?? null;
}
async function getInboundCount(supabase, conversationId) {
  const { count, error } = await supabase.from("messages").select("*", {
    count: "exact",
    head: true
  }).eq("conversation_id", conversationId).eq("direction", DIRECTION_INBOUND);
  if (error) {
    console.error("getInboundCount error:", error);
    return null;
  }
  return count ?? 0;
}
async function getConversation(supabase, clinicId, conversationId) {
  const { data, error } = await supabase.from("conversations").select("id, clinic_id, contact_id, channel, status, department_id, whatsapp_number_id, channel_connection_id, closed_at").eq("id", conversationId).eq("clinic_id", clinicId).maybeSingle();
  if (error) {
    console.error("getConversation error:", error);
    return null;
  }
  return data ?? null;
}
async function getContact(supabase, contactId) {
  const { data, error } = await supabase.from("contacts").select("id, phone, name").eq("id", contactId).maybeSingle();
  if (error) {
    console.error("getContact error:", error);
    return null;
  }
  return data ?? null;
}
async function getChannelConnection(supabase, clinicId, channelConnectionId) {
  const { data, error } = await supabase.from("channel_connections").select("id, clinic_id, provider, channel, meta_phone_number_id, access_token").eq("id", channelConnectionId).eq("clinic_id", clinicId).maybeSingle();
  if (error) {
    console.error("getChannelConnection error:", error);
    return null;
  }
  return data ?? null;
}
async function getActiveBinding(supabase, clinicId, channelConnectionId) {
  const { data, error } = await supabase.from("bot_channel_bindings").select("id, clinic_id, bot_id, channel_connection_id, enabled, trigger_type").eq("clinic_id", clinicId).eq("channel_connection_id", channelConnectionId).eq("enabled", true).maybeSingle();
  if (error) {
    console.error("getActiveBinding error:", error);
    return null;
  }
  return data;
}
async function getBot(supabase, clinicId, botId) {
  const { data, error } = await supabase.from("bots").select("id, clinic_id, name, status, published, invalid_option_message, start_message, timeout_message, session_timeout_hours, human_handoff_enabled, max_invalid_attempts").eq("id", botId).eq("clinic_id", clinicId).eq("is_deleted", false).maybeSingle();
  if (error) {
    console.error("getBot error:", error);
    return null;
  }
  return data ?? null;
}
async function getRootNode(supabase, clinicId, botId) {
  const { data, error } = await supabase.from("bot_nodes").select("id, bot_id, clinic_id, node_key, title, message, node_type, sort_order").eq("clinic_id", clinicId).eq("bot_id", botId).eq("node_key", "root").maybeSingle();
  if (error) {
    console.error("getRootNode error:", error);
    return null;
  }
  return data ?? null;
}
async function getNodeById(supabase, clinicId, nodeId) {
  const { data, error } = await supabase.from("bot_nodes").select("id, bot_id, clinic_id, node_key, title, message, node_type, sort_order").eq("clinic_id", clinicId).eq("id", nodeId).maybeSingle();
  if (error) {
    console.error("getNodeById error:", error);
    return null;
  }
  return data ?? null;
}
async function getOptionsByNodeId(supabase, nodeId) {
  const { data, error } = await supabase.from("bot_options").select("id, bot_node_id, clinic_id, option_value, label, action_type, next_node_id, target_department_id, tag_id, message_to_send, end_session, sort_order").eq("bot_node_id", nodeId).order("sort_order", {
    ascending: true
  });
  if (error) {
    console.error("getOptionsByNodeId error:", error);
    return [];
  }
  return data ?? [];
}
async function getActiveSession(supabase, conversationId, botId, channelConnectionId) {
  const { data, error } = await supabase.from("conversation_bot_sessions").select("id, clinic_id, conversation_id, bot_id, channel_connection_id, current_node_id, status, invalid_attempts_count, started_at, last_interaction_at, completed_at, ended_reason").eq("conversation_id", conversationId).eq("bot_id", botId).eq("channel_connection_id", channelConnectionId).eq("status", SESSION_STATUS_ACTIVE).order("started_at", {
    ascending: false
  }).limit(1).maybeSingle();
  if (error) {
    console.error("getActiveSession error:", error);
    return null;
  }
  return data ?? null;
}
async function createSession(params) {
  const now = new Date().toISOString();
  const { data, error } = await params.supabase.from("conversation_bot_sessions").insert({
    clinic_id: params.clinicId,
    conversation_id: params.conversationId,
    bot_id: params.botId,
    channel_connection_id: params.channelConnectionId,
    current_node_id: params.currentNodeId,
    status: SESSION_STATUS_ACTIVE,
    invalid_attempts_count: 0,
    started_at: now,
    last_interaction_at: now,
    updated_at: now
  }).select("id, clinic_id, conversation_id, bot_id, channel_connection_id, current_node_id, status, invalid_attempts_count, started_at, last_interaction_at, completed_at, ended_reason").maybeSingle();
  if (error || !data) {
    throw new Error(`createSession failed: ${error?.message ?? "unknown"}`);
  }
  return data;
}
async function updateSessionNode(supabase, sessionId, nodeId) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("conversation_bot_sessions").update({
    current_node_id: nodeId,
    last_interaction_at: now,
    updated_at: now
  }).eq("id", sessionId);
  if (error) {
    console.error("updateSessionNode error:", error);
  }
}
async function touchSession(supabase, sessionId) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("conversation_bot_sessions").update({
    last_interaction_at: now,
    updated_at: now
  }).eq("id", sessionId);
  if (error) {
    console.error("touchSession error:", error);
  }
}
async function incrementInvalidAttempts(supabase, session) {
  const nextCount = (session.invalid_attempts_count ?? 0) + 1;
  const now = new Date().toISOString();
  const { error } = await supabase.from("conversation_bot_sessions").update({
    invalid_attempts_count: nextCount,
    last_interaction_at: now,
    updated_at: now
  }).eq("id", session.id);
  if (error) {
    console.error("incrementInvalidAttempts error:", error);
  }
  return nextCount;
}
async function resetInvalidAttempts(supabase, sessionId) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("conversation_bot_sessions").update({
    invalid_attempts_count: 0,
    last_interaction_at: now,
    updated_at: now
  }).eq("id", sessionId);
  if (error) {
    console.error("resetInvalidAttempts error:", error);
  }
}
async function finishSession(params) {
  const now = new Date().toISOString();
  const { error } = await params.supabase.from("conversation_bot_sessions").update({
    status: params.status ?? SESSION_STATUS_COMPLETED,
    completed_at: now,
    ended_reason: params.endedReason ?? null,
    current_node_id: null,
    last_interaction_at: now,
    updated_at: now
  }).eq("id", params.sessionId);
  if (error) {
    console.error("finishSession error:", error);
  }
}
async function endActiveSessionsForConversation(params) {
  const now = new Date().toISOString();
  const { error } = await params.supabase.from("conversation_bot_sessions").update({
    status: params.status,
    completed_at: now,
    ended_reason: params.endedReason,
    current_node_id: null,
    last_interaction_at: now,
    updated_at: now
  }).eq("conversation_id", params.conversationId).eq("bot_id", params.botId).eq("channel_connection_id", params.channelConnectionId).eq("status", SESSION_STATUS_ACTIVE);
  if (error) {
    console.error("endActiveSessionsForConversation error:", error);
  }
}
async function insertBotEvent(supabase, params) {
  const { error } = await supabase.from("conversation_bot_events").insert({
    clinic_id: params.clinicId,
    conversation_bot_session_id: params.conversationBotSessionId,
    conversation_id: params.conversationId,
    bot_id: params.botId,
    node_id: params.nodeId ?? null,
    option_id: params.optionId ?? null,
    event_type: params.eventType,
    payload: params.payload ?? {}
  });
  if (error) {
    console.error("insertBotEvent error:", error);
  }
}
function buildMenuText(node, options) {
  const parts = [];
  if (node.message?.trim()) {
    parts.push(node.message.trim());
  }
  if (options.length > 0) {
    parts.push(options.map((opt)=>`${opt.option_value} - ${opt.label}`).join("\n"));
  }
  return parts.join("\n\n").trim();
}
function buildInteractiveMenuPayload(node, options) {
  const validOptions = options.filter((opt)=>truncateText(opt.option_value, 200) && truncateText(opt.label, 24));
  if (!validOptions.length) return null;
  const bodyText = truncateText(node.message, 1024) || "Escolha uma opção:";
  const headerText = truncateText(node.title, 60);
  return {
    type: "list",
    bodyText,
    ...headerText ? {
      headerText
    } : {},
    buttonText: "Ver opções",
    sections: [
      {
        title: truncateText(node.title, 24) || "Opções",
        rows: validOptions.slice(0, 10).map((opt)=>({
            id: truncateText(opt.option_value, 200),
            title: truncateText(opt.label, 24)
          }))
      }
    ]
  };
}
async function executeNode(params) {
  const { supabase, clinicId, conversationId, channelConnectionId, bot, channelConnection, session, node } = params;
  await updateSessionNode(supabase, session.id, node.id);
  if (node.node_type === "menu") {
    const options = await getOptionsByNodeId(supabase, node.id);
    const interactivePayload = buildInteractiveMenuPayload(node, options);
    const fallbackText = buildMenuText(node, options);
    if (interactivePayload) {
      await sendBotInteractive({
        supabase,
        clinicId,
        channelConnectionId,
        conversationId,
        channelConnection,
        bot,
        session,
        interactive: interactivePayload,
        fallbackText,
        nodeContext: {
          nodeId: node.id,
          nodeKey: node.node_key,
          nodeType: node.node_type
        }
      });
    } else if (fallbackText) {
      await sendBotText({
        supabase,
        clinicId,
        channelConnectionId,
        conversationId,
        channelConnection,
        bot,
        text: fallbackText,
        session,
        nodeContext: {
          nodeId: node.id,
          nodeKey: node.node_key,
          nodeType: node.node_type
        }
      });
    }
    if (options.length === 0) {
      await finishSession({
        supabase,
        sessionId: session.id,
        status: SESSION_STATUS_COMPLETED,
        endedReason: "flow_end"
      });
      await insertBotEvent(supabase, {
        clinicId,
        conversationId,
        botId: bot.id,
        conversationBotSessionId: session.id,
        nodeId: node.id,
        eventType: "session_completed",
        payload: {
          reason: "flow_end",
          cause: "node_without_options"
        }
      });
      return {
        sessionFinished: true
      };
    }
    return;
  }
  if (node.message?.trim()) {
    await sendBotText({
      supabase,
      clinicId,
      channelConnectionId,
      conversationId,
      channelConnection,
      bot,
      text: node.message.trim(),
      session,
      nodeContext: {
        nodeId: node.id,
        nodeKey: node.node_key,
        nodeType: node.node_type
      }
    });
  }
  if (node.node_type === "handoff") {
    await handoffConversation(supabase, conversationId, null);
    await insertBotEvent(supabase, {
      clinicId,
      conversationId,
      botId: bot.id,
      conversationBotSessionId: session.id,
      nodeId: node.id,
      eventType: "human_handoff",
      payload: {}
    });
    await finishSession({
      supabase,
      sessionId: session.id,
      status: SESSION_STATUS_COMPLETED,
      endedReason: "handoff"
    });
    return;
  }
  if (node.node_type === "end") {
    await finishSession({
      supabase,
      sessionId: session.id,
      status: SESSION_STATUS_COMPLETED,
      endedReason: "flow_end"
    });
    await insertBotEvent(supabase, {
      clinicId,
      conversationId,
      botId: bot.id,
      conversationBotSessionId: session.id,
      nodeId: node.id,
      eventType: "session_completed",
      payload: {
        reason: "flow_end"
      }
    });
    return;
  }
}
/**
 * O cliente mandou mídia ou uma frase que não é opção do menu: encerra o bot
 * e coloca a conversa na fila dos atendentes, avisando o cliente.
 */ async function handoffUnrecognizedInput(params) {
  const { supabase, clinicId, conversationId, channelConnectionId, bot, channelConnection, session, node, reason, rawInput } = params;
  try {
    await sendBotText({
      supabase,
      clinicId,
      channelConnectionId,
      conversationId,
      channelConnection,
      bot,
      text: UNRECOGNIZED_HANDOFF_TEXT,
      session,
      nodeContext: {
        nodeId: node.id,
        nodeKey: node.node_key,
        nodeType: "handoff_message"
      }
    });
  } catch (err) {
    // Sem o aviso a conversa ainda precisa chegar a um atendente
    console.error("handoffUnrecognizedInput send error:", err);
  }
  await handoffConversation(supabase, conversationId, null);
  await insertConversationEvent(supabase, conversationId, "bot_handoff_to_human", {
    bot_id: bot.id,
    conversation_bot_session_id: session.id,
    reason: reason === "media" ? "media_received" : "free_text_received"
  });
  await insertBotEvent(supabase, {
    clinicId,
    conversationId,
    botId: bot.id,
    conversationBotSessionId: session.id,
    nodeId: node.id,
    eventType: "human_handoff",
    payload: {
      reason: reason === "media" ? "media_received" : "free_text_received",
      raw_input: rawInput
    }
  });
  await finishSession({
    supabase,
    sessionId: session.id,
    status: SESSION_STATUS_COMPLETED,
    endedReason: "handoff"
  });
  await insertBotEvent(supabase, {
    clinicId,
    conversationId,
    botId: bot.id,
    conversationBotSessionId: session.id,
    nodeId: node.id,
    eventType: "session_completed",
    payload: {
      reason: "handoff"
    }
  });
}
async function handleInvalidOption(params) {
  const { supabase, clinicId, conversationId, channelConnectionId, bot, channelConnection, session, node, rawInput } = params;
  const attempts = await incrementInvalidAttempts(supabase, session);
  await insertBotEvent(supabase, {
    clinicId,
    conversationId,
    botId: bot.id,
    conversationBotSessionId: session.id,
    nodeId: node.id,
    eventType: "invalid_option",
    payload: {
      raw_input: rawInput,
      invalid_attempts_count: attempts
    }
  });
  const invalidText = bot.invalid_option_message?.trim() || "Não entendi. Escolha uma opção válida.";
  await sendBotText({
    supabase,
    clinicId,
    channelConnectionId,
    conversationId,
    channelConnection,
    bot,
    text: invalidText,
    session,
    nodeContext: {
      nodeId: node.id,
      nodeKey: node.node_key,
      nodeType: node.node_type
    }
  });
  const maxInvalidAttempts = bot.max_invalid_attempts ?? 3;
  if (attempts >= maxInvalidAttempts) {
    await insertBotEvent(supabase, {
      clinicId,
      conversationId,
      botId: bot.id,
      conversationBotSessionId: session.id,
      nodeId: node.id,
      eventType: "session_completed",
      payload: {
        reason: "invalid_limit"
      }
    });
    await finishSession({
      supabase,
      sessionId: session.id,
      status: SESSION_STATUS_COMPLETED,
      endedReason: "invalid_limit"
    });
    await revealConversation(supabase, conversationId);
    return;
  }
  const options = await getOptionsByNodeId(supabase, node.id);
  const interactivePayload = buildInteractiveMenuPayload(node, options);
  const fallbackText = buildMenuText(node, options);
  if (interactivePayload) {
    await sendBotInteractive({
      supabase,
      clinicId,
      channelConnectionId,
      conversationId,
      channelConnection,
      bot,
      session,
      interactive: interactivePayload,
      fallbackText,
      nodeContext: {
        nodeId: node.id,
        nodeKey: node.node_key,
        nodeType: node.node_type
      }
    });
    return;
  }
  if (fallbackText) {
    await sendBotText({
      supabase,
      clinicId,
      channelConnectionId,
      conversationId,
      channelConnection,
      bot,
      text: fallbackText,
      session,
      nodeContext: {
        nodeId: node.id,
        nodeKey: node.node_key,
        nodeType: node.node_type
      }
    });
  }
}
async function processSelectedOption(params) {
  const { supabase, clinicId, conversationId, channelConnectionId, bot, contact, channelConnection, session, currentNode, option } = params;
  await resetInvalidAttempts(supabase, session.id);
  const actionResult = await executeOptionAction({
    supabase,
    clinicId,
    conversationId,
    channelConnectionId,
    bot,
    channelConnection,
    session,
    currentNode,
    option
  });
  if (option.next_node_id) {
    const nextNode = await getNodeById(supabase, clinicId, option.next_node_id);
    if (nextNode) {
      const nodeResult = await executeNode({
        supabase,
        clinicId,
        conversationId,
        channelConnectionId,
        bot,
        contact,
        channelConnection,
        session,
        node: nextNode
      });
      if (nodeResult?.sessionFinished) return;
    }
  }
  if (option.end_session) {
    const actionAlreadyHandledHumanFlow = option.action_type === "handoff_to_human" || option.action_type === "transfer_to_department" || option.action_type === "end_flow";
    if (!actionAlreadyHandledHumanFlow) {
      await handoffConversation(supabase, conversationId, null);
      await insertConversationEvent(supabase, conversationId, "bot_handoff_to_human", {
        bot_id: bot.id,
        conversation_bot_session_id: session.id,
        option_id: option.id,
        source_action_type: option.action_type,
        reason: "end_session"
      });
      await insertBotEvent(supabase, {
        clinicId,
        conversationId,
        botId: bot.id,
        conversationBotSessionId: session.id,
        nodeId: currentNode.id,
        optionId: option.id,
        eventType: "human_handoff",
        payload: {
          source_action_type: option.action_type,
          reason: "end_session"
        }
      });
    }
    await finishSession({
      supabase,
      sessionId: session.id,
      status: SESSION_STATUS_COMPLETED,
      endedReason: option.action_type === "end_flow" ? "flow_end" : "handoff"
    });
    await insertBotEvent(supabase, {
      clinicId,
      conversationId,
      botId: bot.id,
      conversationBotSessionId: session.id,
      nodeId: currentNode.id,
      optionId: option.id,
      eventType: "session_completed",
      payload: {
        reason: option.action_type === "end_flow" ? "flow_end" : "handoff"
      }
    });
    return;
  }
  if (actionResult?.shouldFinishSession) {
    await finishSession({
      supabase,
      sessionId: session.id,
      status: SESSION_STATUS_COMPLETED,
      endedReason: actionResult.endedReason ?? "flow_end"
    });
    await insertBotEvent(supabase, {
      clinicId,
      conversationId,
      botId: bot.id,
      conversationBotSessionId: session.id,
      nodeId: currentNode.id,
      optionId: option.id,
      eventType: "session_completed",
      payload: {
        reason: actionResult.endedReason ?? "flow_end"
      }
    });
  }
}
async function executeOptionAction(params) {
  const { supabase, clinicId, conversationId, channelConnectionId, bot, channelConnection, session, currentNode, option } = params;
  logStep("execute_option_action", {
    optionId: option.id,
    optionValue: option.option_value,
    optionLabel: option.label,
    actionType: option.action_type,
    nextNodeId: option.next_node_id,
    endSession: option.end_session,
    hasMessageToSend: !!option.message_to_send?.trim()
  });
  const optionMessage = option.message_to_send?.trim();
  if (optionMessage) {
    await sendBotText({
      supabase,
      clinicId,
      channelConnectionId,
      conversationId,
      channelConnection,
      bot,
      text: optionMessage,
      session,
      nodeContext: {
        nodeId: currentNode.id,
        nodeKey: currentNode.node_key,
        nodeType: "option_message"
      }
    });
  }
  if (option.action_type === "go_to_node" || option.action_type === "send_message") {
    return null;
  }
  if (option.action_type === "transfer_to_department") {
    const payload = {
      status: STATUS_PENDING,
      assigned_user_id: null,
      ...humanQueueFields(),
      updated_at: new Date().toISOString()
    };
    if (option.target_department_id) {
      payload.department_id = option.target_department_id;
    }
    const { error } = await supabase.from("conversations").update(payload).eq("id", conversationId);
    if (error) {
      console.error("transfer_to_department error:", error);
    }
    await insertConversationEvent(supabase, conversationId, "bot_transferred_to_department", {
      bot_id: bot.id,
      conversation_bot_session_id: session.id,
      option_id: option.id,
      target_department_id: option.target_department_id
    });
    await insertBotEvent(supabase, {
      clinicId,
      conversationId,
      botId: bot.id,
      conversationBotSessionId: session.id,
      nodeId: option.bot_node_id,
      optionId: option.id,
      eventType: "transferred",
      payload: {
        target_department_id: option.target_department_id
      }
    });
    return {
      shouldFinishSession: true,
      endedReason: "handoff"
    };
  }
  if (option.action_type === "add_tag") {
    if (option.tag_id) {
      const { error } = await supabase.from("conversation_tags").upsert({
        conversation_id: conversationId,
        tag_id: option.tag_id
      }, {
        onConflict: "conversation_id,tag_id"
      });
      if (error) {
        console.error("add_tag error:", error);
      }
    }
    await insertBotEvent(supabase, {
      clinicId,
      conversationId,
      botId: bot.id,
      conversationBotSessionId: session.id,
      nodeId: option.bot_node_id,
      optionId: option.id,
      eventType: "tag_added",
      payload: {
        tag_id: option.tag_id
      }
    });
    return null;
  }
  if (option.action_type === "handoff_to_human") {
    await handoffConversation(supabase, conversationId, option.target_department_id);
    await insertConversationEvent(supabase, conversationId, "bot_handoff_to_human", {
      bot_id: bot.id,
      conversation_bot_session_id: session.id,
      option_id: option.id,
      target_department_id: option.target_department_id
    });
    await insertBotEvent(supabase, {
      clinicId,
      conversationId,
      botId: bot.id,
      conversationBotSessionId: session.id,
      nodeId: option.bot_node_id,
      optionId: option.id,
      eventType: "human_handoff",
      payload: {
        target_department_id: option.target_department_id
      }
    });
    return {
      shouldFinishSession: true,
      endedReason: "handoff"
    };
  }
  if (option.action_type === "end_flow") {
    await insertConversationEvent(supabase, conversationId, "bot_flow_ended", {
      bot_id: bot.id,
      conversation_bot_session_id: session.id,
      option_id: option.id
    });
    return {
      shouldFinishSession: true,
      endedReason: "flow_end"
    };
  }
  return null;
}
// ---------------------------------------------------------------------------
// Fila dos atendentes
// ---------------------------------------------------------------------------
// Enquanto o bot conduz a conversa ela fica fora da lista "Pendentes"
// (conversations.in_bot_flow). Entra na fila quando o bot passa para uma
// pessoa, desiste, ou quando o cliente escreve e o bot não vai responder.
function humanQueueFields() {
  return {
    in_bot_flow: false,
    // o prazo de 1ª resposta conta a partir do momento em que cai na fila
    first_unanswered_inbound_at: new Date().toISOString(),
    sla_breached_at: null
  };
}
async function hideConversationWhileBotAnswers(supabase, conversationId) {
  const { error } = await supabase.from("conversations").update({
    in_bot_flow: true,
    updated_at: new Date().toISOString()
  }).eq("id", conversationId).eq("status", STATUS_PENDING);
  if (error) {
    console.error("hideConversationWhileBotAnswers error:", error);
  }
}
// Só altera quando a conversa estava com o bot (não gera evento à toa)
async function revealConversation(supabase, conversationId) {
  if (!conversationId) return;
  const { error } = await supabase.from("conversations").update({
    ...humanQueueFields(),
    updated_at: new Date().toISOString()
  }).eq("id", conversationId).eq("in_bot_flow", true);
  if (error) {
    console.error("revealConversation error:", error);
  }
}
async function handoffConversation(supabase, conversationId, departmentId) {
  const payload = {
    status: STATUS_PENDING,
    assigned_user_id: null,
    ...humanQueueFields(),
    updated_at: new Date().toISOString()
  };
  if (departmentId) {
    payload.department_id = departmentId;
  }
  const { error } = await supabase.from("conversations").update(payload).eq("id", conversationId);
  if (error) {
    console.error("handoffConversation error:", error);
  }
}
async function insertConversationEvent(supabase, conversationId, eventType, metadata) {
  const { error } = await supabase.from("conversation_events").insert({
    conversation_id: conversationId,
    event_type: eventType,
    performed_by: null,
    metadata
  });
  if (error) {
    console.error("insertConversationEvent error:", error);
  }
}
async function sendBotText(params) {
  const { supabase, clinicId, channelConnectionId, conversationId, channelConnection, bot, text, session, nodeContext } = params;
  logStep("send_bot_text_start", {
    clinicId,
    channelConnectionId,
    conversationId,
    nodeContext
  });
  const senderResult = await callBotSenderWhatsApp({
    clinicId,
    channelConnectionId,
    conversationId,
    type: "text",
    text
  });
  const providerMessageId = senderResult.providerMessageId ?? senderResult.data?.providerMessageId ?? null;
  const sentAt = new Date().toISOString();
  const { error: msgErr } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    meta_message_id: providerMessageId,
    direction: DIRECTION_OUTBOUND,
    type: MESSAGE_TYPE_TEXT,
    sender: channelConnection.meta_phone_number_id,
    text,
    payload: {
      provider: channelConnection.provider ?? "meta",
      source: "bot-engine",
      author_type: "bot",
      author_name: bot.name,
      bot: {
        bot_id: bot.id,
        bot_name: bot.name,
        conversation_bot_session_id: session.id,
        node_id: nodeContext.nodeId,
        node_key: nodeContext.nodeKey,
        node_type: nodeContext.nodeType
      }
    },
    sent_at: sentAt,
    is_automated: true
  });
  if (msgErr) {
    throw new Error(`Outbound message insert failed: ${msgErr.message}`);
  }
  const { error: convErr } = await supabase.from("conversations").update({
    last_message_at: sentAt,
    last_outbound_at: sentAt,
    updated_at: sentAt,
    closed_at: null
  }).eq("id", conversationId).eq("clinic_id", clinicId);
  if (convErr) {
    console.error("Conversation update after bot send error:", convErr);
  }
  await insertBotEvent(supabase, {
    clinicId,
    conversationId,
    botId: bot.id,
    conversationBotSessionId: session.id,
    nodeId: nodeContext.nodeId,
    eventType: "message_sent",
    payload: {
      node_key: nodeContext.nodeKey,
      node_type: nodeContext.nodeType,
      message_type: "text"
    }
  });
  await touchSession(supabase, session.id);
  logStep("send_bot_text_done", {
    conversationId,
    providerMessageId
  });
}
async function sendBotInteractive(params) {
  const { supabase, clinicId, channelConnectionId, conversationId, channelConnection, bot, session, interactive, fallbackText, nodeContext } = params;
  logStep("send_bot_interactive_start", {
    clinicId,
    channelConnectionId,
    conversationId,
    interactiveType: interactive.type,
    nodeContext
  });
  const senderResult = await callBotSenderWhatsApp({
    clinicId,
    channelConnectionId,
    conversationId,
    type: "interactive",
    interactive,
    text: fallbackText
  });
  const providerMessageId = senderResult.providerMessageId ?? senderResult.data?.providerMessageId ?? null;
  const sentAt = new Date().toISOString();
  const { error: msgErr } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    meta_message_id: providerMessageId,
    direction: DIRECTION_OUTBOUND,
    type: MESSAGE_TYPE_INTERACTIVE,
    sender: channelConnection.meta_phone_number_id,
    text: fallbackText,
    payload: {
      provider: channelConnection.provider ?? "meta",
      source: "bot-engine",
      author_type: "bot",
      author_name: bot.name,
      interactive,
      bot: {
        bot_id: bot.id,
        bot_name: bot.name,
        conversation_bot_session_id: session.id,
        node_id: nodeContext.nodeId,
        node_key: nodeContext.nodeKey,
        node_type: nodeContext.nodeType
      }
    },
    sent_at: sentAt,
    is_automated: true
  });
  if (msgErr) {
    throw new Error(`Outbound interactive insert failed: ${msgErr.message}`);
  }
  const { error: convErr } = await supabase.from("conversations").update({
    last_message_at: sentAt,
    last_outbound_at: sentAt,
    updated_at: sentAt,
    closed_at: null
  }).eq("id", conversationId).eq("clinic_id", clinicId);
  if (convErr) {
    console.error("Conversation update after bot interactive send error:", convErr);
  }
  await insertBotEvent(supabase, {
    clinicId,
    conversationId,
    botId: bot.id,
    conversationBotSessionId: session.id,
    nodeId: nodeContext.nodeId,
    eventType: "message_sent",
    payload: {
      node_key: nodeContext.nodeKey,
      node_type: nodeContext.nodeType,
      message_type: "interactive",
      interactive_type: interactive.type
    }
  });
  await touchSession(supabase, session.id);
  logStep("send_bot_interactive_done", {
    conversationId,
    providerMessageId,
    interactiveType: interactive.type
  });
}
async function callBotSenderWhatsApp(params) {
  const url = `${SUPABASE_URL}/functions/v1/bot-sender-whatsapp`;
  const payload = params.type === "interactive" ? {
    clinicId: params.clinicId,
    channelConnectionId: params.channelConnectionId,
    conversationId: params.conversationId,
    type: "interactive",
    interactive: params.interactive,
    text: params.text
  } : {
    clinicId: params.clinicId,
    channelConnectionId: params.channelConnectionId,
    conversationId: params.conversationId,
    type: "text",
    text: params.text
  };
  logStep("calling_bot_sender_whatsapp", {
    url,
    type: params.type,
    clinicId: params.clinicId,
    channelConnectionId: params.channelConnectionId,
    conversationId: params.conversationId,
    hasText: !!params.text,
    interactiveType: params.interactive?.type ?? null
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": INTERNAL_BOT_SECRET
    },
    body: JSON.stringify(payload)
  });
  const rawText = await resp.text();
  logStep("bot_sender_whatsapp_response", {
    status: resp.status,
    ok: resp.ok
  });
  if (!resp.ok) {
    throw new Error(`bot-sender-whatsapp failed: ${resp.status} ${rawText}`);
  }
  try {
    return rawText ? JSON.parse(rawText) : {
      ok: true
    };
  } catch  {
    return {
      ok: true
    };
  }
}
