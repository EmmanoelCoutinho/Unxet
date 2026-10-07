import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const META_WABA_TOKEN = Deno.env.get("META_WABA_TOKEN");
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret"
};
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTERNAL_BOT_SECRET) {
  console.error("❌ ENV faltando: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / INTERNAL_BOT_SECRET");
}
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// ─── Helpers ──────────────────────────────────────────────────────────────────
function safeStr(v) {
  if (v == null) return "";
  return String(v);
}
function internalSecretHeader(req) {
  return safeStr(req.headers.get("x-internal-secret")).trim();
}
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function truncateText(value, max) {
  const text = safeStr(value).trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max);
}
// ─── Resolve LID / número suspeito para telefone real via Evolution API ──────
async function resolvePhoneNumber(params) {
  const { evolutionApiUrl, evolutionApiKey, instanceName, rawNumber } = params;
  // Números reais brasileiros têm 10-13 dígitos (55 + DDD + número)
  // LIDs do WhatsApp têm tipicamente 14-15 dígitos
  const looksLikePhone = /^\d{10,13}$/.test(rawNumber);
  if (looksLikePhone) {
    return rawNumber;
  }
  console.log("[RESOLVE_PHONE] Número suspeito (possível LID), resolvendo:", rawNumber);
  try {
    const candidates = [
      `${rawNumber}@lid`,
      rawNumber
    ];
    for (const candidate of candidates){
      const resp = await fetch(`${evolutionApiUrl.replace(/\/$/, "")}/chat/whatsappNumbers/${instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: evolutionApiKey
        },
        body: JSON.stringify({
          numbers: [
            candidate
          ]
        })
      });
      if (!resp.ok) continue;
      const json = await resp.json();
      console.log("[RESOLVE_PHONE] Resposta whatsappNumbers:", JSON.stringify(json));
      const resolved = json?.[0]?.number ?? json?.[0]?.jid?.replace("@s.whatsapp.net", "").replace("@lid", "") ?? null;
      if (resolved && /^\d{10,13}$/.test(resolved.replace(/\D/g, ""))) {
        const clean = resolved.replace(/\D/g, "");
        console.log("[RESOLVE_PHONE] Resolvido com sucesso:", {
          rawNumber,
          resolved: clean
        });
        return clean;
      }
    }
    console.warn("[RESOLVE_PHONE] Não resolvido, usando original:", rawNumber);
  } catch (err) {
    console.error("[RESOLVE_PHONE] Erro:", err);
  }
  return rawNumber;
}
// ─── Meta: build interactive payload ─────────────────────────────────────────
function buildInteractiveMetaPayload(interactive) {
  if (interactive.type === "button") {
    const bodyText = truncateText(interactive.bodyText, 1024);
    const headerText = truncateText(interactive.headerText ?? "", 60);
    const footerText = truncateText(interactive.footerText ?? "", 60);
    const buttons = (interactive.buttons ?? []).filter((btn)=>safeStr(btn?.id).trim() && safeStr(btn?.title).trim()).slice(0, 3).map((btn)=>({
        type: "reply",
        reply: {
          id: truncateText(btn.id, 256),
          title: truncateText(btn.title, 20)
        }
      }));
    if (!bodyText) throw new Error("interactive.button.bodyText é obrigatório");
    if (!buttons.length) throw new Error("interactive.button precisa de pelo menos 1 botão");
    const payload = {
      type: "button",
      body: {
        text: bodyText
      },
      action: {
        buttons
      }
    };
    if (headerText) payload.header = {
      type: "text",
      text: headerText
    };
    if (footerText) payload.footer = {
      text: footerText
    };
    return payload;
  }
  // list
  const bodyText = truncateText(interactive.bodyText, 1024);
  const headerText = truncateText(interactive.headerText ?? "", 60);
  const footerText = truncateText(interactive.footerText ?? "", 60);
  const buttonText = truncateText(interactive.buttonText, 20);
  const sections = (interactive.sections ?? []).map((section)=>({
      title: truncateText(section.title, 24),
      rows: (section.rows ?? []).filter((row)=>safeStr(row?.id).trim() && safeStr(row?.title).trim()).slice(0, 10).map((row)=>({
          id: truncateText(row.id, 200),
          title: truncateText(row.title, 24),
          ...safeStr(row.description).trim() ? {
            description: truncateText(row.description ?? "", 72)
          } : {}
        }))
    })).filter((section)=>section.rows.length > 0).slice(0, 10);
  if (!bodyText) throw new Error("interactive.list.bodyText é obrigatório");
  if (!buttonText) throw new Error("interactive.list.buttonText é obrigatório");
  if (!sections.length) throw new Error("interactive.list precisa de ao menos 1 section com rows");
  const payload = {
    type: "list",
    body: {
      text: bodyText
    },
    action: {
      button: buttonText,
      sections
    }
  };
  if (headerText) payload.header = {
    type: "text",
    text: headerText
  };
  if (footerText) payload.footer = {
    text: footerText
  };
  return payload;
}
// ─── Meta: send ───────────────────────────────────────────────────────────────
async function sendMetaMessage(params) {
  const { rid, phoneNumberId, tokenToUse, waId, messageType, text, interactive } = params;
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  let metaPayload;
  if (messageType === "text") {
    metaPayload = {
      messaging_product: "whatsapp",
      to: waId,
      type: "text",
      text: {
        body: text || " "
      }
    };
  } else {
    metaPayload = {
      messaging_product: "whatsapp",
      to: waId,
      type: "interactive",
      interactive: buildInteractiveMetaPayload(interactive)
    };
  }
  console.log(JSON.stringify({
    rid,
    step: "meta.send.attempt",
    url,
    phoneNumberId,
    waId,
    payload: metaPayload
  }, null, 2));
  const metaResp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenToUse}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(metaPayload)
  });
  const metaBody = await metaResp.json().catch(()=>({}));
  console.log(JSON.stringify({
    rid,
    step: "meta.send.result",
    ok: metaResp.ok,
    status: metaResp.status,
    body: metaBody
  }, null, 2));
  if (!metaResp.ok) {
    console.error("❌ Erro Meta WhatsApp (bot outbound):", metaResp.status, metaBody);
    return {
      ok: false,
      providerMessageId: "",
      metaBody
    };
  }
  const providerMessageId = metaBody?.messages?.[0]?.id ?? `bot:${crypto.randomUUID()}`;
  return {
    ok: true,
    providerMessageId,
    metaBody
  };
}
// ─── Evolution: build payloads ────────────────────────────────────────────────
function buildEvolutionTextPayload(waId, text) {
  return {
    number: waId,
    text
  };
}
function buildEvolutionListPayload(waId, interactive) {
  const sections = (interactive.sections ?? []).map((section)=>({
      title: section.title,
      rows: (section.rows ?? []).map((row)=>({
          title: row.title,
          rowId: row.id,
          ...row.description ? {
            description: row.description
          } : {}
        }))
    }));
  return {
    number: waId,
    title: interactive.headerText ?? "",
    description: interactive.bodyText,
    buttonText: interactive.buttonText,
    footerText: interactive.footerText ?? "",
    sections
  };
}
// ─── Evolution: send ──────────────────────────────────────────────────────────
async function sendEvolutionMessage(params) {
  const { rid, apiUrl, apiKey, instanceName, waId, messageType, text, interactive } = params;
  const baseUrl = safeStr(apiUrl).replace(/\/$/, "");
  const endpoint = `${baseUrl}/message/sendText/${instanceName}`;
  let payload;
  if (messageType === "text") {
    payload = buildEvolutionTextPayload(waId, text);
  } else {
    // Evolution/Baileys tem suporte nativo instável para list/button
    // (erro conhecido: "this.isZero is not a function" no sendList e
    // sendButtons). Por isso, tanto list quanto button são enviados
    // como texto formatado, igual já era feito para button.
    let fullText;
    if (interactive?.type === "list") {
      const listInteractive = interactive;
      const lines = [];
      if (listInteractive.headerText) lines.push(`*${listInteractive.headerText}*`);
      if (listInteractive.bodyText) lines.push(listInteractive.bodyText);
      let counter = 1;
      const optionsMap = [];
      for (const section of listInteractive.sections ?? []){
        if (section.title) lines.push(`\n_${section.title}_`);
        for (const row of section.rows ?? []){
          lines.push(`${counter}. ${row.title}${row.description ? ` - ${row.description}` : ""}`);
          optionsMap.push(row.id);
          counter++;
        }
      }
      if (listInteractive.footerText) lines.push(`\n${listInteractive.footerText}`);
      fullText = lines.join("\n");
    } else {
      // button
      const btn = interactive;
      const optionsText = (btn?.buttons ?? []).map((b, i)=>`${i + 1}. ${b.title}`).join("\n");
      fullText = [
        btn?.bodyText,
        optionsText
      ].filter(Boolean).join("\n\n");
    }
    payload = buildEvolutionTextPayload(waId, fullText || text);
  }
  console.log(JSON.stringify({
    rid,
    step: "evolution.send.attempt",
    endpoint,
    instanceName,
    waId,
    messageType,
    fullPayload: payload
  }, null, 2));
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey
    },
    body: JSON.stringify(payload)
  });
  const responseBody = await resp.json().catch(()=>({}));
  console.log(JSON.stringify({
    rid,
    step: "evolution.send.result",
    ok: resp.ok,
    status: resp.status,
    body: responseBody
  }, null, 2));
  if (!resp.ok) {
    console.error("❌ Erro Evolution API (bot outbound):", resp.status, responseBody);
    return {
      ok: false,
      providerMessageId: "",
      responseBody
    };
  }
  const providerMessageId = responseBody?.key?.id ?? responseBody?.id ?? responseBody?.messageId ?? `bot:${crypto.randomUUID()}`;
  return {
    ok: true,
    providerMessageId,
    responseBody
  };
}
// ─── Main handler ─────────────────────────────────────────────────────────────
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
    const isInternalCall = !!INTERNAL_BOT_SECRET && internalSecret === INTERNAL_BOT_SECRET;
    console.log(JSON.stringify({
      rid,
      step: "auth.check",
      hasInternalSecretHeader: !!internalSecret,
      isInternalCall
    }, null, 2));
    if (!isInternalCall) {
      console.log(JSON.stringify({
        rid,
        step: "auth.invalid_internal_secret"
      }, null, 2));
      return jsonResponse(401, {
        error: "Unauthorized"
      });
    }
    const body = await req.json().catch(()=>({}));
    const clinicId = safeStr(body.clinicId).trim();
    const conversationId = safeStr(body.conversationId).trim();
    const channelConnectionId = safeStr(body.channelConnectionId).trim();
    const botId = safeStr(body.botId).trim() || null;
    const sessionId = safeStr(body.sessionId).trim() || null;
    const eventId = safeStr(body.eventId).trim() || null;
    const text = safeStr(body.text).trim();
    const messageType = safeStr(body.messageType || body.type || "text").trim();
    const interactive = body.interactive;
    const metadata = body.metadata ?? {};
    console.log(JSON.stringify({
      rid,
      step: "request.in",
      clinicId: clinicId || null,
      conversationId: conversationId || null,
      channelConnectionId: channelConnectionId || null,
      botId,
      sessionId,
      eventId,
      hasText: !!text,
      hasInteractive: !!interactive,
      messageType
    }, null, 2));
    if (!clinicId || !conversationId || !channelConnectionId) {
      return jsonResponse(400, {
        error: "clinicId, conversationId e channelConnectionId são obrigatórios"
      });
    }
    if (messageType === "text" && !text) {
      return jsonResponse(400, {
        error: "text é obrigatório quando o tipo for text"
      });
    }
    if (messageType === "interactive" && !interactive) {
      return jsonResponse(400, {
        error: "interactive é obrigatório quando o tipo for interactive"
      });
    }
    if (![
      "text",
      "interactive"
    ].includes(messageType)) {
      return jsonResponse(400, {
        error: "messageType/type inválido. Use text ou interactive"
      });
    }
    // ── 1. Conversation ───────────────────────────────────────────────────────
    const { data: conversation, error: convErr } = await supabaseAdmin.from("conversations").select("id, clinic_id, contact_id, whatsapp_number_id, channel_connection_id").eq("id", conversationId).maybeSingle();
    if (convErr || !conversation) {
      console.error("❌ Erro ao buscar conversa:", convErr);
      return jsonResponse(404, {
        error: "Conversa não encontrada"
      });
    }
    console.log(JSON.stringify({
      rid,
      step: "conversation.loaded",
      conversationId: conversation.id,
      clinicId: conversation.clinic_id,
      contactId: conversation.contact_id,
      whatsappNumberId: conversation.whatsapp_number_id ?? null,
      channelConnectionIdDb: conversation.channel_connection_id ?? null
    }, null, 2));
    if (safeStr(conversation.clinic_id) !== clinicId) {
      return jsonResponse(400, {
        error: "Conversa não pertence à clinicId informada"
      });
    }
    if (safeStr(conversation.channel_connection_id) && safeStr(conversation.channel_connection_id) !== channelConnectionId) {
      return jsonResponse(400, {
        error: "channelConnectionId não corresponde ao canal da conversa"
      });
    }
    // ── 2. Contact ────────────────────────────────────────────────────────────
    const { data: contact, error: contactErr } = await supabaseAdmin.from("contacts").select("id, phone").eq("id", conversation.contact_id).maybeSingle();
    if (contactErr || !contact) {
      console.error("❌ Erro ao buscar contato:", contactErr);
      return jsonResponse(404, {
        error: "Contato não encontrado"
      });
    }
    // Limpeza: remove tudo que não é dígito (+, espaços, -, (), etc.)
    // Isso evita o erro "this.isZero is not a function" do Baileys/Evolution
    // quando o número chega com caracteres não numéricos.
    const waId = safeStr(contact.phone).replace(/\D/g, "").trim();
    console.log(JSON.stringify({
      rid,
      step: "contact.loaded",
      contactId: contact.id,
      hasPhone: !!waId,
      rawPhone: contact.phone,
      waId
    }, null, 2));
    if (!waId) {
      return jsonResponse(400, {
        error: "Contato sem telefone para envio no WhatsApp"
      });
    }
    // ── 3. Channel connection (with provider fields) ───────────────────────────
    const { data: conn, error: connErr } = await supabaseAdmin.from("channel_connections").select("id, access_token, clinic_id, provider, channel, session_name, evolution_api_url, evolution_api_key").eq("id", channelConnectionId).maybeSingle();
    if (connErr) {
      console.error("❌ Erro ao buscar channel_connections:", connErr);
    }
    if (!conn || safeStr(conn.clinic_id) !== clinicId) {
      return jsonResponse(404, {
        error: "Canal WhatsApp não encontrado para a clínica"
      });
    }
    const provider = safeStr(conn.provider).trim() || "meta";
    console.log(JSON.stringify({
      rid,
      step: "channel_connection.loaded",
      connectionId: conn.id,
      provider,
      channel: conn.channel ?? null,
      instanceName: conn.session_name ?? null,
      apiUrl: conn.evolution_api_url ?? null,
      hasApiKey: !!conn.evolution_api_key,
      hasDbToken: !!safeStr(conn.access_token).trim()
    }, null, 2));
    // ── 4. Route by provider ──────────────────────────────────────────────────
    if (provider === "evolution") {
      const typedConn = conn;
      const apiUrl = safeStr(typedConn.evolution_api_url).trim();
      const apiKey = safeStr(typedConn.evolution_api_key).trim();
      const instanceName = safeStr(typedConn.session_name).trim();
      if (!apiUrl || !apiKey || !instanceName) {
        return jsonResponse(500, {
          error: "Evolution API não configurada corretamente (evolution_api_url, evolution_api_key, session_name obrigatórios)"
        });
      }
      // Resolve LID → telefone real, se necessário (mesmo comportamento da
      // edge de envio manual, que é 100% funcional)
      const resolvedWaId = await resolvePhoneNumber({
        evolutionApiUrl: apiUrl,
        evolutionApiKey: apiKey,
        instanceName,
        rawNumber: waId
      });
      console.log(JSON.stringify({
        rid,
        step: "evolution.phone.resolved",
        original: waId,
        resolved: resolvedWaId
      }, null, 2));
      if (!/^\d{10,13}$/.test(resolvedWaId)) {
        return jsonResponse(400, {
          error: "Não foi possível resolver o número do contato",
          rawNumber: waId,
          resolvedNumber: resolvedWaId
        });
      }
      let result;
      try {
        result = await sendEvolutionMessage({
          rid,
          apiUrl,
          apiKey,
          instanceName,
          waId: resolvedWaId,
          messageType,
          text,
          interactive
        });
      } catch (err) {
        console.error("❌ Erro inesperado no sendEvolutionMessage:", err);
        return jsonResponse(500, {
          error: "Erro interno ao enviar via Evolution"
        });
      }
      if (!result.ok) {
        return jsonResponse(502, {
          error: "Erro ao enviar mensagem para WhatsApp via Evolution",
          meta: result.responseBody
        });
      }
      // Atualiza o telefone do contato caso a resolução tenha mudado o número,
      // evitando reprocessar a resolução de LID nas próximas mensagens
      if (resolvedWaId !== waId) {
        const { error: updatePhoneErr } = await supabaseAdmin.from("contacts").update({
          phone: resolvedWaId
        }).eq("id", contact.id);
        if (updatePhoneErr) {
          console.error("❌ Erro ao atualizar telefone do contato:", updatePhoneErr);
        } else {
          console.log(JSON.stringify({
            rid,
            step: "contact.phone.updated",
            contactId: contact.id,
            oldPhone: waId,
            newPhone: resolvedWaId
          }, null, 2));
        }
      }
      console.log(JSON.stringify({
        rid,
        step: "done",
        provider: "evolution",
        conversationId: conversation.id,
        providerMessageId: result.providerMessageId,
        botId,
        sessionId,
        eventId,
        messageType,
        metadata
      }, null, 2));
      return jsonResponse(200, {
        ok: true,
        providerMessageId: result.providerMessageId,
        conversationId: conversation.id,
        channelConnectionId,
        messageType,
        meta: result.responseBody
      });
    }
    // ── 5. Meta flow (default) ────────────────────────────────────────────────
    const numberQuery = supabaseAdmin.from("whatsapp_numbers").select("id, meta_phone_number_id, clinic_id, channel_connection_id").eq("clinic_id", conversation.clinic_id).limit(1);
    const { data: waNumber, error: waNumberErr } = conversation.whatsapp_number_id ? await numberQuery.eq("id", conversation.whatsapp_number_id).maybeSingle() : await numberQuery.maybeSingle();
    if (waNumberErr || !waNumber) {
      console.error("❌ Erro ao buscar whatsapp_numbers para clinic_id:", conversation.clinic_id, waNumberErr);
      return jsonResponse(500, {
        error: "Número do WhatsApp não configurado para essa clínica"
      });
    }
    const phoneNumberId = safeStr(waNumber.meta_phone_number_id).trim();
    const waChannelConnectionId = safeStr(waNumber.channel_connection_id).trim() || null;
    console.log(JSON.stringify({
      rid,
      step: "whatsapp_number.loaded",
      whatsappNumberId: waNumber.id,
      phoneNumberId,
      waChannelConnectionId
    }, null, 2));
    if (!phoneNumberId) {
      return jsonResponse(500, {
        error: "meta_phone_number_id não configurado"
      });
    }
    if (waChannelConnectionId && waChannelConnectionId !== channelConnectionId) {
      return jsonResponse(400, {
        error: "channelConnectionId informado não corresponde ao número WhatsApp da conversa"
      });
    }
    let tokenToUse = safeStr(conn.access_token).trim();
    if (!tokenToUse) tokenToUse = safeStr(META_WABA_TOKEN).trim();
    console.log(JSON.stringify({
      rid,
      step: "meta.token.resolved",
      hasDbToken: !!safeStr(conn.access_token).trim(),
      usingEnvFallback: !safeStr(conn.access_token).trim(),
      hasTokenToUse: !!tokenToUse
    }, null, 2));
    if (!tokenToUse) {
      console.error("❌ Token do WhatsApp não configurado (db/env)");
      return jsonResponse(500, {
        error: "Token do WhatsApp não configurado"
      });
    }
    let metaResult;
    try {
      metaResult = await sendMetaMessage({
        rid,
        phoneNumberId,
        tokenToUse,
        waId,
        messageType,
        text,
        interactive
      });
    } catch (err) {
      return jsonResponse(400, {
        error: err instanceof Error ? err.message : "Payload interactive inválido"
      });
    }
    if (!metaResult.ok) {
      return jsonResponse(502, {
        error: "Erro ao enviar mensagem para WhatsApp",
        meta: metaResult.metaBody
      });
    }
    console.log(JSON.stringify({
      rid,
      step: "done",
      provider: "meta",
      conversationId: conversation.id,
      providerMessageId: metaResult.providerMessageId,
      botId,
      sessionId,
      eventId,
      messageType,
      metadata
    }, null, 2));
    return jsonResponse(200, {
      ok: true,
      providerMessageId: metaResult.providerMessageId,
      conversationId: conversation.id,
      channelConnectionId,
      messageType,
      meta: metaResult.metaBody
    });
  } catch (err) {
    console.error("❌ Erro inesperado em bot-sender-whatsapp:", err);
    return jsonResponse(500, {
      error: "Internal error"
    });
  }
});
