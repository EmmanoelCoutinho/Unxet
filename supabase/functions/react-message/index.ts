// deno-lint-ignore-file
// @ts-nocheck
/**
 * react-message — reação da empresa a uma mensagem (menu da setinha no balão).
 *
 * Body: { messageId, emoji } — emoji vazio remove a reação.
 *
 * - Evolution (WhatsApp via QR Code): /message/sendReaction
 * - WhatsApp oficial (Meta): mensagem do tipo "reaction"
 * Instagram e Messenger não têm reação pelo Unxet.
 *
 * Quem pode: quem pode responder a conversa (mesma regra do envio).
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser, getClinicMembership } from "../_shared/security.ts";
import { isConversationParticipant } from "../_shared/conversationParticipants.ts";
import { clinicIsSuspended } from "../_shared/plan.ts";
import { evolutionQuoted, normalizeReaction } from "../_shared/messageReply.ts";
import { evolutionRecipient } from "../_shared/whatsappGroups.ts";

const META_WABA_TOKEN = Deno.env.get("META_WABA_TOKEN") ?? "";

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

    const body = await req.json().catch(() => ({}));
    const messageId = String(body?.messageId ?? "").trim();
    if (!messageId) return json(400, { error: "messageId is required" });
    const rawEmoji = String(body?.emoji ?? "").trim();
    const emoji = normalizeReaction(rawEmoji);
    if (rawEmoji && !emoji) return json(400, { error: "Reação inválida" });

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
        meta_message_id,
        sender_name,
        deleted_at,
        payload,
        conversations (
          id,
          clinic_id,
          department_id,
          assigned_user_id,
          whatsapp_number_id,
          channel,
          contacts ( phone, blocked_at ),
          whatsapp_groups ( jid ),
          channel_connections (
            id, provider, channel, archived_at, session_name,
            evolution_api_url, evolution_api_key, meta_phone_number_id, access_token
          )
        )
      `)
      .eq("id", messageId)
      .maybeSingle();

    if (messageError || !message?.conversations) {
      return json(404, { error: "Message not found" });
    }
    const conversation = message.conversations;

    // Mesma regra do envio: conversa atribuída → responsável e adicionados;
    // sem responsável → membros do departamento
    const membership = await getClinicMembership(admin, user.id, conversation.clinic_id);
    let allowed = !!membership;
    if (allowed && conversation.assigned_user_id) {
      allowed = conversation.assigned_user_id === user.id ||
        await isConversationParticipant(admin, conversation.id, user.id);
    } else if (allowed) {
      const { data: deptMember } = await admin
        .from("department_members")
        .select("department_id")
        .eq("department_id", conversation.department_id)
        .eq("clinic_user_id", user.id)
        .maybeSingle();
      allowed = !!deptMember;
    }
    if (allowed && await clinicIsSuspended(admin, conversation.clinic_id)) allowed = false;
    if (!allowed) return json(403, { error: "Not allowed" });

    if (conversation.contacts?.blocked_at) {
      return json(409, { error: "Contato bloqueado." });
    }
    if (message.deleted_at || !message.meta_message_id) {
      return json(422, { error: "Não é possível reagir a esta mensagem." });
    }

    const connection = conversation.channel_connections;
    if (!connection || connection.archived_at) {
      return json(400, { error: "O número de WhatsApp desta conversa foi removido da empresa." });
    }
    const phone = String(conversation.contacts?.phone ?? "").replace(/\D/g, "");

    if (connection.provider === "evolution") {
      const baseUrl = String(connection.evolution_api_url ?? "").replace(/\/$/, "");
      if (!baseUrl || !connection.evolution_api_key || !connection.session_name) {
        return json(422, { error: "Conexão do WhatsApp incompleta." });
      }
      const { key } = evolutionQuoted(message, evolutionRecipient(conversation)?.remoteJid ?? `${phone}@s.whatsapp.net`);
      const resp = await fetch(`${baseUrl}/message/sendReaction/${connection.session_name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: connection.evolution_api_key },
        body: JSON.stringify({ key, reaction: emoji ?? "" })
      });
      if (!resp.ok) {
        console.error("[REACT_EVOLUTION_ERROR]", resp.status, await resp.text());
        return json(502, { error: "O WhatsApp não aceitou a reação." });
      }
    } else if (connection.provider === "meta" && conversation.channel === "whatsapp") {
      let phoneNumberId = connection.meta_phone_number_id ?? null;
      if (!phoneNumberId) {
        let numberQuery = admin
          .from("whatsapp_numbers")
          .select("meta_phone_number_id")
          .eq("clinic_id", conversation.clinic_id);
        numberQuery = conversation.whatsapp_number_id
          ? numberQuery.eq("id", conversation.whatsapp_number_id)
          : numberQuery.eq("channel_connection_id", connection.id);
        const { data: waNumber } = await numberQuery.limit(1).maybeSingle();
        phoneNumberId = waNumber?.meta_phone_number_id ?? null;
      }
      const token = String(connection.access_token ?? "").trim() || META_WABA_TOKEN.trim();
      if (!phoneNumberId || !token || !phone) {
        return json(422, { error: "Número do WhatsApp não configurado." });
      }
      const resp = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "reaction",
          reaction: { message_id: message.meta_message_id, emoji: emoji ?? "" }
        })
      });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => null);
        console.error("[REACT_META_ERROR]", resp.status, JSON.stringify(detail));
        // Fora da janela de 24h a Meta recusa qualquer mensagem livre
        return json(502, {
          error: "O WhatsApp não aceitou a reação. Fora da janela de 24h só é possível enviar modelos."
        });
      }
    } else {
      return json(400, { error: "Este canal não permite reagir pelo Unxet." });
    }

    const { error: updateError } = await admin
      .from("messages")
      .update({ agent_reaction: emoji, agent_reaction_by: emoji ? user.id : null })
      .eq("id", message.id);
    if (updateError) {
      console.error("[REACT_UPDATE_ERROR]", updateError);
      return json(500, { error: "A reação foi enviada, mas não foi salva no histórico." });
    }

    return json(200, { success: true, emoji });
  } catch (error) {
    console.error("[REACT_MESSAGE_UNEXPECTED]", error);
    return json(500, { error: "Internal error" });
  }
});
