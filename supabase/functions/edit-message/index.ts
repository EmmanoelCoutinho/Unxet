// deno-lint-ignore-file
// @ts-nocheck
/**
 * edit-message — edita uma mensagem de texto enviada pelo atendente.
 *
 * Só WhatsApp via QR Code (Evolution): a API oficial da Meta e o Instagram/
 * Messenger não permitem editar mensagem enviada. O WhatsApp só aceita a
 * edição até 15 minutos depois do envio, e só de texto.
 *
 * Quem edita: quem enviou a mensagem (sender_user_id), desde que ainda tenha
 * acesso à conversa. O cliente recebe o texto novo com o nome do atendente
 * na 1ª linha, como no envio; no banco o texto fica sem o nome.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser, getClinicMembership, hasClinicPermission } from "../_shared/security.ts";
import { isConversationParticipant } from "../_shared/conversationParticipants.ts";
import { loadAgentSender, signText } from "../_shared/agentSignature.ts";
import { EDIT_WINDOW_MS, MAX_EDIT_TEXT_LENGTH, editBlockReason } from "../_shared/outboundEdit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

const toRemoteJid = (phone: string | null | undefined) => {
  if (typeof phone === "string" && phone.endsWith("@g.us")) return phone;
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return json(401, { error: "Unauthorized" });

    const { messageId, text: rawText } = await req.json().catch(() => ({}));
    const text = String(rawText ?? "").trim();
    if (!messageId) return json(400, { error: "messageId is required" });
    if (!text) return json(400, { error: "Escreva o texto novo da mensagem." });
    if (text.length > MAX_EDIT_TEXT_LENGTH) {
      return json(400, { error: "O texto ficou longo demais para o WhatsApp." });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: message, error: messageError } = await admin
      .from("messages")
      .select(`
        id,
        conversation_id,
        direction,
        type,
        text,
        original_text,
        meta_message_id,
        payload,
        receiver,
        sent_at,
        created_at,
        deleted_at,
        sender_user_id,
        media_url,
        conversations (
          id,
          clinic_id,
          assigned_user_id,
          department_id,
          contacts ( phone ),
          whatsapp_groups ( jid ),
          channel_connections ( id, provider, session_name, evolution_api_url, evolution_api_key, archived_at )
        )
      `)
      .eq("id", messageId)
      .maybeSingle();

    if (messageError || !message?.conversations) {
      return json(404, { error: "Message not found" });
    }
    const conversation = message.conversations;

    // Só quem enviou, e se ainda atende a conversa
    const membership = await getClinicMembership(admin, user.id, conversation.clinic_id);
    const allowed = !!membership && message.sender_user_id === user.id && (
      membership.role === "admin" ||
      conversation.assigned_user_id === user.id ||
      await isConversationParticipant(admin, conversation.id, user.id) ||
      await hasClinicPermission(admin, user.id, conversation.clinic_id, "conversations.all")
    );
    if (!allowed) return json(403, { error: "Só quem enviou a mensagem pode editá-la." });

    const connection = conversation.channel_connections;
    const blocked = editBlockReason({
      direction: message.direction,
      type: message.type,
      deletedAt: message.deleted_at,
      hasMedia: !!message.media_url,
      payload: typeof message.payload === "string" ? JSON.parse(message.payload) : message.payload,
      sentAt: message.sent_at ?? message.created_at,
      provider: connection?.provider ?? null,
      now: Date.now()
    });
    if (blocked) return json(400, { error: blocked });
    if (text === String(message.text ?? "").trim()) {
      return json(200, { success: true, unchanged: true });
    }
    if (connection.archived_at) {
      return json(400, { error: "O número de WhatsApp desta conversa foi removido da empresa." });
    }

    const baseUrl = String(connection.evolution_api_url ?? "").replace(/\/$/, "");
    const apiKey = connection.evolution_api_key;
    const session = connection.session_name;
    const payload = typeof message.payload === "string" ? JSON.parse(message.payload) : message.payload ?? {};
    const key = payload?.key ?? {};
    const providerId = key.id ?? message.meta_message_id;
    const remoteJid = key.remoteJid ??
      toRemoteJid(conversation.whatsapp_groups?.jid ?? message.receiver ?? conversation.contacts?.phone);
    if (!baseUrl || !apiKey || !session || !providerId || !remoteJid) {
      return json(422, { error: "Não foi possível identificar a mensagem no WhatsApp." });
    }

    // Mesma assinatura do envio (nome do atendente na 1ª linha)
    const sender = await loadAgentSender(admin, user.id, conversation.clinic_id);
    const outboundText = sender.sign ? signText(text, sender.name, { bold: true }) : text;

    const resp = await fetch(`${baseUrl}/chat/updateMessage/${session}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        number: remoteJid.endsWith("@g.us") ? remoteJid : remoteJid.split("@")[0],
        key: { remoteJid, fromMe: true, id: providerId },
        text: outboundText
      })
    });
    if (!resp.ok) {
      console.error("[EDIT_MESSAGE_EVOLUTION_ERROR]", resp.status, await resp.text());
      return json(502, {
        error: `O WhatsApp não permitiu editar esta mensagem (só dá para editar até ${EDIT_WINDOW_MS / 60000} minutos depois do envio).`
      });
    }

    const editedAt = new Date().toISOString();
    const update = {
      text,
      edited_at: editedAt,
      edit_unreadable: false,
      original_text: message.original_text ?? message.text ?? null
    };
    const { error: updateError } = await admin.from("messages").update(update).eq("id", message.id);
    if (updateError) {
      // A edição já chegou ao cliente: avisa, mas não como falha do envio
      console.error("[EDIT_MESSAGE_UPDATE_ERROR]", updateError);
      return json(200, { success: true, persisted: false });
    }

    console.log("[MESSAGE_EDITED]", JSON.stringify({ messageId: message.id, userId: user.id }));
    return json(200, { success: true, ...update });
  } catch (error) {
    console.error("[EDIT_MESSAGE_UNEXPECTED]", error);
    return json(500, { error: "Internal error" });
  }
});
