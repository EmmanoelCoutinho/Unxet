import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
    if (!INTERNAL_BOT_SECRET || providedSecret !== INTERNAL_BOT_SECRET) {
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
    logStep("inbound_payload_raw", {
      messageType: body.messageType,
      interactive: body.interactive,
      text: body.text,
      inboundMessageText: inboundMessage.text,
      inboundMessagePayload: inboundMessage.payload
    });
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
    const binding = await getActiveBinding(supabase, body.clinicId, body.channelConnectionId);
    if (!binding) {
      return json(200, {
        ok: true,
        skipped: "no_active_binding"
      });
    }
    const bot = await getBot(supabase, body.clinicId, binding.bot_id);
    if (!bot) {
      return json(200, {
        ok: true,
        skipped: "bot_not_found"
      });
    }
    if (bot.status !== "active") {
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
    logStep("selection_candidates", {
      isInteractiveMessage,
      messageType: body.messageType,
      interactive: body.interactive ?? null,
      bodyText: body.text ?? null,
      inboundMessageText: inboundMessage.text ?? null,
      selectionCandidates
    });
    const selectedOptionValue = String(body.interactive?.selectedId ?? body.interactive?.selectedTitle ?? body.text ?? inboundMessage.text ?? "").trim();
    const inboundCount = await getInboundCount(supabase, body.conversationId);
    const isFirstInbound = inboundCount <= 1;
    const reopenedFromClosed = body.reopenedFromClosed === true;
    let activeSession = await getActiveSession(supabase, body.conversationId, bot.id, body.channelConnectionId);
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
      selectedOptionValue,
      inboundCount,
      isFirstInbound,
      reopenedFromClosed,
      isInteractiveMessage,
      hasActiveSession: !!activeSession,
      shouldStart,
      messageType: body.messageType,
      interactive: body.interactive ?? null,
      inboundMessageText: inboundMessage.text ?? null
    });
    if (shouldStart) {
      const rootNode = await getRootNode(supabase, body.clinicId, bot.id);
      if (!rootNode) {
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
    if (!activeSession) {
      return json(200, {
        ok: true,
        skipped: "no_active_session"
      });
    }
    const currentNode = activeSession.current_node_id ? await getNodeById(supabase, body.clinicId, activeSession.current_node_id) : null;
    if (!currentNode) {
      return json(200, {
        ok: true,
        skipped: "session_current_node_not_found"
      });
    }
    await touchSession(supabase, activeSession.id);
    if (currentNode.node_type !== "menu") {
      return json(200, {
        ok: true,
        skipped: "current_node_not_menu"
      });
    }
    const options = await getOptionsByNodeId(supabase, currentNode.id);
    const normalizedSelectedValue = normalizeOptionValue(selectedOptionValue);
    logStep("option_matching_debug", {
      selectedOptionValue,
      normalizedSelectedValue,
      messageType: body.messageType,
      interactive: body.interactive ?? null,
      inboundMessageText: inboundMessage.text ?? null,
      options: options.map((opt)=>({
          id: opt.id,
          option_value: opt.option_value,
          label: opt.label,
          normalized_option_value: normalizeOptionValue(opt.option_value),
          normalized_label: normalizeOptionValue(opt.label),
          action_type: opt.action_type,
          next_node_id: opt.next_node_id,
          has_message_to_send: !!opt.message_to_send?.trim()
        }))
    });
    const selectedOption = options.find((opt)=>{
      const optionValueNormalized = normalizeOptionValue(opt.option_value);
      const labelNormalized = normalizeOptionValue(opt.label);
      return selectionCandidates.some((candidate)=>{
        const normalizedCandidate = normalizeOptionValue(candidate);
        return normalizedCandidate === optionValueNormalized || normalizedCandidate === labelNormalized;
      });
    });
    if (!selectedOption) {
      await handleInvalidOption({
        supabase,
        clinicId: body.clinicId,
        conversationId: body.conversationId,
        channelConnectionId: body.channelConnectionId,
        bot,
        channelConnection,
        session: activeSession,
        node: currentNode,
        rawInput: selectedOptionValue
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
        raw_input: selectedOptionValue,
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
      error: String(err)
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
function truncateText(value, max) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max);
}
async function getMessageById(supabase, messageId, conversationId) {
  const { data, error } = await supabase.from("messages").select("id, conversation_id, direction, text, sent_at, created_at, is_automated, payload").eq("id", messageId).eq("conversation_id", conversationId).maybeSingle();
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
    return 0;
  }
  return count ?? 0;
}
async function getConversation(supabase, clinicId, conversationId) {
  const { data, error } = await supabase.from("conversations").select("id, clinic_id, contact_id, channel, status, department_id, whatsapp_number_id, closed_at").eq("id", conversationId).eq("clinic_id", clinicId).maybeSingle();
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
  const { data, error } = await supabase.from("bots").select("id, clinic_id, name, status, published, invalid_option_message, start_message, timeout_message, human_handoff_enabled, max_invalid_attempts").eq("id", botId).eq("clinic_id", clinicId).eq("is_deleted", false).maybeSingle();
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
      await executeNode({
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
  if (option.action_type === "go_to_node") {
    return null;
  }
  if (option.action_type === "send_message") {
    const text = option.message_to_send?.trim();
    logStep("send_message_action_start", {
      optionId: option.id,
      optionValue: option.option_value,
      optionLabel: option.label,
      text
    });
    if (text) {
      await sendBotText({
        supabase,
        clinicId,
        channelConnectionId,
        conversationId,
        channelConnection,
        bot,
        text,
        session,
        nodeContext: {
          nodeId: currentNode.id,
          nodeKey: currentNode.node_key,
          nodeType: "option_message"
        }
      });
    }
    logStep("send_message_action_done", {
      optionId: option.id,
      textSent: text ?? null
    });
    return null;
  }
  if (option.action_type === "transfer_to_department") {
    const payload = {
      status: STATUS_PENDING,
      assigned_user_id: null,
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
    return null;
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
async function handoffConversation(supabase, conversationId, departmentId) {
  const payload = {
    status: STATUS_PENDING,
    assigned_user_id: null,
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
    text,
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
      provider: "meta",
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
    providerMessageId,
    text
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
    interactive
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
      provider: "meta",
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
    interactive: params.interactive
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
    ok: resp.ok,
    rawText
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
