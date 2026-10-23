/**
 * archive-evolution-connection
 *
 * Remove um número de WhatsApp por QR Code (Evolution) da empresa:
 *   1. desloga e apaga a instância na Evolution;
 *   2. marca a conexão como arquivada (archived_at) e desconectada;
 *   3. desliga o bot vinculado ao número.
 *
 * A linha não é apagada: as conversas antigas continuam ligadas a ela e o
 * histórico segue aparecendo no atendimento. Só administradores da empresa.
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser, getClinicMembership } from "../_shared/security.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (status, body)=>new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const evolutionApiUrl = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/$/, "");
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY") ?? "";
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return json(401, {
        success: false,
        error: "Unauthorized"
      });
    }
    const body = await req.json().catch(()=>({}));
    const connectionId = String(body?.connectionId ?? "").trim();
    if (!connectionId) {
      return json(400, {
        success: false,
        error: "connectionId is required"
      });
    }
    const { data: connection, error: connectionError } = await supabase.from("channel_connections").select("id, clinic_id, session_name, archived_at").eq("id", connectionId).eq("provider", "evolution").maybeSingle();
    if (connectionError || !connection) {
      console.error("[ARCHIVE_CONNECTION_NOT_FOUND]", connectionError);
      return json(404, {
        success: false,
        error: "Connection not found"
      });
    }
    const membership = await getClinicMembership(supabase, authUser.id, connection.clinic_id);
    if (!membership || membership.role !== "admin") {
      return json(403, {
        success: false,
        error: "Forbidden"
      });
    }
    if (connection.archived_at) {
      return json(200, {
        success: true,
        status: "archived"
      });
    }
    const sessionName = String(connection.session_name ?? "").trim();
    if (sessionName && evolutionApiUrl && evolutionApiKey) {
      // Logout antes do delete: algumas versões da Evolution recusam apagar
      // instância conectada. Instância que já não existe (404) não impede.
      const headers = {
        "Content-Type": "application/json",
        apikey: evolutionApiKey
      };
      const logoutResponse = await fetch(`${evolutionApiUrl}/instance/logout/${sessionName}`, {
        method: "DELETE",
        headers
      });
      console.log("[ARCHIVE_EVOLUTION_LOGOUT]", {
        sessionName,
        status: logoutResponse.status
      });
      const deleteResponse = await fetch(`${evolutionApiUrl}/instance/delete/${sessionName}`, {
        method: "DELETE",
        headers
      });
      const deleteText = await deleteResponse.text();
      console.log("[ARCHIVE_EVOLUTION_DELETE]", {
        sessionName,
        status: deleteResponse.status,
        body: deleteText
      });
      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        return json(502, {
          success: false,
          error: "Não foi possível remover o número na Evolution. Tente de novo."
        });
      }
    }
    const now = new Date().toISOString();
    const { error: archiveError } = await supabase.from("channel_connections").update({
      archived_at: now,
      status: "disconnected",
      qr_code: null,
      last_disconnection_at: now,
      updated_at: now
    }).eq("id", connection.id);
    if (archiveError) {
      console.error("[ARCHIVE_UPDATE_ERROR]", archiveError);
      return json(500, {
        success: false,
        error: "Failed to archive connection"
      });
    }
    const { error: bindingError } = await supabase.from("bot_channel_bindings").update({
      enabled: false,
      updated_at: now
    }).eq("channel_connection_id", connection.id).eq("enabled", true);
    if (bindingError) {
      console.error("[ARCHIVE_BOT_BINDING_ERROR]", bindingError);
    }
    return json(200, {
      success: true,
      status: "archived"
    });
  } catch (error) {
    console.error("[ARCHIVE_FATAL_ERROR]", error);
    return json(500, {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
