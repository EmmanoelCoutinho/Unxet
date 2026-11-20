// deno-lint-ignore-file
// @ts-nocheck
// Mensagens enviadas pelo celular da empresa (WhatsApp via QR Code).
//
// A Evolution avisa (messages.upsert com fromMe) tanto as mensagens enviadas
// pelo Unxet quanto as digitadas no celular ou no WhatsApp Web. Quem envia
// pelo Unxet (atendente, bot, IA, campanha, agendamento) grava a mensagem com
// o ID do WhatsApp logo depois de a Evolution confirmar o envio. Se depois de
// alguns segundos esse ID não existe em messages, a mensagem saiu do celular.
//
// Com channel_connections.phone_messages_enabled ligada, ela é gravada na
// conversa do cliente como enviada, com o nome "Pelo celular".
import { findContactByPhone } from "./startConversation.ts";
import { findByProviderId, replyColumns } from "./messageReply.ts";
import { loadConnectionDepartment, pickDefaultDepartmentId } from "./connectionDepartment.ts";
import { safeStorageContentType } from "./storageContentType.ts";
import { isClinicStickerPath } from "./stickerStore.ts";
// (sem transcription.ts aqui: ele lê Deno.env e o módulo é testado no Vitest;
// quem chama cria a transcrição do áudio com o storagePath devolvido)

/** Nome que aparece no balão (no lugar do nome do atendente). */
export const PHONE_SENDER_NAME = "Pelo celular";

const MEDIA_BUCKET = "whatsapp-media";

// Espera total ~15s: tempo de o envio pelo Unxet gravar a mensagem
export const OWN_MESSAGE_CHECK_DELAYS_MS = [0, 3000, 4000, 8000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * true quando a mensagem foi enviada pelo Unxet (já está em messages),
 * false quando saiu do celular, null se o banco falhou (na dúvida, nada muda).
 */
export async function waitForKnownMessage(
  supabase,
  providerMessageId: string,
  delays = OWN_MESSAGE_CHECK_DELAYS_MS,
): Promise<boolean | null> {
  for (const delay of delays) {
    if (delay) await sleep(delay);
    const { data, error } = await supabase
      .from("messages")
      .select("id")
      .eq("meta_message_id", providerMessageId)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[OWN_MESSAGE_LOOKUP_ERROR]", error);
      return null;
    }
    if (data) return true;
  }
  return false;
}

/**
 * Mudanças na conversa quando a empresa responde pelo celular: igual ao envio
 * pelo Unxet (zera o prazo de 1ª resposta), sem mexer no status. Mensagem
 * mais antiga que a última da conversa não faz a conversa voltar no tempo.
 */
export function phoneMessageConversationUpdates(
  conversation: {
    last_message_at?: string | null;
    last_outbound_at?: string | null;
    first_outbound_at?: string | null;
  },
  timestampIso: string,
  nowIso = new Date().toISOString(),
) {
  const latest = (current?: string | null) =>
    current && new Date(current) > new Date(timestampIso) ? current : timestampIso;
  const updates: Record<string, unknown> = {
    updated_at: nowIso,
    last_message_at: latest(conversation.last_message_at),
    last_outbound_at: latest(conversation.last_outbound_at),
    first_unanswered_inbound_at: null,
  };
  if (!conversation.first_outbound_at) updates.first_outbound_at = timestampIso;
  return updates;
}

/** Extensão do arquivo pelo nome ou pelo tipo. */
export function mediaExtension(mimeType: string | null | undefined, filename?: string | null) {
  const fromName = String(filename ?? "").split(".");
  if (fromName.length > 1 && fromName[fromName.length - 1]) return fromName[fromName.length - 1];
  const type = String(mimeType ?? "").toLowerCase();
  if (type.includes("pdf")) return "pdf";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("mp4")) return "mp4";
  return "bin";
}

function decodeBase64(value: string) {
  const clean = value.includes("base64,") ? value.split("base64,")[1] : value;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Conversa mais recente do cliente neste número; sem nenhuma, cria encerrada. */
async function findOrCreateConversation(supabase, params) {
  const { clinicId, channelConnectionId, contactId, timestampIso } = params;
  const { data: found, error } = await supabase
    .from("conversations")
    .select("id, status, last_message_at, last_outbound_at, first_outbound_at")
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .eq("channel_connection_id", channelConnectionId)
    .in("status", ["open", "pending", "closed"])
    .order("last_message_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`conversation_lookup: ${error.message}`);
  if (found?.[0]) return found[0];

  // Conversa iniciada pelo celular: fica no histórico, encerrada. Quando o
  // cliente responder, ela reabre (ou abre outra) como qualquer conversa.
  const [{ data: clinicDept }, connectionDepartment] = await Promise.all([
    supabase
      .from("departments")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("is_default", true)
      .eq("is_active", true)
      .maybeSingle(),
    loadConnectionDepartment(supabase, channelConnectionId),
  ]);
  const departmentId = pickDefaultDepartmentId(connectionDepartment, clinicId, clinicDept?.id ?? null);
  if (!departmentId) throw new Error("no_default_department");

  const nowIso = new Date().toISOString();
  const { data: created, error: createErr } = await supabase
    .from("conversations")
    .insert({
      contact_id: contactId,
      clinic_id: clinicId,
      channel: "whatsapp",
      channel_connection_id: channelConnectionId,
      department_id: departmentId,
      status: "closed",
      closed_at: timestampIso,
      last_message_at: timestampIso,
      status_changed_at: nowIso,
    })
    .select("id, status, last_message_at, last_outbound_at, first_outbound_at")
    .maybeSingle();
  if (createErr || !created) throw new Error(`conversation_create: ${createErr?.message ?? "empty"}`);
  return created;
}

/**
 * Grava na conversa do cliente uma mensagem enviada pelo celular da empresa.
 * Não aciona bot, IA, notificação nem reabre a conversa.
 */
export async function savePhoneSentMessage(
  supabase,
  params: {
    clinicId: string;
    channelConnectionId: string;
    instanceName: string;
    waId: string;
    providerMessageId: string;
    timestampIso: string;
    messageType: string;
    text: string;
    /** storagePath: figurinha da empresa (sem base64 = arquivo já guardado) */
    media?: { base64?: string; mimeType?: string | null; filename?: string | null; storagePath?: string | null } | null;
    replyToProviderId?: string | null;
    rawPayload?: unknown;
  },
) {
  const { clinicId, channelConnectionId, instanceName, waId, providerMessageId, timestampIso, messageType, text, media } =
    params;

  // Contato: o nome do WhatsApp (pushName) aqui é o da empresa, não serve
  const { contact: found, error: contactErr } = await findContactByPhone(supabase, clinicId, waId, "id");
  if (contactErr) throw new Error(`contact_lookup: ${contactErr.message}`);
  let contactId = found?.id ?? null;
  if (!contactId) {
    const { data: created, error: createErr } = await supabase
      .from("contacts")
      .insert({
        phone: waId,
        name: null,
        clinic_id: clinicId,
        meta_contact_id: waId,
        first_seen_at: timestampIso,
        last_seen_at: timestampIso,
      })
      .select("id")
      .limit(1);
    if (createErr || !created?.[0]?.id) throw new Error(`contact_create: ${createErr?.message ?? "empty"}`);
    contactId = created[0].id;
  }

  const conversation = await findOrCreateConversation(supabase, {
    clinicId,
    channelConnectionId,
    contactId,
    timestampIso,
  });

  // Mídia: mesmo bucket das recebidas, numa pasta de enviadas
  let mediaUrl: string | null = null;
  let storagePath: string | null = null;
  let mimeType = media?.mimeType ?? null;
  const stickerPath = isClinicStickerPath(media?.storagePath, clinicId) ? media!.storagePath! : null;
  if (stickerPath && !media?.base64) {
    storagePath = stickerPath;
    mediaUrl = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(stickerPath).data?.publicUrl ?? null;
  } else if (media?.base64) {
    try {
      const bytes = decodeBase64(media.base64);
      const ext = mediaExtension(mimeType, media.filename);
      const messageFolder = providerMessageId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
      const fileName = String(media.filename ?? "").trim() || `${messageFolder}.${ext}`;
      storagePath = stickerPath ?? `${clinicId}/${waId}/phone-sent/${messageFolder}/${fileName}`;
      const { error: uploadErr } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(storagePath, bytes, { contentType: safeStorageContentType(mimeType), upsert: true });
      if (uploadErr) {
        console.error("[PHONE_MESSAGE_UPLOAD_ERROR]", uploadErr);
        storagePath = null;
      } else {
        mediaUrl = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath).data?.publicUrl ?? null;
      }
    } catch (err) {
      console.error("[PHONE_MESSAGE_MEDIA_ERROR]", err);
      storagePath = null;
    }
  }

  const row: Record<string, unknown> = {
    conversation_id: conversation.id,
    direction: "outbound",
    type: messageType,
    meta_message_id: providerMessageId,
    sender: instanceName,
    receiver: waId,
    text: text ?? "",
    payload: params.rawPayload ?? null,
    sent_at: timestampIso,
    created_at: timestampIso,
    sender_user_id: null,
    sender_name: PHONE_SENDER_NAME,
    is_automated: false,
    ...replyColumns(await findByProviderId(supabase, conversation.id, params.replyToProviderId)),
  };
  if (mediaUrl) {
    if (messageType === "image" || messageType === "sticker") row.image_url = mediaUrl;
    else row.media_url = mediaUrl;
    if (mimeType) row.media_mime_type = mimeType;
    if (messageType === "document" && media?.filename) row.filename = media.filename;
  }

  // Corrida com outra entrega do mesmo webhook: confere de novo antes de gravar
  const { data: already } = await supabase
    .from("messages")
    .select("id")
    .eq("meta_message_id", providerMessageId)
    .limit(1)
    .maybeSingle();
  if (already) return { saved: false, reason: "duplicate" };

  const { data: inserted, error: insertErr } = await supabase.from("messages").insert(row).select("id").maybeSingle();
  if (insertErr || !inserted?.id) throw new Error(`message_insert: ${insertErr?.message ?? "empty"}`);

  const { error: convErr } = await supabase
    .from("conversations")
    .update(phoneMessageConversationUpdates(conversation, timestampIso))
    .eq("id", conversation.id);
  if (convErr) console.error("[PHONE_MESSAGE_CONVERSATION_UPDATE_ERROR]", convErr);

  console.log(
    "[PHONE_MESSAGE_SAVED]",
    JSON.stringify({ messageId: inserted.id, conversationId: conversation.id, messageType, hasMedia: !!mediaUrl }),
  );
  return { saved: true, messageId: inserted.id, conversationId: conversation.id, storagePath };
}
