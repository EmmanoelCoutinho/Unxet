import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser, getClinicMembership } from "../_shared/security.ts";
import { clinicCanAddQrNumber, clinicCanUseWhatsappNumber, PLAN_LIMIT_MESSAGES } from "../_shared/plan.ts";
import { connectionRejectionReason, rejectConnection } from "../_shared/evolutionLimit.ts";
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
// Uma instância por número: clinic_<empresa>_<sufixo>. As conexões antigas
// continuam com clinic_<empresa>.
const newSessionName = (clinicId)=>`clinic_${clinicId}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
/**
 * Webhook próprio da instância. Só é configurado quando
 * EVOLUTION_INSTANCE_WEBHOOK_URL existe (develop): em produção o webhook global
 * do servidor Evolution já cobre qualquer instância, e configurar os dois
 * duplicaria as entregas.
 */ async function setInstanceWebhook(evolutionApiUrl, evolutionApiKey, sessionName) {
  const webhookUrl = Deno.env.get("EVOLUTION_INSTANCE_WEBHOOK_URL");
  if (!webhookUrl) return;
  const response = await fetch(`${evolutionApiUrl}/webhook/set/${sessionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: evolutionApiKey
    },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: [
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "CONNECTION_UPDATE",
          "QRCODE_UPDATED"
        ]
      }
    })
  });
  if (!response.ok) {
    console.error("Failed to set instance webhook", {
      sessionName,
      status: response.status,
      body: await response.text().catch(()=>"")
    });
  }
}
serve(async (req)=>{
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  // Linha criada nesta chamada: some se a Evolution falhar, para não sobrar
  // um número fantasma na tela
  let createdConnectionId = null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return json(401, {
        success: false,
        error: "Unauthorized"
      });
    }
    // connectionId: reconectar um número que já existe
    // clinicId + displayName: adicionar um número novo
    const { connectionId: requestedConnectionId, clinicId: requestedClinicId, displayName } = await req.json();
    const evolutionApiUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");
    if (!evolutionApiUrl || !evolutionApiKey) {
      return json(400, {
        success: false,
        error: "Missing evolution configuration"
      });
    }
    let connection;
    if (requestedConnectionId) {
      const { data, error: connectionError } = await supabase.from("channel_connections").select("*").eq("id", requestedConnectionId).single();
      if (connectionError || !data) {
        return json(404, {
          success: false,
          error: "Connection not found"
        });
      }
      connection = data;
    } else {
      if (!requestedClinicId) {
        return json(400, {
          success: false,
          error: "connectionId or clinicId is required"
        });
      }
      connection = {
        id: null,
        clinic_id: requestedClinicId,
        provider: "evolution"
      };
    }
    const membership = await getClinicMembership(supabase, authUser.id, connection.clinic_id);
    // Somente administradores da clínica dona da conexão
    if (!membership || membership.role !== "admin") {
      return json(403, {
        success: false,
        error: "Forbidden"
      });
    }
    // Validar provider
    if (connection.provider !== "evolution") {
      return json(400, {
        success: false,
        error: "Provider must be evolution"
      });
    }
    if (connection.archived_at) {
      return json(400, {
        success: false,
        error: "Este número foi removido. Adicione-o de novo."
      });
    }
    // Antes de gerar o QR Code: o número só entra se houver vaga no plano
    if (!await clinicCanUseWhatsappNumber(supabase, connection.clinic_id, connection.id)) {
      return json(403, {
        success: false,
        error: PLAN_LIMIT_MESSAGES.whatsapp,
        code: "plan_limit"
      });
    }
    if (!connection.id) {
      // Número novo: o primeiro sempre pode; os demais dependem do adicional
      // "Vários números de WhatsApp" (o gatilho no banco confere de novo)
      if (!await clinicCanAddQrNumber(supabase, connection.clinic_id)) {
        return json(403, {
          success: false,
          error: PLAN_LIMIT_MESSAGES.whatsappAddon,
          code: "plan_limit"
        });
      }
      // Sem o adicional a tela não pede nome: o número fica sem apelido
      const name = String(displayName ?? "").trim();
      if (name.length > 60) {
        return json(400, {
          success: false,
          error: "Dê um nome ao número (até 60 caracteres)."
        });
      }
      const { data: created, error: createError } = await supabase.from("channel_connections").insert({
        clinic_id: connection.clinic_id,
        provider: "evolution",
        channel: "whatsapp",
        status: "disconnected",
        session_name: newSessionName(connection.clinic_id),
        display_name: name || null
      }).select("*").single();
      if (createError || !created) {
        console.error("Failed to create channel connection:", createError);
        throw new Error("Failed to create channel connection");
      }
      connection = created;
      createdConnectionId = created.id;
    }
    const connectionId = connection.id;
    const sessionName = connection.session_name;
    if (!sessionName) {
      return json(400, {
        success: false,
        error: "Missing evolution configuration"
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
    await setInstanceWebhook(evolutionApiUrl, evolutionApiKey, sessionName);
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
      const { error: connectedError } = await supabase.from("channel_connections").update({
        status: "connected",
        qr_code: null,
        disconnect_reason: null,
        // Credenciais gravadas pelo servidor (o front não envia mais a chave);
        // usadas por send-evoluation-message / evolution-in / bot-sender-whatsapp
        evolution_api_url: evolutionApiUrl,
        evolution_api_key: evolutionApiKey,
        updated_at: new Date().toISOString()
      }).eq("id", connectionId);
      const rejection = connectionRejectionReason(connectedError);
      if (rejection) {
        await rejectConnection(supabase, connection, evolutionApiUrl, evolutionApiKey, rejection);
        return json(403, {
          success: false,
          error: rejection === "plan_limit" ? PLAN_LIMIT_MESSAGES.whatsapp : "Este WhatsApp já está conectado em outro número do sistema.",
          code: rejection
        });
      }
      return json(200, {
        success: true,
        status: "connected",
        connectionId
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
      disconnect_reason: null,
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
    return json(200, {
      success: true,
      status: "connecting",
      qr_code: qrCode,
      connectionId
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    if (createdConnectionId) {
      await supabase.from("channel_connections").delete().eq("id", createdConnectionId);
    }
    return json(500, {
      success: false,
      error: error instanceof Error ? error.message : "Unknown internal error"
    });
  }
});
