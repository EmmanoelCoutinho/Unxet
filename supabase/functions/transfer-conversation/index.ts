import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasClinicPermission } from "../_shared/security.ts";
import { clinicHasFeature, PLAN_LIMIT_MESSAGES } from "../_shared/plan.ts";
import { sendPushToUsers } from "../_shared/push.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
/**
 * Transfere para um atendente: ele vira o responsável e a conversa fica em
 * atendimento (pode responder na hora). O setor continua o mesmo; o
 * responsável vê a conversa mesmo sendo de outro setor.
 */ async function transferToUser(admin, params) {
  const { conv, conversationId, toUserId, user, actorName, reject } = params;
  if (toUserId === conv.assigned_user_id) {
    return reject(400, "Essa pessoa já é a responsável pela conversa.");
  }
  const { data: target } = await admin.from("clinic_users").select("user_id, name, email, accepted_at").eq("clinic_id", conv.clinic_id).eq("user_id", toUserId).maybeSingle();
  if (!target) return reject(400, "Atendente não encontrado nesta empresa.");
  if (!target.accepted_at) {
    return reject(400, "Esse atendente ainda não aceitou o convite para entrar no Unxet.");
  }
  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await admin.from("conversations").update({
    assigned_user_id: toUserId,
    in_bot_flow: false,
    status: "open",
    status_changed_at: nowIso,
    updated_at: nowIso
  }).eq("id", conversationId).neq("status", "closed").select("id, status, assigned_user_id, department_id, clinic_id").maybeSingle();
  if (updErr) return reject(500, "Failed to transfer");
  if (!updated) {
    return reject(409, "Esta conversa já foi finalizada e não pode ser transferida.", "conversation_closed");
  }
  // Quem virou responsável deixa de ser só "adicionado"
  await admin.from("conversation_participants").delete().eq("conversation_id", conversationId).eq("user_id", toUserId);
  const targetName = target.name || target.email || "Atendente";
  await admin.from("conversation_events").insert({
    conversation_id: conversationId,
    event_type: "conversation_transferred",
    performed_by: user.id,
    metadata: {
      performed_by_name: actorName,
      from_user_id: conv.assigned_user_id ?? null,
      to_user_id: toUserId,
      to_user_name: targetName,
      assigned_user_id: toUserId,
      status: "open"
    }
  });
  // Aviso para quem recebeu (sino + push), sem atrasar a resposta
  if (toUserId !== user.id) {
    const contactLabel = conv.contacts?.name || conv.contacts?.phone || "um cliente";
    const url = `/inbox/chat/${conversationId}`;
    const title = "Conversa transferida para você";
    const body = `${actorName} transferiu para você a conversa com ${contactLabel}.`;
    const notifyTask = (async ()=>{
      const { error: notifErr } = await admin.from("user_notifications").insert({
        user_id: toUserId,
        clinic_id: conv.clinic_id,
        kind: "conversation_transferred",
        title,
        body,
        url
      });
      if (notifErr) console.error("transfer.notification_failed", notifErr);
      await sendPushToUsers(admin, [
        toUserId
      ], {
        title,
        body,
        conversationId,
        url
      });
    })().catch((err)=>console.error("transfer.notify_failed", err?.message ?? String(err)));
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(notifyTask);
    } else {
      await notifyTask;
    }
  }
  return new Response(JSON.stringify({
    ok: true,
    conversation: updated
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: "Missing Authorization"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({
        error: "Invalid auth"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const user = userData.user;
    const body = await req.json().catch(()=>({}));
    const conversationId = body?.conversationId;
    const toDepartmentId = body?.toDepartmentId;
    // Para uma pessoa: a conversa vai direto para ela, em atendimento
    const toUserId = body?.toUserId;
    if (!conversationId || !toDepartmentId && !toUserId) {
      return new Response(JSON.stringify({
        error: "conversationId and toDepartmentId or toUserId are required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // 1) conversa
    const { data: conv, error: convErr } = await admin.from("conversations").select("id, clinic_id, department_id, assigned_user_id, status, contacts ( name, phone )").eq("id", conversationId).maybeSingle();
    if (convErr || !conv) {
      return new Response(JSON.stringify({
        error: "Conversation not found"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 2) membership do usuário na clínica
    const { data: membership, error: memErr } = await admin.from("clinic_users").select("user_id, clinic_id, department_id, role, name, email").eq("user_id", user.id).eq("clinic_id", conv.clinic_id).maybeSingle();
    if (memErr || !membership) {
      return new Response(JSON.stringify({
        error: "Not allowed"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const reject = (status, error, code)=>new Response(JSON.stringify({
        error,
        ...code ? {
          code
        } : {}
      }), {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    // Transferir para uma pessoa não depende de setores no plano
    if (!toUserId && !await clinicHasFeature(admin, conv.clinic_id, "departments")) {
      return reject(403, PLAN_LIMIT_MESSAGES.departments, "plan_limit");
    }
    // 3) quem pode transferir: admin ou cargo que atende todos os setores, o
    // responsável pela conversa ou, se ela está na fila (sem responsável), um
    // membro do setor atual
    const isAdmin = String(membership.role ?? "").toLowerCase() === "admin" || await hasClinicPermission(admin, user.id, conv.clinic_id, "conversations.all");
    let allowed = isAdmin || conv.assigned_user_id === user.id;
    if (!allowed && !conv.assigned_user_id) {
      allowed = membership.department_id === conv.department_id;
      if (!allowed) {
        const { data: deptMember } = await admin.from("department_members").select("department_id").eq("department_id", conv.department_id).eq("clinic_user_id", user.id).maybeSingle();
        allowed = !!deptMember;
      }
    }
    if (!allowed) {
      return reject(403, "Apenas o responsável pela conversa ou quem atende todos os setores pode transferi-la.");
    }
    if (conv.status === "closed") {
      return reject(409, "Esta conversa já foi finalizada e não pode ser transferida.", "conversation_closed");
    }
    const actorName = membership.name ?? user.user_metadata?.name ?? user.email ?? membership.email ?? "Atendente";
    if (toUserId) {
      return await transferToUser(admin, {
        conv,
        conversationId,
        toUserId: String(toUserId),
        user,
        actorName,
        reject
      });
    }
    if (toDepartmentId === conv.department_id) {
      return reject(400, "A conversa já está neste setor.");
    }
    // 4) valida se dept destino é da mesma clínica e está ativo
    const { data: destDept, error: deptErr } = await admin.from("departments").select("id, clinic_id, name, is_active").eq("id", toDepartmentId).maybeSingle();
    if (deptErr || !destDept || destDept.clinic_id !== conv.clinic_id) {
      return reject(400, "Setor de destino inválido.");
    }
    if (!destDept.is_active) {
      return reject(400, "O setor de destino está inativo.");
    }
    const { data: fromDept } = await admin.from("departments").select("name").eq("id", conv.department_id).maybeSingle();
    // regra: ao transferir por setor -> zera responsável e volta pra pending.
    // O status vai na condição do UPDATE para não reabrir uma conversa que foi
    // finalizada entre a leitura e a gravação.
    const nextStatus = "pending";
    const nowIso = new Date().toISOString();
    const { data: updated, error: updErr } = await admin.from("conversations").update({
      department_id: toDepartmentId,
      assigned_user_id: null,
      in_bot_flow: false,
      status: nextStatus,
      status_changed_at: nowIso,
      updated_at: nowIso
    }).eq("id", conversationId).neq("status", "closed").select("id, status, assigned_user_id, department_id, clinic_id").maybeSingle();
    if (updErr || !updated) {
      return new Response(JSON.stringify({
        error: "Failed to transfer"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    await admin.from("conversation_events").insert({
      conversation_id: conversationId,
      event_type: "conversation_transferred",
      performed_by: user.id,
      metadata: {
        performed_by_name: actorName,
        from_department_id: conv.department_id,
        from_department_name: fromDept?.name ?? null,
        to_department_id: toDepartmentId,
        to_department_name: destDept.name,
        assigned_user_id: null,
        status: nextStatus
      }
    });
    return new Response(JSON.stringify({
      ok: true,
      conversation: updated
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : "Unknown error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
