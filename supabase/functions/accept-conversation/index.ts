import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
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
    if (!conversationId) {
      return new Response(JSON.stringify({
        error: "conversationId is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // 1) pega conversa e valida clínica
    const { data: conv, error: convErr } = await admin.from("conversations").select("id, clinic_id, department_id, status, assigned_user_id").eq("id", conversationId).maybeSingle();
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
    // 2) valida membership do usuário na clínica (e opcionalmente no dept)
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
    // pode aceitar: admin, quem já era o responsável (conversa reaberta) ou
    // membro do setor da conversa (clinic_users.department_id ou department_members)
    const isAdmin = String(membership.role ?? "").toLowerCase() === "admin";
    let allowed = isAdmin || conv.assigned_user_id === user.id || membership.department_id === conv.department_id;
    if (!allowed) {
      const { data: deptMember } = await admin.from("department_members").select("department_id").eq("department_id", conv.department_id).eq("clinic_user_id", user.id).maybeSingle();
      allowed = !!deptMember;
    }
    if (!allowed) {
      return new Response(JSON.stringify({
        error: "Not allowed for this department"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 3) faz update (assigned + open). Só vale para conversa pendente que está
    // na fila (sem responsável) ou que já era do próprio usuário. A condição
    // vai no UPDATE: se dois aceitarem ao mesmo tempo, só um vence.
    const nowIso = new Date().toISOString();
    const { data: updated, error: updErr } = await admin.from("conversations").update({
      assigned_user_id: user.id,
      status: "open",
      in_bot_flow: false,
      closed_at: null,
      status_changed_at: nowIso,
      updated_at: nowIso
    }).eq("id", conversationId).eq("status", "pending").or(`assigned_user_id.is.null,assigned_user_id.eq.${user.id}`).select("id, status, assigned_user_id, department_id, clinic_id").maybeSingle();
    if (updErr) {
      return new Response(JSON.stringify({
        error: "Failed to accept"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!updated) {
      return new Response(JSON.stringify({
        error: "Esta conversa já foi aceita por outro atendente ou não está mais pendente.",
        code: "conversation_not_available"
      }), {
        status: 409,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const actorName = membership.name ?? user.user_metadata?.name ?? user.email ?? membership.email ?? "Atendente";
    // 4) log do evento
    await admin.from("conversation_events").insert({
      conversation_id: conversationId,
      event_type: "conversation_accepted",
      performed_by: user.id,
      metadata: {
        performed_by_name: actorName
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
