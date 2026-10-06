import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
serve(async (req)=>{
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    console.log("Evolution webhook received:", body);
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // =====================================================
    // EVENTOS
    // =====================================================
    const event = body?.event || body?.type || body?.eventType;
    const sessionName = body?.instance || body?.instanceName || body?.data?.instance || null;
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
    // =====================================================
    // BUSCAR CONNECTION
    // =====================================================
    const { data: connection, error: connectionError } = await supabase.from("channel_connections").select("*").eq("session_name", sessionName).single();
    if (connectionError || !connection) {
      console.error("Connection not found for session:", sessionName);
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
    // =====================================================
    // CONNECTION UPDATE
    // =====================================================
    if (event === "CONNECTION_UPDATE" || event === "connection.update") {
      const state = body?.data?.state || body?.state || null;
      console.log("Connection state:", state);
      // ===============================================
      // CONNECTED
      // ===============================================
      if (state === "open" || state === "connected") {
        const phone = body?.data?.profileName || body?.data?.owner || null;
        const connectedNumber = body?.data?.wuid || body?.data?.number || null;
        const { error: updateError } = await supabase.from("channel_connections").update({
          status: "connected",
          qr_code: null,
          connected_phone: connectedNumber,
          connected_name: phone,
          last_connection_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq("id", connection.id);
        if (updateError) {
          console.error("Error updating connected status:", updateError);
          throw updateError;
        }
        console.log("Connection marked as connected");
      }
      // ===============================================
      // DISCONNECTED
      // ===============================================
      if (state === "close" || state === "disconnected") {
        const { error: updateError } = await supabase.from("channel_connections").update({
          status: "disconnected",
          last_disconnection_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq("id", connection.id);
        if (updateError) {
          console.error("Error updating disconnected status:", updateError);
          throw updateError;
        }
        console.log("Connection marked as disconnected");
      }
    }
    // =====================================================
    // QR CODE UPDATED
    // =====================================================
    if (event === "QRCODE_UPDATED" || event === "qrcode.updated") {
      const qrCode = body?.data?.qrcode || body?.data?.base64 || body?.qrcode || body?.base64 || null;
      if (qrCode) {
        const { error: updateError } = await supabase.from("channel_connections").update({
          qr_code: qrCode,
          status: "connecting",
          updated_at: new Date().toISOString()
        }).eq("id", connection.id);
        if (updateError) {
          console.error("Error updating QR Code:", updateError);
          throw updateError;
        }
        console.log("QR Code updated");
      }
    }
    return new Response(JSON.stringify({
      success: true
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Webhook error:", error);
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
