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
    const toDepartmentId = body?.toDepartmentId;
    if (!conversationId || !toDepartmentId) {
      return new Response(JSON.stringify({
        error: "conversationId and toDepartmentId are required"
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
    const { data: conv, error: convErr } = await admin.from("conversations").select("id, clinic_id, department_id, assigned_user_id, status").eq("id", conversationId).maybeSingle();
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
    // 3) valida se dept destino é da mesma clínica
    const { data: destDept, error: deptErr } = await admin.from("departments").select("id, clinic_id, name").eq("id", toDepartmentId).maybeSingle();
    if (deptErr || !destDept || destDept.clinic_id !== conv.clinic_id) {
      return new Response(JSON.stringify({
        error: "Invalid target department"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // regra: ao transferir por setor -> zera responsável e volta pra pending
    const nextStatus = "pending";
    const { data: updated, error: updErr } = await admin.from("conversations").update({
      department_id: toDepartmentId,
      assigned_user_id: null,
      status: nextStatus,
      updated_at: new Date().toISOString()
    }).eq("id", conversationId).select("id, status, assigned_user_id, department_id, clinic_id").maybeSingle();
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
    const actorName = membership.name ?? user.user_metadata?.name ?? user.email ?? membership.email ?? "Atendente";
    await admin.from("conversation_events").insert({
      conversation_id: conversationId,
      event_type: "conversation_transferred",
      performed_by: user.id,
      metadata: {
        performed_by_name: actorName,
        from_department_id: conv.department_id,
        to_department_id: toDepartmentId,
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
