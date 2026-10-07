// deno-lint-ignore-file
// @ts-nocheck
/**
 * delete-message — apaga (exclusão lógica) uma mensagem enviada pelo atendente.
 *
 * - Evolution (WhatsApp via QR Code): apaga também no WhatsApp do cliente
 *   ("apagar para todos"). O WhatsApp só permite isso por tempo limitado.
 * - Meta (WhatsApp oficial, Instagram, Messenger): a API não permite apagar
 *   mensagem entregue; a mensagem é removida apenas do Unxet.
 *
 * Em todos os casos a linha é mantida (deleted_at/deleted_by) para auditoria.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser, getClinicMembership } from "../_shared/security.ts";

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

    const { messageId } = await req.json().catch(() => ({}));
    if (!messageId) return json(400, { error: "messageId is required" });

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
        meta_message_id,
        payload,
        receiver,
        deleted_at,
        conversations (
          id,
          clinic_id,
          assigned_user_id,
          channel,
          contacts ( phone ),
          channel_connections ( id, provider, session_name, evolution_api_url, evolution_api_key )
        )
      `)
      .eq("id", messageId)
      .maybeSingle();

    if (messageError || !message?.conversations) {
      return json(404, { error: "Message not found" });
    }

    const conversation = message.conversations;

    // Autorização: admin da clínica ou responsável pela conversa
    const membership = await getClinicMembership(admin, user.id, conversation.clinic_id);
    const allowed = !!membership && (
      membership.role === "admin" || conversation.assigned_user_id === user.id
    );
    if (!allowed) return json(403, { error: "Not allowed" });

    if (message.direction !== "outbound") {
      return json(400, { error: "Only sent messages can be deleted" });
    }
    if (message.deleted_at) {
      return json(200, { success: true, alreadyDeleted: true });
    }

    const connection = conversation.channel_connections;
    let deletedForEveryone = false;

    if (connection?.provider === "evolution") {
      const baseUrl = String(connection.evolution_api_url ?? "").replace(/\/$/, "");
      const apiKey = connection.evolution_api_key;
      const session = connection.session_name;

      const payload = typeof message.payload === "string"
        ? JSON.parse(message.payload)
        : message.payload ?? {};
      const key = payload?.key ?? {};
      const providerId = key.id ?? message.meta_message_id;
      const remoteJid = key.remoteJid ?? toRemoteJid(message.receiver ?? conversation.contacts?.phone);

      if (!baseUrl || !apiKey || !session || !providerId || !remoteJid) {
        return json(422, { error: "Não foi possível identificar a mensagem no WhatsApp." });
      }

      const resp = await fetch(`${baseUrl}/chat/deleteMessageForEveryone/${session}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({ id: providerId, remoteJid, fromMe: true })
      });

      if (!resp.ok) {
        console.error("[DELETE_MESSAGE_EVOLUTION_ERROR]", resp.status, await resp.text());
        return json(502, {
          error: "O WhatsApp não permitiu apagar esta mensagem (mensagens antigas não podem ser apagadas para todos)."
        });
      }

      deletedForEveryone = true;
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("messages")
      .update({
        deleted_at: now,
        deleted_by: user.id,
        deleted_for_everyone: deletedForEveryone
      })
      .eq("id", message.id);

    if (updateError) {
      console.error("[DELETE_MESSAGE_UPDATE_ERROR]", updateError);
      return json(500, { error: "Failed to delete message" });
    }

    await admin.from("conversation_events").insert({
      conversation_id: conversation.id,
      event_type: "message_deleted",
      performed_by: user.id,
      metadata: {
        message_id: message.id,
        deleted_for_everyone: deletedForEveryone,
        provider: connection?.provider ?? null
      }
    });

    return json(200, { success: true, deletedForEveryone });
  } catch (error) {
    console.error("[DELETE_MESSAGE_UNEXPECTED]", error);
    return json(500, { error: "Internal error" });
  }
});
