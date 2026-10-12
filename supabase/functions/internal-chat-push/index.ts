// deno-lint-ignore-file
// @ts-nocheck
/**
 * internal-chat-push — notificação push de uma mensagem do chat interno.
 *
 * O front grava a mensagem direto na tabela (RLS) e chama esta função com o id.
 * Só o autor de uma mensagem recente consegue disparar o aviso, e uma única
 * vez (push_notified_at). Quem recebe: a outra pessoa na conversa direta, ou
 * toda a equipe da clínica no canal geral.
 *
 * Como nas mensagens de clientes, o texto nunca vai na notificação.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser } from "../_shared/security.ts";
import { sendPushToUsers } from "../_shared/push.ts";

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

// Mensagem mais antiga que isso não gera aviso (ninguém "reenvia" push antigo)
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;

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
    if (!messageId || typeof messageId !== "string") {
      return json(400, { error: "messageId is required" });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: message, error: messageError } = await admin
      .from("internal_chat_messages")
      .select(`
        id,
        thread_id,
        clinic_id,
        sender_id,
        created_at,
        push_notified_at,
        thread:internal_chat_threads ( id, kind, user_a, user_b )
      `)
      .eq("id", messageId)
      .maybeSingle();

    if (messageError || !message?.thread || message.sender_id !== user.id) {
      return json(404, { error: "Message not found" });
    }

    if (Date.now() - new Date(message.created_at).getTime() > MAX_MESSAGE_AGE_MS) {
      return json(200, { success: true, skipped: "too_old" });
    }

    // Reserva o envio: chamadas repetidas para a mesma mensagem não notificam de novo
    const { data: claimed, error: claimError } = await admin
      .from("internal_chat_messages")
      .update({ push_notified_at: new Date().toISOString() })
      .eq("id", message.id)
      .is("push_notified_at", null)
      .select("id");

    if (claimError) {
      console.error("[INTERNAL_CHAT_PUSH_CLAIM_ERROR]", claimError);
      return json(500, { error: "Internal error" });
    }
    if (!claimed?.length) {
      return json(200, { success: true, skipped: "already_notified" });
    }

    const { data: clinicUsers, error: usersError } = await admin
      .from("clinic_users")
      .select("user_id, name, email")
      .eq("clinic_id", message.clinic_id);

    if (usersError) {
      console.error("[INTERNAL_CHAT_PUSH_USERS_ERROR]", usersError);
      return json(500, { error: "Internal error" });
    }

    const sender = (clinicUsers ?? []).find((cu) => cu.user_id === user.id);
    const senderName = sender?.name || sender?.email || "Equipe";
    const thread = message.thread;
    const isGeneral = thread.kind === "general";

    const recipients = isGeneral
      ? (clinicUsers ?? []).map((cu) => cu.user_id).filter((id) => id !== user.id)
      : [thread.user_a, thread.user_b].filter((id) => id && id !== user.id);

    await sendPushToUsers(admin, recipients, {
      title: isGeneral ? "Chat interno · Geral" : senderName,
      body: isGeneral
        ? `${senderName} enviou uma mensagem`
        : "Nova mensagem no chat interno",
      conversationId: `team:${thread.id}`,
      url: `/inbox/team/${thread.id}`
    });

    return json(200, { success: true, recipients: recipients.length });
  } catch (error) {
    console.error("[INTERNAL_CHAT_PUSH_UNEXPECTED]", error);
    return json(500, { error: "Internal error" });
  }
});
