import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser, getClinicMembership } from "../_shared/security.ts";
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
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return new Response(JSON.stringify({
        success: false,
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { connectionId } = await req.json();
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
    // Supabase
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // Buscar conexão
    const { data: connection, error: connectionError } = await supabase.from("channel_connections").select("*").eq("id", connectionId).single();
    if (connectionError || !connection) {
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
    const membership = await getClinicMembership(supabase, authUser.id, connection.clinic_id);
    // Somente administradores da clínica dona da conexão
    if (!membership || membership.role !== "admin") {
      return new Response(JSON.stringify({
        success: false,
        error: "Forbidden"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Validar provider
    if (connection.provider !== "evolution") {
      return new Response(JSON.stringify({
        success: false,
        error: "Provider must be evolution"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const evolutionApiUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");
    const sessionName = connection.session_name;
    if (!evolutionApiUrl || !evolutionApiKey || !sessionName) {
      return new Response(JSON.stringify({
        success: false,
        error: "Missing evolution configuration"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("Starting Evolution connection flow", {
      connectionId,
      sessionName
    });
    // =========================================================
    // 1. Verificar instâncias existentes
    // =========================================================
    const fetchInstancesResponse = await fetch(`${evolutionApiUrl}/instance/fetchInstances`, {
      method: "GET",
      headers: {
        apikey: evolutionApiKey
      }
    });
    const fetchInstancesData = await fetchInstancesResponse.json();
    console.log("Instances fetched:", fetchInstancesData);
    const instances = Array.isArray(fetchInstancesData) ? fetchInstancesData : fetchInstancesData?.instances || [];
    const existingInstance = instances.find((instance)=>instance?.name === sessionName || instance?.instance?.instanceName === sessionName);
    // =========================================================
    // 2. Criar instância se não existir
    // =========================================================
    if (!existingInstance) {
      console.log("Instance not found. Creating...");
      const createResponse = await fetch(`${evolutionApiUrl}/instance/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: evolutionApiKey
        },
        body: JSON.stringify({
          instanceName: sessionName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS"
        })
      });
      const createData = await createResponse.json();
      console.log("Create instance response:", createData);
      if (!createResponse.ok) {
        throw new Error(createData?.message || "Failed to create Evolution instance");
      }
    } else {
      console.log("Instance already exists");
    }
    // =========================================================
    // 3. Verificar estado da conexão
    // =========================================================
    const connectionStateResponse = await fetch(`${evolutionApiUrl}/instance/connectionState/${sessionName}`, {
      method: "GET",
      headers: {
        apikey: evolutionApiKey
      }
    });
    const connectionStateData = await connectionStateResponse.json();
    console.log("Connection state:", connectionStateData);
    const connectionState = connectionStateData?.instance?.state || connectionStateData?.state || connectionStateData?.status;
    // =========================================================
    // 4. Se já conectado
    // =========================================================
    if (connectionState === "open" || connectionState === "connected") {
      console.log("Instance already connected");
      await supabase.from("channel_connections").update({
        status: "connected",
        qr_code: null,
        // Credenciais gravadas pelo servidor (o front não envia mais a chave);
        // usadas por send-evoluation-message / evolution-in / bot-sender-whatsapp
        evolution_api_url: evolutionApiUrl,
        evolution_api_key: evolutionApiKey,
        updated_at: new Date().toISOString()
      }).eq("id", connectionId);
      return new Response(JSON.stringify({
        success: true,
        status: "connected"
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // =========================================================
    // 5. Gerar QR Code
    // =========================================================
    console.log("Generating QR Code...");
    const connectResponse = await fetch(`${evolutionApiUrl}/instance/connect/${sessionName}`, {
      method: "GET",
      headers: {
        apikey: evolutionApiKey
      }
    });
    const connectData = await connectResponse.json();
    console.log("Connect response:", connectData);
    const qrCode = connectData?.base64 || connectData?.qrcode?.base64 || connectData?.code || connectData?.qrcode || null;
    if (!qrCode) {
      throw new Error("QR Code not returned by Evolution");
    }
    // =========================================================
    // 6. Atualizar banco
    // =========================================================
    const { error: updateError } = await supabase.from("channel_connections").update({
      qr_code: qrCode,
      status: "connecting",
      evolution_api_url: evolutionApiUrl,
      evolution_api_key: evolutionApiKey,
      updated_at: new Date().toISOString()
    }).eq("id", connectionId);
    if (updateError) {
      console.error("Database update error:", updateError);
      throw new Error("Failed to update channel connection");
    }
    console.log("QR Code saved successfully");
    // =========================================================
    // 7. Retorno
    // =========================================================
    return new Response(JSON.stringify({
      success: true,
      status: "connecting",
      qr_code: qrCode
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown internal error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
