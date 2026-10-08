// supabase/functions/invite-attendant/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function log(step, payload) {
  // Logs ficam no Supabase → Functions → Logs
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    fn: "invite-attendant",
    step,
    ...payload
  }));
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json(405, {
    error: "Method not allowed"
  });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const DEFAULT_REDIRECT_TO = Deno.env.get("INVITE_REDIRECT_TO") ?? null;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    log("missing_auth_header");
    return json(401, {
      error: "Missing Authorization header"
    });
  }
  let body;
  try {
    body = await req.json();
  } catch  {
    log("invalid_json");
    return json(400, {
      error: "Invalid JSON body"
    });
  }
  const clinicId = body.clinic_id?.trim();
  const email = body.email?.trim().toLowerCase();
  const name = (body.name ?? null)?.toString().trim() || null;
  const role = body.role ?? "agent";
  const departmentId = body.department_id ?? null;
  // INVITE_REDIRECT_TO (secret da function) tem prioridade: garante que o link do
  // convite aponte para o app em produção mesmo que o convite seja feito de localhost.
  const redirectTo = (DEFAULT_REDIRECT_TO ?? body.redirect_to) || undefined;
  log("request_received", {
    clinicId,
    email,
    role,
    departmentId,
    hasRedirectTo: !!redirectTo,
    redirectTo
  });
  if (!clinicId) return json(400, {
    error: "clinic_id is required"
  });
  if (!email || !isValidEmail(email)) return json(400, {
    error: "Valid email is required"
  });
  if (role !== "admin" && role !== "agent") return json(400, {
    error: "Invalid role"
  });
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    log("getUser_failed", {
      error: userErr?.message
    });
    return json(401, {
      error: "Unauthorized"
    });
  }
  const requesterId = userData.user.id;
  log("requester_ok", {
    requesterId
  });
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: requesterMembership, error: memErr } = await adminClient.from("clinic_users").select("role").eq("clinic_id", clinicId).eq("user_id", requesterId).maybeSingle();
  if (memErr) {
    log("membership_check_failed", {
      error: memErr.message
    });
    return json(500, {
      error: memErr.message
    });
  }
  if (!requesterMembership || requesterMembership.role !== "admin") {
    log("forbidden_not_admin", {
      requesterId,
      clinicId
    });
    return json(403, {
      error: "Forbidden"
    });
  }
  log("membership_ok");
  if (departmentId) {
    const { data: dept, error: deptErr } = await adminClient.from("departments").select("id, is_active, clinic_id").eq("id", departmentId).maybeSingle();
    if (deptErr) {
      log("department_check_failed", {
        error: deptErr.message,
        departmentId
      });
      return json(500, {
        error: deptErr.message
      });
    }
    if (!dept || dept.clinic_id !== clinicId) {
      log("department_invalid", {
        departmentId,
        clinicId
      });
      return json(400, {
        error: "department_id inválido para esta clínica"
      });
    }
    if (!dept.is_active) {
      log("department_inactive_blocked", {
        departmentId
      });
      return json(400, {
        error: "Não é permitido definir setor principal inativo"
      });
    }
  }
  log("invite_call_start", {
    email,
    redirectTo
  });
  const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      clinic_id: clinicId,
      name,
      role
    }
  });
  if (inviteErr) {
    log("invite_call_failed", {
      error: inviteErr.message
    });
    return json(400, {
      error: inviteErr.message
    });
  }
  const invitedUserId = inviteData.user?.id;
  log("invite_call_ok", {
    invitedUserId
  });
  if (!invitedUserId) {
    log("invite_missing_user_id");
    return json(500, {
      error: "Invite succeeded but user id missing"
    });
  }
  log("clinic_users_upsert_start", {
    invitedUserId,
    clinicId
  });
  const { error: upsertErr } = await adminClient.from("clinic_users").upsert({
    clinic_id: clinicId,
    user_id: invitedUserId,
    role,
    name,
    department_id: departmentId,
    email,
    invited_at: new Date().toISOString(),
    accepted_at: null
  }, {
    onConflict: "user_id"
  });
  if (upsertErr) {
    log("clinic_users_upsert_failed", {
      error: upsertErr.message
    });
    return json(500, {
      error: upsertErr.message
    });
  }
  log("clinic_users_upsert_ok", {
    invitedUserId
  });
  return json(200, {
    ok: true,
    user_id: invitedUserId,
    email,
    invited: true
  });
});
