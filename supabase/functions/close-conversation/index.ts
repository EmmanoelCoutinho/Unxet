import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STATUS_OPEN = "open";
const STATUS_PENDING = "pending";
const STATUS_CLOSED = "closed";
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
    const reason = body?.reason;
    const note = body?.note;
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
    // 1) busca conversa
    const { data: conv, error: convErr } = await admin.from("conversations").select("id, clinic_id, department_id, status, assigned_user_id, closed_at").eq("id", conversationId).maybeSingle();
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
    // idempotente
    if (conv.status === STATUS_CLOSED) {
      return new Response(JSON.stringify({
        ok: true,
        alreadyClosed: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 2) valida membership
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
    // mesma regra do accept: se user tem dept fixo, precisa bater com o dept da conversa
    if (membership.department_id && membership.department_id !== conv.department_id) {
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
    // 3) permissão: admin fecha qualquer, agent só se for assigned
    const role = String(membership.role ?? "agent").toLowerCase();
    const isAdmin = role === "admin";
    const isAssigned = conv.assigned_user_id === user.id;
    if (!isAdmin && !isAssigned) {
      return new Response(JSON.stringify({
        error: "Only assigned user can close"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const nowIso = new Date().toISOString();
    // 4) fecha conversa
    const { data: updated, error: updErr } = await admin.from("conversations").update({
      status: STATUS_CLOSED,
      closed_at: nowIso,
      updated_at: nowIso
    }).eq("id", conversationId).select("id, status, assigned_user_id, department_id, clinic_id, closed_at").maybeSingle();
    if (updErr || !updated) {
      return new Response(JSON.stringify({
        error: "Failed to close"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const actorName = membership.name ?? user.user_metadata?.name ?? user.email ?? membership.email ?? "Atendente";
    // 5) evento
    await admin.from("conversation_events").insert({
      conversation_id: conversationId,
      event_type: "conversation_closed",
      performed_by: user.id,
      metadata: {
        performed_by_name: actorName,
        reason: reason ?? null,
        note: note ?? null
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
