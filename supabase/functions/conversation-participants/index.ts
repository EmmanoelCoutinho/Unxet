// deno-lint-ignore-file
// @ts-nocheck
/**
 * conversation-participants — adiciona ou tira atendentes de uma conversa.
 *
 * Body: { conversationId, action: "add" | "remove", userId }
 *
 * - Só conversa em atendimento (status "open", com responsável).
 * - Adicionar/remover: o responsável ou quem atende todos os setores
 *   (admin / permissão conversations.all).
 * - O próprio participante pode sair (action "remove" com o próprio userId).
 * - Quem é adicionado recebe um aviso no sino e uma notificação push.
 *
 * O responsável continua um só (assigned_user_id); os participantes
 * respondem junto. A lista é limpa pelo banco ao transferir, voltar para a
 * fila ou finalizar (migration 20261111000000_conversation_participants).
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser, getClinicMembership, hasClinicPermission } from "../_shared/security.ts";
import { sendPushToUsers } from "../_shared/push.ts";

const MAX_PARTICIPANTS = 10;

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

const displayName = (row, fallback = "Atendente") => row?.name || row?.email || fallback;

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
    const conversationId = String(body?.conversationId ?? "").trim();
    const action = String(body?.action ?? "").trim();
    const targetUserId = String(body?.userId ?? "").trim();
    if (!conversationId || !targetUserId || (action !== "add" && action !== "remove")) {
      return json(400, { error: "conversationId, action (add|remove) e userId são obrigatórios" });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: conv, error: convErr } = await admin
      .from("conversations")
      .select("id, clinic_id, status, assigned_user_id, contacts:contact_id ( name, phone )")
      .eq("id", conversationId)
      .maybeSingle();
    if (convErr || !conv) return json(404, { error: "Conversa não encontrada." });

    const membership = await getClinicMembership(admin, user.id, conv.clinic_id);
    if (!membership) return json(403, { error: "Not allowed" });

    const isOwner = conv.assigned_user_id === user.id;
    const isLeaving = action === "remove" && targetUserId === user.id;
    const canManage =
      isOwner ||
      String(membership.role ?? "").toLowerCase() === "admin" ||
      await hasClinicPermission(admin, user.id, conv.clinic_id, "conversations.all");

    if (!canManage && !isLeaving) {
      return json(403, {
        error: "Só o responsável pela conversa ou quem atende todos os setores pode adicionar ou remover atendentes."
      });
    }

    const { data: actorRow } = await admin
      .from("clinic_users")
      .select("name, email")
      .eq("clinic_id", conv.clinic_id)
      .eq("user_id", user.id)
      .maybeSingle();
    const actorName = displayName(actorRow, user.email ?? "Atendente");

    // ── Remover / sair ───────────────────────────────────────────────────
    if (action === "remove") {
      const { data: removed, error: delErr } = await admin
        .from("conversation_participants")
        .delete()
        .eq("conversation_id", conversationId)
        .eq("user_id", targetUserId)
        .select("user_id")
        .maybeSingle();
      if (delErr) {
        console.error("participants.remove_failed", delErr);
        return json(500, { error: "Não foi possível remover o atendente." });
      }
      if (!removed) return json(200, { ok: true, removed: false });

      const { data: targetRow } = await admin
        .from("clinic_users")
        .select("name, email")
        .eq("clinic_id", conv.clinic_id)
        .eq("user_id", targetUserId)
        .maybeSingle();

      await admin.from("conversation_events").insert({
        conversation_id: conversationId,
        event_type: isLeaving ? "participant_left" : "participant_removed",
        performed_by: user.id,
        metadata: {
          performed_by_name: actorName,
          participant_user_id: targetUserId,
          participant_name: displayName(targetRow)
        }
      });

      return json(200, { ok: true, removed: true });
    }

    // ── Adicionar ────────────────────────────────────────────────────────
    if (conv.status !== "open" || !conv.assigned_user_id) {
      return json(409, {
        error: "Só é possível adicionar atendentes a uma conversa em atendimento.",
        code: "conversation_not_open"
      });
    }
    if (targetUserId === conv.assigned_user_id) {
      return json(400, { error: "Essa pessoa já é a responsável pela conversa." });
    }

    const { data: targetRow, error: targetErr } = await admin
      .from("clinic_users")
      .select("user_id, name, email, accepted_at")
      .eq("clinic_id", conv.clinic_id)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (targetErr || !targetRow) {
      return json(400, { error: "Atendente não encontrado nesta empresa." });
    }
    if (!targetRow.accepted_at) {
      return json(400, { error: "Esse atendente ainda não aceitou o convite para entrar no Unxet." });
    }

    const { count } = await admin
      .from("conversation_participants")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);
    if ((count ?? 0) >= MAX_PARTICIPANTS) {
      return json(400, { error: `A conversa já tem ${MAX_PARTICIPANTS} atendentes adicionados.` });
    }

    const { data: inserted, error: insErr } = await admin
      .from("conversation_participants")
      .insert({
        conversation_id: conversationId,
        clinic_id: conv.clinic_id,
        user_id: targetUserId,
        added_by: user.id
      })
      .select("id, user_id, created_at")
      .maybeSingle();
    if (insErr) {
      // já estava na conversa
      if (String(insErr.code ?? "") === "23505") return json(200, { ok: true, added: false });
      console.error("participants.add_failed", insErr);
      return json(500, { error: "Não foi possível adicionar o atendente." });
    }

    const participantName = displayName(targetRow);
    await admin.from("conversation_events").insert({
      conversation_id: conversationId,
      event_type: "participant_added",
      performed_by: user.id,
      metadata: {
        performed_by_name: actorName,
        participant_user_id: targetUserId,
        participant_name: participantName
      }
    });

    // Aviso para quem foi adicionado (sino + push), sem atrasar a resposta
    const contactLabel = conv.contacts?.name || conv.contacts?.phone || "um cliente";
    const url = `/inbox/chat/${conversationId}`;
    const notifyTask = (async () => {
      const { error: notifErr } = await admin.from("user_notifications").insert({
        user_id: targetUserId,
        clinic_id: conv.clinic_id,
        kind: "conversation_participant_added",
        title: "Você foi adicionado a uma conversa",
        body: `${actorName} adicionou você à conversa com ${contactLabel}.`,
        url
      });
      if (notifErr) console.error("participants.notification_failed", notifErr);
      await sendPushToUsers(admin, [targetUserId], {
        title: "Você foi adicionado a uma conversa",
        body: `${actorName} adicionou você à conversa com ${contactLabel}.`,
        conversationId,
        url
      });
    })().catch((err) => console.error("participants.notify_failed", err?.message ?? String(err)));
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(notifyTask);
    } else {
      await notifyTask;
    }

    return json(200, { ok: true, added: true, participant: inserted });
  } catch (e) {
    console.error("conversation-participants error:", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
