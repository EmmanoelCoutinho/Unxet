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
    // 3) quem pode transferir: admin, o responsável pela conversa ou, se ela
    // está na fila (sem responsável), um membro do setor atual
    const isAdmin = String(membership.role ?? "").toLowerCase() === "admin";
    let allowed = isAdmin || conv.assigned_user_id === user.id;
    if (!allowed && !conv.assigned_user_id) {
      allowed = membership.department_id === conv.department_id;
      if (!allowed) {
        const { data: deptMember } = await admin.from("department_members").select("department_id").eq("department_id", conv.department_id).eq("clinic_user_id", user.id).maybeSingle();
        allowed = !!deptMember;
      }
    }
    if (!allowed) {
      return reject(403, "Apenas o responsável pela conversa ou um administrador pode transferi-la.");
    }
    if (conv.status === "closed") {
      return reject(409, "Esta conversa já foi finalizada e não pode ser transferida.", "conversation_closed");
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
    const actorName = membership.name ?? user.user_metadata?.name ?? user.email ?? membership.email ?? "Atendente";
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
