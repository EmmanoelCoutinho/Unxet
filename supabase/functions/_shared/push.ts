// deno-lint-ignore-file
// @ts-nocheck
// Notificações push (Web Push) para mensagens recebidas de clientes.
//
// Quem recebe segue a mesma regra de visibilidade do RLS
// (can_access_conversation): com responsável, só ele; sem responsável, os
// membros do departamento da conversa e os admins da clínica.

import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";

// Sem as três variáveis o envio fica desligado (no-op).
const PUSH_ENABLED = !!VAPID_PUBLIC_KEY && !!VAPID_PRIVATE_KEY && !!VAPID_SUBJECT;
if (PUSH_ENABLED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const BODY_MAX_LENGTH = 140;

const MEDIA_LABELS: Record<string, string> = {
  image: "📷 Foto",
  audio: "🎤 Áudio",
  video: "🎥 Vídeo",
  document: "📄 Documento",
  sticker: "Figurinha",
};

function buildBody(messageType: string | null, text: string | null) {
  const trimmed = (text ?? "").trim();
  const label = MEDIA_LABELS[messageType ?? ""];
  if (label && trimmed) return truncate(`${label}: ${trimmed}`);
  if (label) return label;
  return truncate(trimmed || "Nova mensagem");
}

function truncate(value: string) {
  return value.length > BODY_MAX_LENGTH ? `${value.slice(0, BODY_MAX_LENGTH - 1)}…` : value;
}

async function resolveRecipients(supabase, conversation) {
  if (conversation.assigned_user_id) return [conversation.assigned_user_id];

  const { data: clinicUsers, error } = await supabase
    .from("clinic_users")
    .select("user_id, role, department_id")
    .eq("clinic_id", conversation.clinic_id);
  if (error) throw error;

  const { data: members, error: membersErr } = await supabase
    .from("department_members")
    .select("clinic_user_id")
    .eq("department_id", conversation.department_id);
  if (membersErr) throw membersErr;

  const departmentMembers = new Set((members ?? []).map((m) => m.clinic_user_id));

  return (clinicUsers ?? [])
    .filter(
      (cu) =>
        cu.role === "admin" ||
        cu.department_id === conversation.department_id ||
        departmentMembers.has(cu.user_id),
    )
    .map((cu) => cu.user_id);
}

async function hasActiveBotSession(supabase, conversationId: string) {
  const { count, error } = await supabase
    .from("conversation_bot_sessions")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("status", "active");
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function sendInboundPush(supabase, { conversationId, messageType, text }) {
  if (!PUSH_ENABLED) return;

  // Enquanto o bot está atendendo, ninguém precisa ser avisado.
  if (await hasActiveBotSession(supabase, conversationId)) return;

  const { data: conversation, error: convErr } = await supabase
    .from("conversations")
    .select("id, clinic_id, department_id, assigned_user_id, contact:contacts(name, phone)")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) throw convErr;
  if (!conversation?.clinic_id) return;

  const userIds = await resolveRecipients(supabase, conversation);
  if (userIds.length === 0) return;

  const { data: subscriptions, error: subsErr } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (subsErr) throw subsErr;
  if (!subscriptions?.length) return;

  const payload = JSON.stringify({
    title: conversation.contact?.name || conversation.contact?.phone || "Novo contato",
    body: buildBody(messageType, text),
    conversationId,
    url: `/inbox/chat/${conversationId}`,
  });

  const expired: string[] = [];
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
      } catch (err) {
        // 404/410: o aparelho cancelou a inscrição ou desinstalou o app.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          expired.push(sub.id);
        } else {
          console.error("push.send_failed", sub.id, err?.statusCode ?? null, err?.body ?? err?.message ?? String(err));
        }
      }
    }),
  );

  if (expired.length) {
    await supabase.from("push_subscriptions").delete().in("id", expired);
  }
}

/**
 * Agenda o envio das notificações de uma mensagem recebida sem atrasar a
 * resposta do webhook. `after` permite esperar o bot-engine decidir se vai
 * atender a conversa antes de checar a sessão de bot.
 */
export function queueInboundPush(
  supabase,
  params: { conversationId: string; messageType?: string | null; text?: string | null; after?: Promise<unknown> },
) {
  const task = Promise.resolve(params.after)
    .catch(() => {})
    .then(() => sendInboundPush(supabase, params))
    .catch((err) => {
      console.error("push.notify_failed", params.conversationId, err?.message ?? String(err));
    });

  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(task);
  }
  return task;
}
