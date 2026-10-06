import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error("❌ Missing envs: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY");
}
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
function safeStr(v) {
  if (v == null) return "";
  return String(v);
}
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function getAuthUser(req) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return {
    user: null,
    token: null
  };
  const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    auth: {
      persistSession: false
    }
  });
  const { data, error } = await supabaseAuth.auth.getUser();
  if (error) return {
    user: null,
    token: null
  };
  return {
    user: data.user ?? null,
    token
  };
}
async function canReplyToConversation(opts) {
  const { rid, conversationId, userId } = opts;
  const { data: conv, error: convErr } = await supabaseAdmin.from("conversations").select("id, clinic_id, department_id, assigned_user_id").eq("id", conversationId).maybeSingle();
  console.log(JSON.stringify({
    rid,
    step: "perm.conversation",
    ok: !convErr && !!conv,
    convErr,
    conv
  }, null, 2));
  if (convErr || !conv) return {
    ok: false,
    reason: "conversation_not_found"
  };
  const clinicId = safeStr(conv.clinic_id);
  const departmentId = safeStr(conv.department_id);
  const assignedUserId = safeStr(conv.assigned_user_id);
  // precisa existir em clinic_users (senão nem “faz parte” da clínica)
  const { data: cu, error: cuErr } = await supabaseAdmin.from("clinic_users").select("user_id, clinic_id, role").eq("clinic_id", clinicId).eq("user_id", userId).maybeSingle();
  console.log(JSON.stringify({
    rid,
    step: "perm.clinic_users",
    ok: !cuErr && !!cu,
    cuErr,
    cu
  }, null, 2));
  if (cuErr || !cu) return {
    ok: false,
    reason: "not_in_clinic"
  };
  const role = safeStr(cu.role);
  // REGRA 1: conversa atribuída -> somente o assigned envia (admin NÃO fura)
  if (assignedUserId) {
    const ok = assignedUserId === userId;
    return {
      ok,
      reason: ok ? "assigned_owner" : "assigned_not_owner",
      role,
      conv
    };
  }
  // REGRA 2: não atribuída -> somente membros do departamento enviam
  const { data: dm, error: dmErr } = await supabaseAdmin.from("department_members").select("department_id, clinic_user_id").eq("department_id", departmentId).eq("clinic_user_id", userId).maybeSingle();
  console.log(JSON.stringify({
    rid,
    step: "perm.department_members",
    ok: !dmErr && !!dm,
    dmErr,
    dm
  }, null, 2));
  const isDeptMember = !!dm && !dmErr;
  // Você disse: admin pode ver mas não responder -> então admin NÃO envia se não for assigned.
  if (role === "admin") {
    return {
      ok: false,
      reason: "admin_cannot_send_unassigned",
      role,
      conv
    };
  }
  return {
    ok: isDeptMember,
    reason: isDeptMember ? "dept_member_unassigned" : "not_dept_member",
    role,
    conv
  };
}
serve(async (req)=>{
  const rid = crypto.randomUUID();
  try {
    if (req.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
    if (req.method !== "POST") return json(405, {
      error: "Method not allowed"
    });
    const { user } = await getAuthUser(req);
    if (!user) return json(401, {
      error: "Unauthorized"
    });
    const body = await req.json().catch(()=>({}));
    const conversationId = safeStr(body?.conversationId).trim();
    console.log(JSON.stringify({
      rid,
      step: "request.in",
      userId: user.id,
      conversationId: conversationId || null
    }, null, 2));
    if (!conversationId) {
      return json(400, {
        error: "conversationId é obrigatório"
      });
    }
    const perm = await canReplyToConversation({
      rid,
      conversationId,
      userId: user.id
    });
    console.log(JSON.stringify({
      rid,
      step: "perm.result",
      ok: perm.ok,
      reason: perm.reason,
      role: perm.role ?? null
    }, null, 2));
    if (!perm.ok) {
      return json(403, {
        error: "Not allowed",
        reason: perm.reason
      });
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 60 * 1000).toISOString(); // 2 min
    const { data: nonceRow, error: nonceErr } = await supabaseAdmin.from("send_nonces").insert({
      user_id: user.id,
      conversation_id: conversationId,
      purpose: "send_message",
      expires_at: expiresAt
    }).select("id, expires_at").maybeSingle();
    console.log(JSON.stringify({
      rid,
      step: "nonce.insert",
      ok: !nonceErr && !!nonceRow,
      nonceErr,
      nonceRow
    }, null, 2));
    if (nonceErr || !nonceRow) {
      return json(500, {
        error: "Falha ao criar nonce"
      });
    }
    return json(200, {
      nonce: nonceRow.id,
      expiresAt: nonceRow.expires_at
    });
  } catch (err) {
    console.error(JSON.stringify({
      rid,
      step: "unexpected_error",
      message: err?.message ?? String(err),
      stack: err?.stack ?? null
    }, null, 2));
    return json(500, {
      error: "Internal error"
    });
  }
});
