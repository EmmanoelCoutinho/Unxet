/**
 * evolution-in — Gateway da Evolution API (WhatsApp via QR Code)
 *
 * Responsabilidades:
 *  1. Filtrar apenas eventos "messages.upsert" do tipo inbound (não grupos, não reações)
 *  2. Resolver clinicId + channelConnectionId via session_name
 *  3. Normalizar todos os tipos de mensagem (text, image, audio, document, interactive)
 *  4. Buscar mídia via Evolution API (base64) e repassar para o shared
 *  5. Capturar profilePicUrl de forma assíncrona (fire-and-forget)
 *  6. Encaminhar o payload normalizado para shared-in-config
 *  7. Resolver LID para número real via Evolution API
 *  8. Gravar entrega/leitura das mensagens enviadas ("messages.update")
 *  9. Tirar o bot da conversa quando a equipe responde pelo celular (fromMe)
 *
 * Nenhuma lógica de negócio vive aqui.
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/security.ts";
import { applyMessageStatus } from "../_shared/messageStatus.ts";
import { redactWebhookSecrets, stripWebhookEventSuffix } from "../_shared/evolutionWebhook.ts";
import { connectionRejectionReason, rejectConnection } from "../_shared/evolutionLimit.ts";
// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SHARED_IN_CONFIG_URL = Deno.env.get("SHARED_IN_CONFIG_URL") ?? `${SUPABASE_URL}/functions/v1/shared-in-config`;
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";
const EVOLUTION_WEBHOOK_SECRET = Deno.env.get("EVOLUTION_WEBHOOK_SECRET") ?? "";
// Credenciais da conexão têm prioridade; estas valem para conexão sem elas
const EVOLUTION_API_URL_FALLBACK = Deno.env.get("EVOLUTION_API_URL") ?? "";
const EVOLUTION_API_KEY_FALLBACK = Deno.env.get("EVOLUTION_API_KEY") ?? "";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROFILE_PIC_BUCKET = "whatsapp-media";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Resolve um LID para o número de telefone real.
 *
 * Prioridade:
 *  1. remoteJidAlt — campo enviado pelo webhook da Evolution com o número real
 *  2. Endpoint /chat/whatsappNumbers — funciona em versões mais novas (>= 2.3.x)
 *
 * Retorna string vazia se não conseguir resolver, sinalizando ao caller
 * que a mensagem deve ser descartada em vez de salvar um LID como telefone.
 */ async function resolveWaId(params) {
  const { evolutionApiUrl, evolutionApiKey, instanceName, remoteJidRaw, remoteJidAlt, currentWaId } = params;
  const isLid = remoteJidRaw.endsWith("@lid");
  // Não é LID — retorna o waId atual sem alterar
  if (!isLid) {
    return currentWaId;
  }
  console.log("[LID_DETECTED]", JSON.stringify({
    remoteJidRaw,
    remoteJidAlt,
    currentWaId
  }));
  // ------------------------------------------------------------------
  // Prioridade 1: remoteJidAlt — número real vindo direto do webhook
  // ------------------------------------------------------------------
  if (remoteJidAlt && !remoteJidAlt.includes("@lid")) {
    const clean = remoteJidAlt.replace("@s.whatsapp.net", "").replace(/\D/g, "").trim();
    if (clean && /^\d{10,13}$/.test(clean)) {
      console.log("[LID_RESOLVED_VIA_ALT]", JSON.stringify({
        remoteJidRaw,
        resolved: clean
      }));
      return clean;
    }
  }
  // ------------------------------------------------------------------
  // Prioridade 2: endpoint /chat/whatsappNumbers (versões >= 2.3.x)
  // ------------------------------------------------------------------
  try {
    const resolveResp = await fetch(`${evolutionApiUrl.replace(/\/$/, "")}/chat/whatsappNumbers/${instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evolutionApiKey
      },
      body: JSON.stringify({
        numbers: [
          remoteJidRaw
        ]
      })
    });
    const resolveText = await resolveResp.text();
    console.log("[LID_RESOLVE_RAW]", resolveText);
    if (resolveResp.ok) {
      let resolveJson = null;
      try {
        resolveJson = JSON.parse(resolveText);
      } catch  {
        console.warn("[LID_RESOLVE_INVALID_JSON]");
      }
      if (resolveJson) {
        const resolved = resolveJson?.[0]?.number ?? resolveJson?.number ?? resolveJson?.[0]?.jid ?? resolveJson?.jid ?? null;
        if (resolved) {
          const clean = String(resolved).replace("@s.whatsapp.net", "").replace("@lid", "").replace(/\D/g, "").trim();
          if (clean && /^\d{10,13}$/.test(clean) && clean !== currentWaId) {
            console.log("[LID_RESOLVED_VIA_API]", JSON.stringify({
              remoteJidRaw,
              resolved: clean
            }));
            return clean;
          }
        }
      }
    } else {
      console.warn("[LID_RESOLVE_API_ERROR]", resolveResp.status);
    }
  } catch (err) {
    console.error("[LID_RESOLVE_FATAL_ERROR]", err);
  }
  // ------------------------------------------------------------------
  // Não conseguiu resolver — retorna vazio para o caller descartar
  // ------------------------------------------------------------------
  console.warn("[LID_UNRESOLVABLE]", JSON.stringify({
    remoteJidRaw,
    currentWaId
  }));
  return "";
}
// ---------------------------------------------------------------------------
// Status das mensagens (messages.update)
// ---------------------------------------------------------------------------
// Evolution v2: data = { keyId, fromMe, status: "DELIVERY_ACK" | "READ" | ... }
// Evolution v1: data = [{ key: { id, fromMe }, update: { status: 3 } }]
// Códigos numéricos: 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED
function mapEvolutionStatus(raw) {
  const value = typeof raw === "number" ? raw : String(raw ?? "").toUpperCase();
  if (value === 3 || value === "DELIVERY_ACK") return "delivered";
  if (value === 4 || value === 5 || value === "READ" || value === "PLAYED") return "read";
  return null;
}
async function handleMessagesUpdate(body) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const items = Array.isArray(body?.data) ? body.data : [
    body?.data
  ];
  // Não usamos body.date_time: vem no fuso do servidor da Evolution sem offset
  // (ex.: horário de Brasília lido como UTC = 3h de diferença). O webhook chega
  // na hora, então o relógio daqui é a melhor referência.
  const atIso = new Date().toISOString();
  const results = [];
  for (const item of items){
    if (!item) continue;
    const fromMe = item?.fromMe ?? item?.key?.fromMe;
    // Só nos interessam as mensagens que nós enviamos ao cliente
    if (fromMe !== true) continue;
    const providerMessageId = String(item?.keyId ?? item?.key?.id ?? "").trim();
    const status = mapEvolutionStatus(item?.status ?? item?.update?.status);
    if (!providerMessageId || !status) continue;
    try {
      const result = await applyMessageStatus(supabase, providerMessageId, status, atIso);
      results.push({
        providerMessageId,
        status,
        result
      });
    } catch (err) {
      console.error("[MESSAGE_STATUS_ERROR]", providerMessageId, err);
    }
  }
  console.log("[MESSAGE_STATUS]", JSON.stringify(results));
  return new Response(JSON.stringify({
    success: true,
    results
  }), {
    status: 200
  });
}
// ---------------------------------------------------------------------------
// Mensagens que não são conteúdo novo
// ---------------------------------------------------------------------------
// Campos de controle que acompanham qualquer mensagem
const ENVELOPE_KEYS = [
  "messageContextInfo",
  "senderKeyDistributionMessage"
];
const PROTOCOL_KEYS = [
  "protocolMessage",
  "pollUpdateMessage",
  "keepInChatMessage",
  "pinInChatMessage",
  "encReactionMessage"
];
/**
 * Edição de uma mensagem já enviada pelo cliente. O WhatsApp manda em dois
 * formatos, conforme a versão: editedMessage.message.protocolMessage ou
 * protocolMessage com type MESSAGE_EDIT.
 */ function extractMessageEdit(message) {
  const protocol = message?.editedMessage?.message?.protocolMessage ?? (message?.protocolMessage?.editedMessage ? message.protocolMessage : null);
  if (!protocol) return null;
  const edited = protocol.editedMessage ?? {};
  return {
    originalId: String(protocol.key?.id ?? "").trim(),
    text: String(edited.conversation ?? edited.extendedTextMessage?.text ?? "").trim()
  };
}
/** Evento sem conteúdo para o atendente (apagar mensagem, voto em enquete...). */ function isProtocolOnlyMessage(message) {
  const keys = Object.keys(message ?? {}).filter((key)=>!ENVELOPE_KEYS.includes(key));
  if (keys.length === 0) return true;
  return keys.every((key)=>PROTOCOL_KEYS.includes(key));
}
// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req)=>{
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405
      });
    }
    // Segredo compartilhado com a Evolution: configure a URL do webhook como
    // .../functions/v1/evolution-in?token=<EVOLUTION_WEBHOOK_SECRET>
    // (ou envie o header x-webhook-secret). Sem o secret configurado, apenas avisa.
    if (EVOLUTION_WEBHOOK_SECRET) {
      const provided = new URL(req.url).searchParams.get("token") ?? req.headers.get("x-webhook-secret") ?? "";
      // "Webhook by Events" cola o nome do evento depois do token (.../evolution-in?token=<secret>/messages-upsert)
      if (!timingSafeEqual(stripWebhookEventSuffix(provided, EVOLUTION_WEBHOOK_SECRET), EVOLUTION_WEBHOOK_SECRET)) {
        console.warn("[SECURITY] evolution-in: token do webhook inválido, requisição rejeitada");
        return new Response("Unauthorized", {
          status: 401
        });
      }
    } else {
      console.warn("[SECURITY] evolution-in: EVOLUTION_WEBHOOK_SECRET não configurado — webhook aceita qualquer origem");
    }
    const body = await req.json();
    console.log("[EVOLUTION_WEBHOOK_FULL]", JSON.stringify(redactWebhookSecrets(body), null, 2));
    // ── Status de entrega/leitura das mensagens enviadas (ticks) ──────────
    if (body?.event === "messages.update" || body?.event === "MESSAGES_UPDATE") {
      return await handleMessagesUpdate(body);
    }
    // ── Eventos permitidos ────────────────────────────────────────────────
    const allowedEvents = [
      "messages.upsert",
      "connection.update",
      "CONNECTION_UPDATE",
      "qrcode.updated",
      "QRCODE_UPDATED"
    ];
    if (!allowedEvents.includes(body?.event)) {
      return new Response(JSON.stringify({
        ignored: true,
        event: body?.event
      }), {
        status: 200
      });
    }
    // ── Mensagem enviada pelo próprio número (fromMe) ─────────────────────
    // Não entra como mensagem do cliente. Mais abaixo só serve para tirar o
    // bot da conversa quando a equipe responde pelo celular.
    const isFromMe = body?.data?.key?.fromMe === true;
    // ── Resolve origem da conversa ────────────────────────────────────────
    const remoteJidRaw = body?.data?.key?.remoteJid ?? "";
    // remoteJidAlt — presente em versões >= 2.3.x quando o remetente tem LID
    // Contém o número real no formato "5511999998888@s.whatsapp.net"
    const remoteJidAlt = body?.data?.key?.remoteJidAlt ?? "";
    const participantPn = body?.data?.key?.participantPn ?? "";
    const participant = body?.data?.key?.participant ?? "";
    // ── Ignora grupos ─────────────────────────────────────────────────────
    if (remoteJidRaw.endsWith("@g.us")) {
      console.log("Mensagem de grupo ignorada:", remoteJidRaw);
      return new Response(JSON.stringify({
        ignored: true,
        reason: "group_message"
      }), {
        status: 200
      });
    }
    // ── Resolve telefone bruto ────────────────────────────────────────────
    // Prioridade: remoteJidAlt (número real) > participantPn > participant > remoteJid
    let rawPhone = remoteJidRaw;
    if (remoteJidAlt && !remoteJidAlt.includes("@lid")) {
      rawPhone = remoteJidAlt;
    } else if (participantPn) {
      rawPhone = participantPn;
    } else if (participant && !participant.includes("@lid")) {
      rawPhone = participant;
    }
    // Limpeza inicial do waId
    let waId = rawPhone.replace("@s.whatsapp.net", "").replace("@lid", "").split("@")[0].trim();
    console.log("[PHONE_RESOLUTION_RAW]", {
      remoteJidRaw,
      remoteJidAlt,
      participantPn,
      participant,
      rawWaId: waId
    });
    // ── Ignora reações ────────────────────────────────────────────────────
    if (body?.data?.message?.reactionMessage) {
      return new Response(JSON.stringify({
        ignored: true,
        reason: "reaction"
      }), {
        status: 200
      });
    }
    // ── Ignora stickers ───────────────────────────────────────────────────
    if (body?.data?.message?.stickerMessage) {
      return new Response(JSON.stringify({
        ignored: true,
        reason: "sticker"
      }), {
        status: 200
      });
    }
    // ── Supabase client ───────────────────────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // ── Edição de mensagem: corrige o texto da original ───────────────────
    // (antes virava uma mensagem vazia e o bot respondia "não entendi")
    // (só para mensagens: eventos de conexão e QR Code não têm data.message)
    const isMessageEvent = body?.event === "messages.upsert";
    const edit = isMessageEvent ? extractMessageEdit(body?.data?.message) : null;
    if (edit) {
      if (edit.originalId && edit.text) {
        const { error: editError } = await supabase.from("messages").update({
          text: edit.text
        }).eq("meta_message_id", edit.originalId).eq("direction", "inbound");
        if (editError) console.error("[MESSAGE_EDIT_ERROR]", editError);
      }
      return new Response(JSON.stringify({
        ignored: true,
        reason: "message_edit"
      }), {
        status: 200
      });
    }
    // ── Eventos de protocolo (mensagem apagada, voto em enquete, fixar etc.) ─
    if (isMessageEvent && isProtocolOnlyMessage(body?.data?.message)) {
      return new Response(JSON.stringify({
        ignored: true,
        reason: "protocol_message"
      }), {
        status: 200
      });
    }
    // ── Resolve connection pelo instanceName ──────────────────────────────
    const instanceName = String(body?.instance ?? "").trim();
    if (!instanceName) {
      return new Response("Missing instance", {
        status: 400
      });
    }
    const { data: connection, error: connectionError } = await supabase.from("channel_connections").select("id, clinic_id, evolution_api_url, evolution_api_key").eq("provider", "evolution").eq("session_name", instanceName).is("archived_at", null).maybeSingle();
    if (connectionError || !connection) {
      console.error("Connection not found:", connectionError);
      return new Response("Connection not found", {
        status: 404
      });
    }
    // ─────────────────────────────────────────────────────────────────────
    // CONNECTION STATUS EVENTS
    // ─────────────────────────────────────────────────────────────────────
    const event = String(body?.event ?? "").trim();
    if (event === "CONNECTION_UPDATE" || event === "connection.update") {
      const state = body?.data?.state ?? body?.data?.connection ?? body?.state ?? null;
      console.log("[CONNECTION_UPDATE]", {
        instanceName,
        state
      });
      // CONNECTED
      if (state === "open" || state === "connected") {
        const connectedPhone = body?.data?.wuid ?? body?.data?.number ?? null;
        const connectedName = body?.data?.profileName ?? body?.data?.pushName ?? null;
        const { error: updateError } = await supabase.from("channel_connections").update({
          status: "connected",
          qr_code: null,
          disconnect_reason: null,
          connected_phone: connectedPhone,
          connected_name: connectedName,
          last_connection_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq("id", connection.id);
        const rejection = connectionRejectionReason(updateError);
        if (rejection) {
          // QR Code escaneado acima do limite ou celular já conectado em outro número
          console.warn("[CONNECTION_REJECTED]", connection.id, rejection);
          await rejectConnection(supabase, {
            id: connection.id,
            session_name: instanceName
          }, connection.evolution_api_url || EVOLUTION_API_URL_FALLBACK, connection.evolution_api_key || EVOLUTION_API_KEY_FALLBACK, rejection);
        } else if (updateError) {
          console.error("[CONNECTION_CONNECTED_ERROR]", updateError);
        } else {
          console.log("[CONNECTION_CONNECTED_SUCCESS]", connection.id);
        }
        return new Response(JSON.stringify({
          success: true
        }), {
          status: 200
        });
      }
      // DISCONNECTED
      if (state === "close" || state === "disconnected") {
        const { error: updateError } = await supabase.from("channel_connections").update({
          status: "disconnected",
          last_disconnection_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq("id", connection.id);
        if (updateError) {
          console.error("[CONNECTION_DISCONNECTED_ERROR]", updateError);
        } else {
          console.log("[CONNECTION_DISCONNECTED_SUCCESS]", connection.id);
        }
        return new Response(JSON.stringify({
          success: true
        }), {
          status: 200
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────
    // QR CODE UPDATED
    // ─────────────────────────────────────────────────────────────────────
    if (event === "QRCODE_UPDATED" || event === "qrcode.updated") {
      const qrCode = body?.data?.qrcode ?? body?.data?.base64 ?? body?.qrcode ?? body?.base64 ?? null;
      console.log("[QRCODE_UPDATED]", {
        instanceName,
        hasQr: !!qrCode
      });
      if (qrCode) {
        const { error: updateError } = await supabase.from("channel_connections").update({
          status: "connecting",
          qr_code: qrCode,
          updated_at: new Date().toISOString()
        }).eq("id", connection.id);
        if (updateError) {
          console.error("[QRCODE_UPDATE_ERROR]", updateError);
        } else {
          console.log("[QRCODE_UPDATE_SUCCESS]", connection.id);
        }
      }
      return new Response(JSON.stringify({
        success: true
      }), {
        status: 200
      });
    }
    // ── Resolve LID → número real (se necessário) ─────────────────────────
    // Feito APÓS buscar a connection pois precisamos das credenciais da Evolution
    if (connection.evolution_api_url && connection.evolution_api_key) {
      waId = await resolveWaId({
        evolutionApiUrl: connection.evolution_api_url,
        evolutionApiKey: connection.evolution_api_key,
        instanceName,
        remoteJidRaw,
        remoteJidAlt,
        currentWaId: waId
      });
    } else {
      console.warn("[LID_RESOLVE] evolution_api_url/key não configurados — LIDs não serão resolvidos para a connection:", connection.id);
    }
    console.log("[PHONE_RESOLUTION_FINAL]", {
      waId
    });
    // ── Descarta mensagem se o waId não pôde ser resolvido para telefone real
    // Isso evita salvar LIDs numéricos (ex: 123304753004612) como telefone
    if (!waId || !/^\d{10,13}$/.test(waId)) {
      console.warn("[DROPPED] waId não resolvido ou parece LID numérico, descartando mensagem:", {
        remoteJidRaw,
        waId
      });
      return new Response(JSON.stringify({
        ignored: true,
        reason: "lid_unresolvable"
      }), {
        status: 200
      });
    }
    const providerMessageId = String(body?.data?.key?.id ?? "").trim();
    if (!providerMessageId) {
      return new Response("Missing providerMessageId", {
        status: 400
      });
    }
    if (isFromMe) {
      const ownMessageTask = endBotSessionIfSentOutsideUnxet({
        supabase,
        clinicId: connection.clinic_id,
        channelConnectionId: connection.id,
        waId,
        providerMessageId
      }).catch((err)=>{
        console.error("[OWN_MESSAGE_CHECK_ERROR]", err);
      });
      // A checagem espera alguns segundos: responde à Evolution sem segurar o webhook
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        EdgeRuntime.waitUntil(ownMessageTask);
      } else {
        await ownMessageTask;
      }
      return new Response(JSON.stringify({
        ignored: true,
        reason: "from_me"
      }), {
        status: 200
      });
    }
    const profileName = body?.data?.pushName ?? "Cliente";
    const timestampRaw = body?.data?.messageTimestamp;
    const timestamp = timestampRaw ? new Date(Number(timestampRaw) * 1000).toISOString() : new Date().toISOString();
    // ── Detecta tipo de mensagem ──────────────────────────────────────────
    const msgData = body?.data?.message ?? {};
    let messageType = "text";
    let text = "";
    let media;
    let interactive;
    let needsMediaFetch = false;
    let fallbackFilename;
    let fallbackMimeType;
    if (msgData.conversation || msgData.extendedTextMessage) {
      messageType = "text";
      text = msgData.conversation ?? msgData.extendedTextMessage?.text ?? "";
    } else if (msgData.imageMessage) {
      messageType = "image";
      text = msgData.imageMessage.caption ?? "";
      needsMediaFetch = true;
    } else if (msgData.audioMessage || msgData.pttMessage) {
      messageType = "audio";
      needsMediaFetch = true;
    } else if (msgData.documentMessage || msgData.documentWithCaptionMessage) {
      messageType = "document";
      const docMsg = msgData.documentMessage ?? msgData.documentWithCaptionMessage?.message?.documentMessage;
      text = docMsg?.caption ?? "";
      needsMediaFetch = true;
    } else if (msgData.buttonsResponseMessage) {
      messageType = "interactive";
      interactive = {
        kind: "button_reply",
        selectedId: msgData.buttonsResponseMessage.selectedButtonId ?? null,
        selectedTitle: msgData.buttonsResponseMessage.selectedDisplayText ?? null
      };
      text = interactive.selectedTitle ?? interactive.selectedId ?? "";
    } else if (msgData.listResponseMessage) {
      messageType = "interactive";
      interactive = {
        kind: "list_reply",
        selectedId: msgData.listResponseMessage.singleSelectReply?.selectedRowId ?? null,
        selectedTitle: msgData.listResponseMessage.title ?? null
      };
      text = interactive.selectedTitle ?? interactive.selectedId ?? "";
    } else if (msgData.templateButtonReplyMessage) {
      messageType = "interactive";
      interactive = {
        kind: "button_reply",
        selectedId: String(msgData.templateButtonReplyMessage.selectedIndex ?? ""),
        selectedTitle: msgData.templateButtonReplyMessage.selectedDisplayText ?? null
      };
      text = interactive.selectedTitle ?? interactive.selectedId ?? "";
    } else if (msgData.videoMessage) {
      // Vídeo chega como anexo (o chat exibe/baixa pelo tipo do arquivo)
      messageType = "document";
      text = msgData.videoMessage.caption ?? "";
      needsMediaFetch = true;
      fallbackFilename = `video-${providerMessageId}.mp4`;
      fallbackMimeType = msgData.videoMessage.mimetype ?? "video/mp4";
    } else if (msgData.locationMessage || msgData.liveLocationMessage) {
      const loc = msgData.locationMessage ?? msgData.liveLocationMessage;
      const place = [
        loc.name,
        loc.address
      ].filter(Boolean).join(" - ");
      const hasCoords = Number.isFinite(Number(loc.degreesLatitude)) && Number.isFinite(Number(loc.degreesLongitude));
      text = [
        "📍 Localização" + (place ? `: ${place}` : ""),
        hasCoords ? `https://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}` : ""
      ].filter(Boolean).join("\n");
    } else if (msgData.contactMessage || msgData.contactsArrayMessage) {
      const contacts = msgData.contactMessage ? [
        msgData.contactMessage
      ] : msgData.contactsArrayMessage?.contacts ?? [];
      text = contacts.map((c)=>{
        const phone = String(c?.vcard ?? "").match(/TEL[^:]*:([+\d\s().-]+)/i)?.[1]?.trim();
        return `👤 Contato: ${c?.displayName ?? "sem nome"}` + (phone ? ` - ${phone}` : "");
      }).join("\n") || "👤 Contato compartilhado";
    } else if (msgData.pollCreationMessage || msgData.pollCreationMessageV2 || msgData.pollCreationMessageV3) {
      const poll = msgData.pollCreationMessage ?? msgData.pollCreationMessageV2 ?? msgData.pollCreationMessageV3;
      text = `📊 Enquete: ${poll?.name ?? ""}`.trim();
    } else {
      // Tipo que ainda não tratamos: o atendente precisa saber que chegou algo
      console.warn("[UNSUPPORTED_MESSAGE_TYPE]", Object.keys(msgData));
      text = "[Mensagem em um formato que o Unxet ainda não exibe. Peça ao cliente para reenviar como texto, foto ou documento.]";
    }
    // ── Busca mídia via Evolution API (base64) ────────────────────────────
    if (needsMediaFetch && connection.evolution_api_url && connection.evolution_api_key) {
      try {
        const base64Resp = await fetch(`${connection.evolution_api_url.replace(/\/$/, "")}/chat/getBase64FromMediaMessage/${instanceName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: connection.evolution_api_key
          },
          body: JSON.stringify({
            message: {
              key: body.data.key,
              message: body.data.message
            },
            convertToMp4: false
          })
        });
        if (base64Resp.ok) {
          const base64Json = await base64Resp.json();
          const base64Data = base64Json?.base64 ?? null;
          const mimeType = base64Json?.mimeType ?? base64Json?.mimetype ?? msgData.imageMessage?.mimetype ?? msgData.audioMessage?.mimetype ?? msgData.pttMessage?.mimetype ?? msgData.documentMessage?.mimetype ?? msgData.documentWithCaptionMessage?.message?.documentMessage?.mimetype ?? fallbackMimeType ?? "application/octet-stream";
          console.log("[MEDIA_MIME_RESOLVED]", {
            mimeType,
            providerMessageId
          });
          if (base64Data) {
            const filename = msgData.documentMessage?.fileName ?? msgData.documentWithCaptionMessage?.message?.documentMessage?.fileName ?? fallbackFilename ?? undefined;
            media = {
              base64: base64Data,
              mimeType,
              filename
            };
          } else {
            console.warn("getBase64FromMediaMessage retornou sem base64 para:", providerMessageId);
          }
        } else {
          console.error("getBase64FromMediaMessage retornou erro:", base64Resp.status, await base64Resp.text());
        }
      } catch (err) {
        console.error("Erro ao buscar mídia da Evolution:", err);
      }
    } else if (needsMediaFetch && (!connection.evolution_api_url || !connection.evolution_api_key)) {
      console.warn("Mensagem de mídia recebida mas evolution_api_url/key não configurados na connection:", connection.id);
    }
    // ── Monta payload normalizado para o shared-in-config ─────────────────
    const sharedPayload = {
      provider: "evolution",
      clinicId: connection.clinic_id,
      channelConnectionId: connection.id,
      waId,
      profileName,
      providerMessageId,
      timestamp,
      messageType,
      text,
      ...media ? {
        media
      } : {},
      ...interactive ? {
        interactive
      } : {},
      rawPayload: body
    };
    console.log("[SHARED_PAYLOAD]", JSON.stringify({
      providerMessageId,
      messageType,
      hasMedia: !!media,
      hasText: !!text
    }));
    // ── Encaminha para shared-in-config ───────────────────────────────────
    const sharedResp = await fetch(SHARED_IN_CONFIG_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_BOT_SECRET
      },
      body: JSON.stringify(sharedPayload)
    });
    if (!sharedResp.ok) {
      const errText = await sharedResp.text();
      console.error("shared-in-config retornou erro:", sharedResp.status, errText);
      return new Response("Upstream error", {
        status: 502
      });
    }
    // ── Foto de perfil (fire-and-forget assíncrono) ───────────────────────
    if (connection.evolution_api_url && connection.evolution_api_key) {
      fetchAndStoreProfilePic({
        supabase,
        evolutionApiUrl: connection.evolution_api_url,
        evolutionApiKey: connection.evolution_api_key,
        instanceName,
        waId,
        clinicId: connection.clinic_id
      }).catch((err)=>{
        console.error("Erro ao buscar/salvar profile pic:", err);
      });
    }
    return new Response(JSON.stringify({
      success: true
    }), {
      status: 200
    });
  } catch (error) {
    console.error("Erro inesperado em evolution-in:", error);
    return new Response(JSON.stringify({
      error: "Internal error"
    }), {
      status: 500
    });
  }
});
// ---------------------------------------------------------------------------
// Equipe respondendo pelo celular
// ---------------------------------------------------------------------------
// Quem envia pelo Unxet (bot, atendente, agendamento) grava a mensagem com o
// ID do WhatsApp logo depois de a Evolution confirmar o envio. Se depois de
// alguns segundos esse ID não existe em messages, a mensagem saiu do celular
// (ou do WhatsApp Web) da empresa: uma pessoa assumiu a conversa e o bot sai.
const OWN_MESSAGE_CHECK_DELAYS_MS = [
  0,
  3000,
  4000,
  8000
];
function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
}
async function endBotSessionIfSentOutsideUnxet(params) {
  const { supabase, clinicId, channelConnectionId, waId, providerMessageId } = params;
  const { data: contact, error: contactErr } = await supabase.from("contacts").select("id").eq("clinic_id", clinicId).eq("phone", waId).limit(1).maybeSingle();
  if (contactErr || !contact) return;
  const { data: conversations, error: convErr } = await supabase.from("conversations").select("id").eq("clinic_id", clinicId).eq("contact_id", contact.id).eq("channel_connection_id", channelConnectionId);
  if (convErr || !conversations?.length) return;
  const { data: sessions, error: sessionsErr } = await supabase.from("conversation_bot_sessions").select("id, clinic_id, conversation_id, bot_id, current_node_id").in("conversation_id", conversations.map((c)=>c.id)).eq("channel_connection_id", channelConnectionId).eq("status", "active");
  if (sessionsErr || !sessions?.length) return;
  for (const delay of OWN_MESSAGE_CHECK_DELAYS_MS){
    if (delay) await sleep(delay);
    const { data: known, error: knownErr } = await supabase.from("messages").select("id").eq("meta_message_id", providerMessageId).limit(1).maybeSingle();
    if (knownErr) {
      console.error("[OWN_MESSAGE_LOOKUP_ERROR]", knownErr);
      return;
    }
    if (known) return; // enviada pelo Unxet
  }
  const now = new Date().toISOString();
  for (const session of sessions){
    const { data: ended, error: endErr } = await supabase.from("conversation_bot_sessions").update({
      status: "cancelled",
      ended_reason: "human_reply",
      completed_at: now,
      current_node_id: null,
      last_interaction_at: now,
      updated_at: now
    }).eq("id", session.id).eq("status", "active").select("id");
    if (endErr) {
      console.error("[OWN_MESSAGE_END_SESSION_ERROR]", endErr);
      continue;
    }
    if (!ended?.length) continue;
    console.log("[BOT_SESSION_ENDED_BY_PHONE_REPLY]", JSON.stringify({
      sessionId: session.id,
      conversationId: session.conversation_id,
      providerMessageId
    }));
    await supabase.from("conversation_bot_events").insert({
      clinic_id: session.clinic_id,
      conversation_bot_session_id: session.id,
      conversation_id: session.conversation_id,
      bot_id: session.bot_id,
      node_id: session.current_node_id ?? null,
      event_type: "session_cancelled",
      payload: {
        reason: "human_reply",
        cause: "sent_outside_unxet",
        provider_message_id: providerMessageId
      }
    });
    await supabase.from("conversation_events").insert({
      conversation_id: session.conversation_id,
      event_type: "bot_session_ended",
      performed_by: null,
      metadata: {
        bot_id: session.bot_id,
        conversation_bot_session_id: session.id,
        reason: "human_reply",
        cause: "sent_outside_unxet"
      }
    });
    // Conversa sai do modo bot e volta a aparecer para os atendentes. O prazo de
    // 1ª resposta não é reiniciado: alguém da equipe acabou de responder.
    await supabase.from("conversations").update({
      in_bot_flow: false,
      updated_at: now
    }).eq("id", session.conversation_id).eq("in_bot_flow", true);
  }
}
// ---------------------------------------------------------------------------
// Profile pic: busca na Evolution API e faz upsert no bucket + contacts
// ---------------------------------------------------------------------------
async function fetchAndStoreProfilePic(params) {
  const { supabase, evolutionApiUrl, evolutionApiKey, instanceName, waId, clinicId } = params;
  // 1. Verifica se o contato já tem foto
  const { data: existingContact } = await supabase.from("contacts").select("id, image_url").eq("phone", waId).eq("clinic_id", clinicId).maybeSingle();
  if (existingContact?.image_url) {
    return;
  }
  // 2. Busca URL da foto na Evolution API
  const picResp = await fetch(`${evolutionApiUrl.replace(/\/$/, "")}/chat/fetchProfilePictureUrl/${instanceName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: evolutionApiKey
    },
    body: JSON.stringify({
      number: waId
    })
  });
  if (!picResp.ok) {
    console.warn(`fetchProfilePictureUrl retornou ${picResp.status} para ${waId}`);
    return;
  }
  const picJson = await picResp.json();
  const profilePicUrl = picJson?.profilePictureUrl ?? picJson?.profilePicUrl ?? null;
  if (!profilePicUrl) {
    return;
  }
  // 3. Baixa a imagem
  const imgResp = await fetch(profilePicUrl);
  if (!imgResp.ok || !imgResp.body) {
    console.warn(`Falha ao baixar profile pic de ${profilePicUrl}`);
    return;
  }
  const arrayBuffer = await imgResp.arrayBuffer();
  const contentType = imgResp.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : "jpg";
  // 4. Upload no bucket
  const storagePath = `${clinicId}/${waId}/profile/avatar.${ext}`;
  const { error: uploadError } = await supabase.storage.from(PROFILE_PIC_BUCKET).upload(storagePath, arrayBuffer, {
    contentType,
    upsert: true
  });
  if (uploadError) {
    console.error("Erro ao fazer upload da profile pic:", uploadError);
    return;
  }
  const { data: publicData } = supabase.storage.from(PROFILE_PIC_BUCKET).getPublicUrl(storagePath);
  const publicUrl = publicData?.publicUrl;
  if (!publicUrl) return;
  // 5. Atualiza contacts.image_url
  if (existingContact?.id) {
    const { error: updateErr } = await supabase.from("contacts").update({
      image_url: publicUrl
    }).eq("id", existingContact.id);
    if (updateErr) {
      console.error("Erro ao atualizar image_url no contato:", updateErr);
    } else {
      console.log(`Profile pic salva para ${waId}: ${publicUrl}`);
    }
  }
}
