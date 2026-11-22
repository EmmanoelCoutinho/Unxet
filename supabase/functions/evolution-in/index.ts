/**
 * evolution-in — Gateway da Evolution API (WhatsApp via QR Code)
 *
 * Responsabilidades:
 *  1. Filtrar apenas eventos "messages.upsert" do tipo inbound (grupos só com
 *     channel_connections.groups_enabled; reações gravam o emoji)
 *  2. Resolver clinicId + channelConnectionId via session_name
 *  3. Normalizar todos os tipos de mensagem (text, image, audio, document, interactive)
 *  4. Buscar mídia via Evolution API (base64) e repassar para o shared
 *  5. Capturar profilePicUrl de forma assíncrona (fire-and-forget)
 *  6. Encaminhar o payload normalizado para shared-in-config
 *  7. Resolver LID para número real via Evolution API
 *  8. Gravar entrega/leitura das mensagens enviadas ("messages.update")
 *  9. Tirar o bot da conversa quando a equipe responde pelo celular (fromMe)
 * 10. Gravar na conversa as mensagens enviadas pelo celular, quando o número
 *     tem channel_connections.phone_messages_enabled
 *
 * Nenhuma lógica de negócio vive aqui.
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/security.ts";
import { applyMessageStatus } from "../_shared/messageStatus.ts";
import { redactWebhookSecrets, stripWebhookEventSuffix } from "../_shared/evolutionWebhook.ts";
import { connectionRejectionReason, rejectConnection } from "../_shared/evolutionLimit.ts";
import { isNonChatJid } from "../_shared/evolutionSettings.ts";
import { ensureWhatsappGroup, groupSender, isGroupJid, mentionedJids, participantPhones, replaceMentions } from "../_shared/whatsappGroups.ts";
import { findContactByPhone } from "../_shared/startConversation.ts";
import { blockIdentifiers, registerBlockedInbound } from "../_shared/contactBlock.ts";
import { createCheckThrottle, imageHash, isCurrentProfilePic, profilePicFolder, profilePicPath } from "../_shared/profilePicture.ts";
import { safeStorageContentType } from "../_shared/storageContentType.ts";
import { applyReaction, evolutionQuotedId, evolutionReaction } from "../_shared/messageReply.ts";
import { savePhoneSentMessage, waitForKnownMessage } from "../_shared/phoneSentMessages.ts";
import { queueTranscription } from "../_shared/transcription.ts";
import { decryptSecretEdit, extractMessageEdit, extractSecretEdit, originalMessageSecret, senderJidCandidates } from "../_shared/messageEdit.ts";
import { stickerExists, stickerStoragePath } from "../_shared/stickerStore.ts";
import { decryptPollVote, extractPollUpdate, normalizeJids, pollDefinition } from "../_shared/pollVote.ts";
import { isProtocolOnlyMessage, isViewOnceMedia, mediaFilename, mediaMimeType, parseEvolutionContent, unwrapEvolutionMessage } from "../_shared/evolutionContent.ts";
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
// (ERROR / 0 vira "failed": mensagem não entregue)
// Códigos numéricos: 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED
function mapEvolutionStatus(raw) {
  const value = typeof raw === "number" ? raw : String(raw ?? "").toUpperCase();
  if (value === 3 || value === "DELIVERY_ACK") return "delivered";
  if (value === 4 || value === 5 || value === "READ" || value === "PLAYED") return "read";
  // O WhatsApp recusou a mensagem que a Evolution aceitou no envio
  // (ex.: Evolution 2.3.7 depois de ler o QR de novo): vira "não entregue"
  if (value === 0 || value === "ERROR") return "failed";
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
/** data do webhook com a mensagem desembrulhada (ver _shared/evolutionContent.ts). */ function evolutionData(body) {
  const data = body?.data;
  if (!data?.message) return data;
  return {
    ...data,
    message: unwrapEvolutionMessage(data.message)
  };
}
// ---------------------------------------------------------------------------
// Edição de mensagem
// ---------------------------------------------------------------------------
/**
 * Grava a edição na mensagem original: texto novo, quando foi editada e o
 * texto de antes da primeira edição. Sem conseguir ler o texto novo (edição
 * criptografada sem o LID do cliente), marca edit_unreadable para a conversa
 * avisar que a mensagem foi editada no WhatsApp.
 */ async function applyMessageEdit(supabase, params) {
  const { body, data, isFromMe, plainEdit, secretEdit } = params;
  const originalId = (plainEdit ?? secretEdit)?.originalId;
  if (!originalId) return;
  const { data: original, error } = await supabase.from("messages").select("id, conversation_id, text, original_text, payload").eq("meta_message_id", originalId).eq("direction", isFromMe ? "outbound" : "inbound").order("created_at", {
    ascending: false
  }).limit(1).maybeSingle();
  if (error) throw error;
  if (!original) {
    console.log("[MESSAGE_EDIT_ORIGINAL_NOT_FOUND]", originalId);
    return;
  }
  let text = plainEdit?.text ?? "";
  if (secretEdit) {
    const messageSecret = originalMessageSecret(original.payload);
    if (messageSecret) {
      const senderJids = await editSenderJids(supabase, {
        body,
        data,
        original,
        isFromMe
      });
      const result = await decryptSecretEdit({
        edit: secretEdit,
        messageSecret,
        senderJids
      });
      text = result?.text ?? "";
      console.log("[MESSAGE_EDIT_DECRYPT]", JSON.stringify({
        originalId,
        decrypted: !!result,
        tried: senderJids.length,
        senderJid: result?.senderJid ?? null
      }));
    } else {
      console.log("[MESSAGE_EDIT_NO_SECRET]", originalId);
    }
  }
  if (text && text === original.text) return;
  // Eco da edição feita pelo Unxet (edit-message): chega com o nome do
  // atendente na 1ª linha, e o banco já tem o texto novo sem o nome
  if (isFromMe && text && original.text && text.endsWith("\n" + original.text)) return;
  const editedAt = new Date().toISOString();
  const update = text ? {
    text,
    edited_at: editedAt,
    edit_unreadable: false,
    original_text: original.original_text ?? original.text ?? null
  } : {
    edited_at: editedAt,
    edit_unreadable: true
  };
  const { error: updateError } = await supabase.from("messages").update(update).eq("id", original.id);
  if (updateError) throw updateError;
}
/**
 * JIDs possíveis de quem escreveu a mensagem editada. A chave usa o LID, que
 * a Evolution troca pelo telefone no webhook: procura no próprio webhook, nas
 * mensagens já gravadas da conversa e, por fim, na Evolution.
 */ async function editSenderJids(supabase, { body, data, original, isFromMe }) {
  const key = data?.key ?? {};
  const originalKey = original.payload?.data?.key ?? {};
  const values = [
    key.senderLid,
    key.participantLid,
    key.participant,
    originalKey.senderLid,
    originalKey.participant,
    key.remoteJid,
    originalKey.remoteJid
  ];
  if (isFromMe) {
    values.push(body?.sender, key.participantAlt);
  } else if (!senderJidCandidates(values).some((jid)=>jid.endsWith("@lid"))) {
    const { data: rows } = await supabase.from("messages").select("payload->data->key->>remoteJid").eq("conversation_id", original.conversation_id).eq("direction", "inbound").like("payload->data->key->>remoteJid", "%@lid").limit(1);
    const lid = rows?.[0]?.remoteJid ?? await lookupLid(String(body?.instance ?? "").trim(), key.remoteJidAlt ?? key.remoteJid);
    if (lid) values.unshift(lid);
  }
  values.push(key.remoteJidAlt, key.participantPn, key.participantAlt);
  return senderJidCandidates(values);
}
/** LID de um telefone pela Evolution (/chat/whatsappNumbers, versões 2.3+). */ async function lookupLid(instanceName, jid) {
  const phone = String(jid ?? "").split("@")[0].replace(/\D/g, "");
  if (!instanceName || !phone || String(jid).endsWith("@lid")) return null;
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: connection } = await supabase.from("channel_connections").select("evolution_api_url, evolution_api_key").eq("provider", "evolution").eq("session_name", instanceName).is("archived_at", null).maybeSingle();
    if (!connection?.evolution_api_url || !connection?.evolution_api_key) return null;
    const resp = await fetch(`${connection.evolution_api_url.replace(/\/$/, "")}/chat/whatsappNumbers/${instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: connection.evolution_api_key
      },
      body: JSON.stringify({
        numbers: [
          phone
        ]
      })
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const items = Array.isArray(json) ? json : [
      json
    ];
    for (const item of items){
      const lid = [
        item?.lid,
        item?.jid
      ].find((v)=>typeof v === "string" && v.endsWith("@lid"));
      if (lid) return lid;
    }
  } catch (err) {
    console.warn("[MESSAGE_EDIT_LID_LOOKUP_ERROR]", err);
  }
  return null;
}
// ---------------------------------------------------------------------------
// Voto em enquete
// ---------------------------------------------------------------------------
/**
 * Grava o voto na enquete (messages.poll_votes, por JID de quem votou). O voto
 * vem criptografado com o messageSecret da enquete (ver _shared/pollVote.ts);
 * a chave usa os JIDs de quem criou e de quem votou, que podem ser o telefone
 * ou o LID do cliente e da empresa: tentamos as combinações.
 */ async function applyPollVote(supabase, { body, data, isFromMe, update }) {
  const { data: poll, error } = await supabase.from("messages").select("id, conversation_id, direction, payload, poll_votes").eq("meta_message_id", update.pollId).order("created_at", {
    ascending: false
  }).limit(1).maybeSingle();
  if (error) throw error;
  if (!poll) {
    console.log("[POLL_VOTE_POLL_NOT_FOUND]", update.pollId);
    return;
  }
  const definition = pollDefinition(poll.payload?.data?.message ?? poll.payload?.message);
  if (!definition) {
    console.log("[POLL_VOTE_NOT_A_POLL]", update.pollId);
    return;
  }
  let options = update.plainOptions;
  let voterJid = normalizeJids([
    data?.key?.participant,
    data?.key?.remoteJid
  ])[0] ?? (isFromMe ? "me" : "cliente");
  if (!options) {
    const messageSecret = originalMessageSecret(poll.payload);
    if (!messageSecret) {
      console.log("[POLL_VOTE_NO_SECRET]", update.pollId);
      return;
    }
    const instanceName = String(body?.instance ?? "").trim();
    const key = data?.key ?? {};
    const pollKey = poll.payload?.data?.key ?? {};
    const clientValues = [
      key.senderLid,
      key.participantLid,
      key.participant,
      key.remoteJid,
      key.remoteJidAlt,
      key.participantAlt,
      key.participantPn,
      key.senderPn,
      pollKey.senderLid,
      pollKey.participant,
      pollKey.remoteJid,
      pollKey.remoteJidAlt
    ];
    if (!normalizeJids(clientValues).some((jid)=>jid.endsWith("@lid"))) {
      const { data: rows } = await supabase.from("messages").select("payload->data->key->>remoteJid").eq("conversation_id", poll.conversation_id).eq("direction", "inbound").like("payload->data->key->>remoteJid", "%@lid").limit(1);
      const lid = rows?.[0]?.remoteJid ?? await lookupLid(instanceName, key.remoteJidAlt ?? key.remoteJid);
      if (lid) clientValues.unshift(lid);
    }
    const { data: connection } = await supabase.from("channel_connections").select("connected_phone").eq("provider", "evolution").eq("session_name", instanceName).is("archived_at", null).maybeSingle();
    const ownValues = [
      body?.sender,
      connection?.connected_phone
    ];
    const ownPhone = normalizeJids(ownValues).find((jid)=>!jid.endsWith("@lid"));
    const ownLid = ownPhone ? await lookupLid(instanceName, ownPhone) : null;
    if (ownLid) ownValues.unshift(ownLid);
    const jids = normalizeJids([
      ...clientValues,
      ...ownValues
    ]);
    const result = await decryptPollVote({
      update,
      messageSecret,
      options: definition.options,
      creatorJids: jids,
      voterJids: jids
    });
    console.log("[POLL_VOTE_DECRYPT]", JSON.stringify({
      pollId: update.pollId,
      decrypted: !!result,
      tried: jids.length,
      voterJid: result?.voterJid ?? null,
      creatorJid: result?.creatorJid ?? null
    }));
    if (!result) return;
    options = result.options;
    voterJid = result.voterJid;
  }
  const at = new Date(update.timestampMs ?? (Number(body?.data?.messageTimestamp) * 1000 || Date.now())).toISOString();
  const votes = poll.poll_votes && typeof poll.poll_votes === "object" ? {
    ...poll.poll_votes
  } : {};
  // Voto atrasado (chegou depois de um mais novo da mesma pessoa) não vale
  if (votes[voterJid]?.at && votes[voterJid].at > at) return;
  votes[voterJid] = {
    options,
    at,
    name: isFromMe ? null : body?.data?.pushName ?? null,
    fromMe: isFromMe
  };
  const { error: updateError } = await supabase.from("messages").update({
    poll_votes: votes
  }).eq("id", poll.id);
  if (updateError) throw updateError;
}
// ---------------------------------------------------------------------------
// Progresso da faixa "Sincronizando o WhatsApp"
// ---------------------------------------------------------------------------
/**
 * Mensagem recuperada (evolution-connection-sync) que terminou de ser tratada:
 * soma no progresso da conexão, tenha ela entrado na conversa ou sido
 * descartada (reação, edição, contato bloqueado...). Contando só as gravadas,
 * a faixa ficava presa em "37 de 38". Nunca lança erro.
 */ async function bumpRecoveryProgress(instanceName) {
  try {
    if (!instanceName) return;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: connection } = await supabase.from("channel_connections").select("id").eq("provider", "evolution").eq("session_name", instanceName).is("archived_at", null).maybeSingle();
    if (!connection) return;
    const { error } = await supabase.rpc("bump_inbound_recovery", {
      p_connection_id: connection.id
    });
    if (error) console.warn("[INBOUND_RECOVERY_BUMP_ERROR]", error);
  } catch (err) {
    console.warn("[INBOUND_RECOVERY_BUMP_ERROR]", err instanceof Error ? err.message : String(err));
  }
}
// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req)=>{
  const recovered = req.headers.get("x-unxet-recovered") === "1" && !!INTERNAL_BOT_SECRET && timingSafeEqual(req.headers.get("x-internal-secret") ?? "", INTERNAL_BOT_SECRET);
  if (!recovered) return await handleWebhook(req);
  const instanceName = await req.clone().json().then((body)=>String(body?.instance ?? "").trim()).catch(()=>"");
  const response = await handleWebhook(req);
  // 200 = tratada (gravada ou descartada); erro volta pela fila e conta depois
  if (response.status === 200) await bumpRecoveryProgress(instanceName);
  return response;
});
async function handleWebhook(req) {
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
    // Mensagem recuperada do histórico da Evolution pelo evolution-connection-sync
    // (_shared/inboundRecovery.ts). Só vale com o segredo interno: entra com o
    // horário original e sem acionar bot nem respostas automáticas.
    const isRecovered = req.headers.get("x-unxet-recovered") === "1" && !!INTERNAL_BOT_SECRET && timingSafeEqual(req.headers.get("x-internal-secret") ?? "", INTERNAL_BOT_SECRET);
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
    // Não entra como mensagem do cliente. Mais abaixo tira o bot da conversa
    // quando a equipe responde pelo celular e, com a opção do número, grava a
    // mensagem na conversa como enviada (handleOwnMessage).
    const isFromMe = body?.data?.key?.fromMe === true;
    // ── Resolve origem da conversa ────────────────────────────────────────
    const remoteJidRaw = body?.data?.key?.remoteJid ?? "";
    // remoteJidAlt — presente em versões >= 2.3.x quando o remetente tem LID
    // Contém o número real no formato "5511999998888@s.whatsapp.net"
    const remoteJidAlt = body?.data?.key?.remoteJidAlt ?? "";
    const participantPn = body?.data?.key?.participantPn ?? "";
    const participant = body?.data?.key?.participant ?? "";
    // ── Grupo: só entra se o número tiver grupos ligados (conferido abaixo,
    // depois de achar a conexão). O autor vem em key.participant. ─────────
    const groupJid = isGroupJid(remoteJidRaw) ? remoteJidRaw : null;
    // ── Ignora Status do WhatsApp, canais e listas de transmissão ─────────
    if (isNonChatJid(remoteJidRaw)) {
      return new Response(JSON.stringify({
        ignored: true,
        reason: "non_chat_message"
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
    // ── Conteúdo desembrulhado (mensagem temporária, visualização única, foto
    // de álbum...). O payload gravado continua o original (body). ─────────
    const data = evolutionData(body);
    // ── Reações: gravam o emoji na mensagem reagida ───────────────────────
    // (fromMe: reação da empresa, feita pelo celular ou eco da enviada pelo Unxet)
    const reaction = evolutionReaction(data);
    if (reaction || data?.message?.reactionMessage) {
      if (reaction && !isRecovered) {
        const applied = await applyReaction(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY), {
          targetProviderId: reaction.targetId,
          emoji: reaction.emoji,
          side: isFromMe ? "agent" : "client"
        });
        console.log("[REACTION]", JSON.stringify({
          targetId: reaction.targetId,
          fromMe: isFromMe,
          applied
        }));
      }
      return new Response(JSON.stringify({
        ignored: true,
        reason: "reaction"
      }), {
        status: 200
      });
    }
    // ── Supabase client ───────────────────────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // ── Edição de mensagem: corrige o texto (ou a legenda) da original ─────
    // e marca como editada. A edição criptografada é decifrada com o
    // messageSecret da original (ver _shared/messageEdit.ts).
    // (só para mensagens: eventos de conexão e QR Code não têm data.message)
    const isMessageEvent = body?.event === "messages.upsert";
    const plainEdit = isMessageEvent ? extractMessageEdit(body?.data?.message) ?? extractMessageEdit(data?.message) : null;
    const secretEdit = isMessageEvent && !plainEdit ? extractSecretEdit(data?.message) : null;
    if (plainEdit || secretEdit) {
      try {
        await applyMessageEdit(supabase, {
          body,
          data,
          isFromMe,
          plainEdit,
          secretEdit
        });
      } catch (err) {
        console.error("[MESSAGE_EDIT_ERROR]", err);
      }
      return new Response(JSON.stringify({
        ignored: true,
        reason: "message_edit"
      }), {
        status: 200
      });
    }
    // ── Voto em enquete: atualiza os votos da enquete ──────────────────────
    const pollUpdate = isMessageEvent ? extractPollUpdate(body?.data?.message) : null;
    if (pollUpdate) {
      try {
        await applyPollVote(supabase, {
          body,
          data,
          isFromMe,
          update: pollUpdate
        });
      } catch (err) {
        console.error("[POLL_VOTE_ERROR]", err);
      }
      return new Response(JSON.stringify({
        ignored: true,
        reason: "poll_vote"
      }), {
        status: 200
      });
    }
    // ── Visualização única: o WhatsApp não entrega o arquivo aos aparelhos
    // conectados (o WhatsApp Web também não mostra), então não é gravada ──
    if (isMessageEvent && isViewOnceMedia(body?.data?.message)) {
      console.log("[VIEW_ONCE_IGNORED]", body?.data?.key?.id ?? null);
      return new Response(JSON.stringify({
        ignored: true,
        reason: "view_once"
      }), {
        status: 200
      });
    }
    // ── Eventos de protocolo (mensagem apagada, fixar etc.) ────────────────
    if (isMessageEvent && isProtocolOnlyMessage(data?.message)) {
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
    const { data: connection, error: connectionError } = await supabase.from("channel_connections").select("id, clinic_id, evolution_api_url, evolution_api_key, groups_enabled, phone_messages_enabled, connected_phone, connected_name").eq("provider", "evolution").eq("session_name", instanceName).is("archived_at", null).maybeSingle();
    // Erro do banco é temporário: 503 faz a fila de entrada tentar de novo.
    // Conexão inexistente (ex.: instância do outro ambiente) é 404 e é descartada.
    if (connectionError) {
      console.error("Connection lookup failed:", connectionError);
      return new Response("Database unavailable", {
        status: 503
      });
    }
    if (!connection) {
      console.warn("Connection not found:", instanceName);
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
      // Na v2 o "qrcode" é um objeto { base64, code, ... }: só a imagem serve para a tela
      const qrCandidates = [
        body?.data?.qrcode?.base64,
        body?.data?.base64,
        body?.qrcode?.base64,
        body?.base64,
        body?.data?.qrcode,
        body?.qrcode
      ];
      const qrCode = qrCandidates.find((value)=>typeof value === "string" && value.startsWith("data:image/")) ?? null;
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
    // ── Grupo ─────────────────────────────────────────────────────────────
    let group = null;
    if (groupJid) {
      // Número sem grupos ligados (a Evolution já devia ter barrado)
      if (connection.groups_enabled !== true) {
        return new Response(JSON.stringify({
          ignored: true,
          reason: "group_message"
        }), {
          status: 200
        });
      }
      // Enviada pelo celular da empresa no grupo: fica só no WhatsApp (v1)
      if (isFromMe) {
        return new Response(JSON.stringify({
          ignored: true,
          reason: "group_from_me"
        }), {
          status: 200
        });
      }
      // Autor: telefone quando o WhatsApp informa; LID tenta resolver; sem
      // número a mensagem entra assim mesmo, só com o nome de quem mandou.
      const sender = groupSender(body?.data?.key);
      let memberPhone = sender.phone;
      if (!memberPhone && sender.lid && connection.evolution_api_url && connection.evolution_api_key) {
        memberPhone = await resolveWaId({
          evolutionApiUrl: connection.evolution_api_url,
          evolutionApiKey: connection.evolution_api_key,
          instanceName,
          remoteJidRaw: sender.lid,
          remoteJidAlt: "",
          currentWaId: ""
        }) || null;
      }
      waId = memberPhone ?? "";
      try {
        group = await ensureWhatsappGroup(supabase, {
          clinicId: connection.clinic_id,
          channelConnectionId: connection.id,
          jid: groupJid,
          evolution: connection.evolution_api_url && connection.evolution_api_key ? {
            apiUrl: connection.evolution_api_url,
            apiKey: connection.evolution_api_key,
            instanceName
          } : null
        });
      } catch (err) {
        // Banco fora: 503 faz a fila de entrada tentar de novo
        console.error("[GROUP_ENSURE_ERROR]", err);
        return new Response("Database unavailable", {
          status: 503
        });
      }
      console.log("[GROUP_MESSAGE]", JSON.stringify({
        groupId: group.id,
        hasPhone: !!memberPhone,
        hasLid: !!sender.lid
      }));
    } else if (connection.evolution_api_url && connection.evolution_api_key) {
      // ── Resolve LID → número real (se necessário) ───────────────────────
      // Feito APÓS buscar a connection pois precisamos das credenciais da Evolution
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
    if (!group && (!waId || !/^\d{10,13}$/.test(waId))) {
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
      const ownMessageTask = handleOwnMessage({
        supabase,
        connection,
        instanceName,
        body,
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
    // ── Contato bloqueado: descarta antes de baixar mídia, criar conversa,
    // acionar bot ou IA (só conta a mensagem barrada) ──────────────────────
    // (no grupo o bloqueio não vale: ele é para a conversa particular)
    if (!group && await registerBlockedInbound(supabase, connection.clinic_id, blockIdentifiers(waId))) {
      console.log("[BLOCKED_CONTACT] mensagem descartada:", {
        clinicId: connection.clinic_id,
        providerMessageId
      });
      return new Response(JSON.stringify({
        ignored: true,
        reason: "blocked_contact"
      }), {
        status: 200
      });
    }
    const profileName = body?.data?.pushName ?? (group ? null : "Cliente");
    const timestampRaw = body?.data?.messageTimestamp;
    const timestamp = timestampRaw ? new Date(Number(timestampRaw) * 1000).toISOString() : new Date().toISOString();
    // ── Conteúdo (tipo, texto, mídia) ─────────────────────────────────────
    const content = parseEvolutionContent(data?.message ?? {}, providerMessageId);
    if (content.unsupported) console.warn("[UNSUPPORTED_MESSAGE_TYPE]", content.unsupported);
    const { messageType, interactive } = content;
    let text = content.text;
    const media = await loadMessageMedia(supabase, {
      connection,
      instanceName,
      data,
      content
    });
    // ── Menções (@) no grupo: "@27307469193361" vira "@Nome" ──────────────
    if (group && text) {
      try {
        const names = await resolveMentionNames({
          supabase,
          connection,
          instanceName,
          groupId: group.id,
          groupJid,
          // A v2 manda o contextInfo em data.contextInfo; o texto é o reserva
          jids: mentionedJids(data, text)
        });
        text = replaceMentions(text, names);
      } catch (err) {
        // Sem nome a mensagem entra como veio
        console.warn("[GROUP_MENTIONS_ERROR]", err);
      }
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
      // Cliente respondeu citando uma mensagem
      replyToProviderId: evolutionQuotedId(data),
      ...media ? {
        media
      } : {},
      ...interactive ? {
        interactive
      } : {},
      ...isRecovered ? {
        recovered: true
      } : {},
      // Grupo: a conversa é do grupo; waId (se houver) é de quem escreveu
      ...group ? {
        group: {
          id: group.id,
          jid: groupJid,
          participantJid: body?.data?.key?.participant ?? null
        }
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
    // (no grupo, a de quem escreveu, se o número for conhecido)
    if (waId && connection.evolution_api_url && connection.evolution_api_key) {
      const profilePicTask = fetchAndStoreProfilePic({
        supabase,
        evolutionApiUrl: connection.evolution_api_url,
        evolutionApiKey: connection.evolution_api_key,
        instanceName,
        waId,
        clinicId: connection.clinic_id
      }).catch((err)=>{
        console.error("Erro ao buscar/salvar profile pic:", err);
      });
      // Mantém a função viva até a foto terminar de ser conferida
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        EdgeRuntime.waitUntil(profilePicTask);
      }
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
}
// ---------------------------------------------------------------------------
// Mensagem enviada pelo próprio número (celular ou WhatsApp Web da empresa)
// ---------------------------------------------------------------------------
// Quem envia pelo Unxet (bot, atendente, agendamento) grava a mensagem com o
// ID do WhatsApp logo depois de a Evolution confirmar o envio. Se depois de
// alguns segundos esse ID não existe em messages, a mensagem saiu do celular:
// uma pessoa assumiu a conversa e o bot sai. Com a opção do número
// (phone_messages_enabled), a mensagem também é gravada na conversa.
async function handleOwnMessage(params) {
  const { supabase, connection, instanceName, body, waId, providerMessageId } = params;
  const saveEnabled = connection.phone_messages_enabled === true;
  const sessions = await findActiveBotSessions(supabase, connection.clinic_id, connection.id, waId);
  // Nada a fazer: não precisa esperar
  if (!sessions.length && !saveEnabled) return;
  const known = await waitForKnownMessage(supabase, providerMessageId);
  if (known !== false) return; // enviada pelo Unxet (ou banco fora: na dúvida, nada muda)
  if (sessions.length) await endBotSessions(supabase, sessions, providerMessageId);
  if (!saveEnabled) return;
  const data = evolutionData(body);
  const content = parseEvolutionContent(data?.message ?? {}, providerMessageId, {
    fromMe: true
  });
  const media = await loadMessageMedia(supabase, {
    connection,
    instanceName,
    data,
    content
  });
  const timestampRaw = body?.data?.messageTimestamp;
  const saved = await savePhoneSentMessage(supabase, {
    clinicId: connection.clinic_id,
    channelConnectionId: connection.id,
    instanceName,
    waId,
    providerMessageId,
    timestampIso: timestampRaw ? new Date(Number(timestampRaw) * 1000).toISOString() : new Date().toISOString(),
    messageType: content.messageType,
    text: content.text,
    media: media ?? null,
    replyToProviderId: evolutionQuotedId(data),
    rawPayload: body
  });
  // Áudio enviado pelo celular também ganha transcrição
  if (saved.saved && content.messageType === "audio") {
    const queued = await queueTranscription(supabase, {
      messageId: saved.messageId,
      storagePath: saved.storagePath
    });
    await queued?.done;
  }
}
async function findActiveBotSessions(supabase, clinicId, channelConnectionId, waId) {
  const { contact, error: contactErr } = await findContactByPhone(supabase, clinicId, waId, "id, phone");
  if (contactErr || !contact) return [];
  const { data: conversations, error: convErr } = await supabase.from("conversations").select("id").eq("clinic_id", clinicId).eq("contact_id", contact.id).eq("channel_connection_id", channelConnectionId);
  if (convErr || !conversations?.length) return [];
  const { data: sessions, error: sessionsErr } = await supabase.from("conversation_bot_sessions").select("id, clinic_id, conversation_id, bot_id, current_node_id").in("conversation_id", conversations.map((c)=>c.id)).eq("channel_connection_id", channelConnectionId).eq("status", "active");
  if (sessionsErr) return [];
  return sessions ?? [];
}
async function endBotSessions(supabase, sessions, providerMessageId) {
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
// Conteúdo da mensagem
// ---------------------------------------------------------------------------
/**
 * Mídia da mensagem. Figurinha já guardada pela empresa não é baixada de novo:
 * volta só o caminho (storagePath) do arquivo existente. Figurinha nova é
 * baixada e vai para esse caminho fixo (ver _shared/stickerStore.ts).
 */ async function loadMessageMedia(supabase, { connection, instanceName, data, content }) {
  if (!content.needsMediaFetch) return undefined;
  const stickerPath = content.stickerHash ? stickerStoragePath(connection.clinic_id, content.stickerHash) : null;
  if (stickerPath && await stickerExists(supabase, stickerPath)) {
    console.log("[STICKER_REUSED]", stickerPath);
    return {
      storagePath: stickerPath,
      mimeType: "image/webp"
    };
  }
  const media = await fetchEvolutionMedia({
    connection,
    instanceName,
    data,
    mediaMessage: content.mediaMessage,
    fallbackFilename: content.fallbackFilename,
    fallbackMimeType: content.fallbackMimeType
  });
  return media && stickerPath ? {
    ...media,
    storagePath: stickerPath
  } : media;
}
/** Baixa a mídia da mensagem pela Evolution (base64). Sem credenciais ou com erro: undefined. */ async function fetchEvolutionMedia(params) {
  const { connection, instanceName, data, fallbackFilename, fallbackMimeType } = params;
  // Só o conteúdo da mídia (sem embrulho): a Evolution não abre todos os
  // embrulhos (ex.: foto de álbum) na hora de baixar
  const mediaMessage = params.mediaMessage ?? data?.message ?? {};
  const providerMessageId = data?.key?.id;
  if (!connection.evolution_api_url || !connection.evolution_api_key) {
    console.warn("Mensagem de mídia recebida mas evolution_api_url/key não configurados na connection:", connection.id);
    return undefined;
  }
  try {
    const base64Resp = await fetch(`${connection.evolution_api_url.replace(/\/$/, "")}/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: connection.evolution_api_key
      },
      body: JSON.stringify({
        message: {
          key: data.key,
          message: mediaMessage
        },
        convertToMp4: false
      })
    });
    if (!base64Resp.ok) {
      console.error("getBase64FromMediaMessage retornou erro:", base64Resp.status, await base64Resp.text());
      return undefined;
    }
    const base64Json = await base64Resp.json();
    const base64Data = base64Json?.base64 ?? null;
    const mimeType = base64Json?.mimeType ?? base64Json?.mimetype ?? mediaMimeType(mediaMessage) ?? fallbackMimeType ?? "application/octet-stream";
    console.log("[MEDIA_MIME_RESOLVED]", {
      mimeType,
      providerMessageId
    });
    if (!base64Data) {
      console.warn("getBase64FromMediaMessage retornou sem base64 para:", providerMessageId);
      return undefined;
    }
    const filename = mediaFilename(mediaMessage) ?? fallbackFilename ?? undefined;
    return {
      base64: base64Data,
      mimeType,
      filename
    };
  } catch (err) {
    console.error("Erro ao buscar mídia da Evolution:", err);
    return undefined;
  }
}
// ---------------------------------------------------------------------------
// Menções (@) em grupos
// ---------------------------------------------------------------------------
const onlyDigits = (value)=>String(value ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");
/** Mesmo número, com ou sem o 9 (55 + DDD iguais e últimos 8 dígitos iguais). */ function samePhone(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 12 && b.length >= 12 && a.slice(0, 4) === b.slice(0, 4) && a.slice(-8) === b.slice(-8);
}
/**
 * Nome de cada pessoa marcada no grupo. Ordem: o próprio número da empresa,
 * o contato da carteira, o nome com que ela já escreveu no grupo e, por fim,
 * o contato guardado na Evolution. Quem não tiver nome fica como veio.
 */ async function resolveMentionNames(params) {
  const { supabase, connection, instanceName, groupId, groupJid, jids } = params;
  const names = new Map();
  if (!jids?.length) return names;
  const apiUrl = String(connection.evolution_api_url ?? "").replace(/\/$/, "");
  const apiKey = connection.evolution_api_key;
  const ownPhone = onlyDigits(connection.connected_phone);
  // LID -> telefone pela lista de participantes do grupo (inclui o próprio
  // número da empresa, que o /chat/whatsappNumbers não resolve)
  const lidPhones = jids.some((jid)=>jid.endsWith("@lid")) && apiUrl && apiKey ? await fetchParticipantPhones(apiUrl, apiKey, instanceName, groupJid) : new Map();
  for (const jid of jids.slice(0, 10)){
    let phone = jid.endsWith("@lid") ? lidPhones.get(jid) ?? "" : onlyDigits(jid);
    if (!/^\d{10,13}$/.test(phone)) phone = "";
    if (!phone && jid.endsWith("@lid") && apiUrl && apiKey) {
      phone = await resolveWaId({
        evolutionApiUrl: apiUrl,
        evolutionApiKey: apiKey,
        instanceName,
        remoteJidRaw: jid,
        remoteJidAlt: "",
        currentWaId: ""
      });
    }
    // 1. O próprio número da empresa
    if (phone && samePhone(phone, ownPhone) && connection.connected_name) {
      names.set(jid, connection.connected_name);
      continue;
    }
    // 2. Contato da carteira
    if (phone) {
      const { contact } = await findContactByPhone(supabase, connection.clinic_id, phone, "id, name");
      if (contact?.name) {
        names.set(jid, contact.name);
        continue;
      }
    }
    // 3. Nome com que a pessoa já escreveu neste grupo
    const senders = [
      jid,
      phone
    ].filter(Boolean);
    const { data: seen } = await supabase.from("messages").select("sender_name, conversations!inner(group_id)").eq("conversations.group_id", groupId).in("sender", senders).not("sender_name", "is", null).order("created_at", {
      ascending: false
    }).limit(1);
    if (seen?.[0]?.sender_name) {
      names.set(jid, seen[0].sender_name);
      continue;
    }
    // 4. Contato guardado na Evolution (pushName)
    if (apiUrl && apiKey) {
      try {
        const resp = await fetch(`${apiUrl}/chat/findContacts/${instanceName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: apiKey
          },
          body: JSON.stringify({
            where: {
              remoteJid: jid
            }
          }),
          signal: AbortSignal.timeout(5000)
        });
        if (resp.ok) {
          const list = await resp.json();
          const found = (Array.isArray(list) ? list : []).find((c)=>c?.remoteJid === jid || c?.id === jid);
          const pushName = String(found?.pushName ?? "").trim();
          if (pushName) names.set(jid, pushName);
        } else {
          await resp.body?.cancel?.();
        }
      } catch (err) {
        console.warn("[MENTION_FIND_CONTACT_FAILED]", jid, err instanceof Error ? err.message : String(err));
      }
    }
  }
  console.log("[GROUP_MENTIONS]", JSON.stringify({
    jids,
    participantsMapped: lidPhones.size,
    named: [
      ...names.keys()
    ]
  }));
  return names;
}
async function fetchParticipantPhones(apiUrl, apiKey, instanceName, groupJid) {
  try {
    const resp = await fetch(`${apiUrl}/group/participants/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`, {
      method: "GET",
      headers: {
        apikey: apiKey
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!resp.ok) {
      console.warn("[GROUP_PARTICIPANTS_FAILED]", resp.status, await resp.text().catch(()=>""));
      return new Map();
    }
    return participantPhones(await resp.json());
  } catch (err) {
    console.warn("[GROUP_PARTICIPANTS_ERROR]", err instanceof Error ? err.message : String(err));
    return new Map();
  }
}
// ---------------------------------------------------------------------------
// Profile pic: busca na Evolution API e faz upsert no bucket + contacts
// ---------------------------------------------------------------------------
// Confere a foto a cada mensagem, com intervalo mínimo por contato (ver
// _shared/profilePicture.ts): o cliente que troca a foto aparece atualizado.
const shouldCheckProfilePic = createCheckThrottle();
async function fetchAndStoreProfilePic(params) {
  const { supabase, evolutionApiUrl, evolutionApiKey, instanceName, waId, clinicId } = params;
  if (!shouldCheckProfilePic(`${clinicId}:${waId}`)) return;
  // 1. Contato (criado pelo shared-in-config antes de chegar aqui)
  const { contact: existingContact } = await findContactByPhone(supabase, clinicId, waId, "id, phone, image_url");
  if (!existingContact?.id) return;
  const folder = profilePicFolder(clinicId, waId);
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
    // Cliente tirou a foto (ou escondeu): some também no Unxet
    if (existingContact.image_url?.includes(`/${folder}/`)) {
      await supabase.from("contacts").update({
        image_url: null
      }).eq("id", existingContact.id);
      await removeOldProfilePics(supabase, folder, null);
    }
    return;
  }
  // 3. Baixa a imagem
  const imgResp = await fetch(profilePicUrl);
  if (!imgResp.ok || !imgResp.body) {
    console.warn(`Falha ao baixar profile pic de ${waId}`);
    return;
  }
  const arrayBuffer = await imgResp.arrayBuffer();
  const contentType = imgResp.headers.get("content-type") ?? "image/jpeg";
  // 4. Mesma imagem de antes? Nada a fazer
  const storagePath = profilePicPath(clinicId, waId, await imageHash(arrayBuffer), contentType);
  if (isCurrentProfilePic(existingContact.image_url, storagePath)) return;
  // 5. Upload no bucket (nome novo a cada foto nova, sem cache antigo)
  const { error: uploadError } = await supabase.storage.from(PROFILE_PIC_BUCKET).upload(storagePath, arrayBuffer, {
    contentType: safeStorageContentType(contentType),
    upsert: true
  });
  if (uploadError) {
    console.error("Erro ao fazer upload da profile pic:", uploadError);
    return;
  }
  const { data: publicData } = supabase.storage.from(PROFILE_PIC_BUCKET).getPublicUrl(storagePath);
  const publicUrl = publicData?.publicUrl;
  if (!publicUrl) return;
  // 6. Atualiza contacts.image_url e apaga as fotos anteriores
  const { error: updateErr } = await supabase.from("contacts").update({
    image_url: publicUrl
  }).eq("id", existingContact.id);
  if (updateErr) {
    console.error("Erro ao atualizar image_url no contato:", updateErr);
    return;
  }
  console.log(`Foto de perfil atualizada para ${waId}`);
  await removeOldProfilePics(supabase, folder, storagePath);
}
async function removeOldProfilePics(supabase, folder, keepPath) {
  const { data: files, error } = await supabase.storage.from(PROFILE_PIC_BUCKET).list(folder);
  if (error || !files?.length) return;
  const stale = files.map((f)=>`${folder}/${f.name}`).filter((p)=>p !== keepPath);
  if (!stale.length) return;
  const { error: removeErr } = await supabase.storage.from(PROFILE_PIC_BUCKET).remove(stale);
  if (removeErr) console.warn("Erro ao apagar fotos antigas:", removeErr);
}
