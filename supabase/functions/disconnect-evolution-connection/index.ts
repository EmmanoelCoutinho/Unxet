import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
serve(async (req)=>{
  // ─────────────────────────────────────────────────────────────
  // CORS
  // ─────────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    // ─────────────────────────────────────────────────────────────
    // ENV
    // ─────────────────────────────────────────────────────────────
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
    const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
    // ─────────────────────────────────────────────────────────────
    // SUPABASE
    // ─────────────────────────────────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // ─────────────────────────────────────────────────────────────
    // BODY
    // ─────────────────────────────────────────────────────────────
    const body = await req.json();
    const connectionId = String(body?.connectionId ?? "").trim();
    if (!connectionId) {
      return new Response(JSON.stringify({
        success: false,
        error: "connectionId is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // ─────────────────────────────────────────────────────────────
    // BUSCA CONNECTION
    // ─────────────────────────────────────────────────────────────
    const { data: connection, error: connectionError } = await supabase.from("channel_connections").select("*").eq("id", connectionId).eq("provider", "evolution").maybeSingle();
    if (connectionError || !connection) {
      console.error("[CONNECTION_NOT_FOUND]", connectionError);
      return new Response(JSON.stringify({
        success: false,
        error: "Connection not found"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const sessionName = String(connection.session_name ?? "").trim();
    if (!sessionName) {
      return new Response(JSON.stringify({
        success: false,
        error: "Session name not found"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("[EVOLUTION_DISCONNECT_START]", {
      connectionId,
      sessionName
    });
    // ─────────────────────────────────────────────────────────────
    // MARCA COMO DESCONECTANDO
    // ─────────────────────────────────────────────────────────────
    const { error: disconnectingError } = await supabase.from("channel_connections").update({
      status: "disconnecting",
      updated_at: new Date().toISOString()
    }).eq("id", connection.id);
    if (disconnectingError) {
      console.error("[DISCONNECTING_UPDATE_ERROR]", disconnectingError);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to update disconnecting status"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // ─────────────────────────────────────────────────────────────
    // LOGOUT EVOLUTION
    // ─────────────────────────────────────────────────────────────
    const logoutResponse = await fetch(`${EVOLUTION_API_URL.replace(/\/$/, "")}/instance/logout/${sessionName}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY
      }
    });
    const logoutText = await logoutResponse.text();
    console.log("[EVOLUTION_LOGOUT_RESPONSE]", {
      status: logoutResponse.status,
      body: logoutText
    });
    // ─────────────────────────────────────────────────────────────
    // NÃO atualiza para disconnected aqui.
    // O source of truth será:
    //
    // CONNECTION_UPDATE → state = close
    //
    // recebido no evolution-in.
    // ─────────────────────────────────────────────────────────────
    if (!logoutResponse.ok) {
      console.error("[EVOLUTION_LOGOUT_FAILED]", {
        status: logoutResponse.status,
        body: logoutText
      });
      // volta para connected se falhar
      await supabase.from("channel_connections").update({
        status: "connected",
        updated_at: new Date().toISOString()
      }).eq("id", connection.id);
      return new Response(JSON.stringify({
        success: false,
        error: "Evolution logout failed"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("[EVOLUTION_DISCONNECT_WAITING_WEBHOOK]", {
      connectionId,
      sessionName
    });
    return new Response(JSON.stringify({
      success: true,
      status: "disconnecting"
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("[DISCONNECT_FATAL_ERROR]", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
