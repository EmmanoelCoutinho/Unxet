import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const json = (status, data)=>new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
async function requireClinicAdmin(supabase, clinicId, userId) {
  const { data, error } = await supabase.from("clinic_users").select("role").eq("clinic_id", clinicId).eq("user_id", userId).maybeSingle();
  if (error || !data) return false;
  return String(data.role) === "admin";
}
serve(async (req)=>{
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
    if (req.method !== "POST") {
      return json(405, {
        error: "Method not allowed"
      });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, {
        error: "Misconfigured env"
      });
    }
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!jwt) {
      return json(401, {
        error: "Missing auth"
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    const userId = userData?.user?.id ?? null;
    if (userErr || !userId) {
      return json(401, {
        error: "Invalid auth"
      });
    }
    const body = await req.json().catch(()=>({}));
    const action = body.action ?? "get_status";
    const clinicId = String(body.clinicId ?? "").trim();
    if (!clinicId) {
      return json(400, {
        error: "clinicId is required"
      });
    }
    const isAdmin = await requireClinicAdmin(supabase, clinicId, userId);
    if (!isAdmin) {
      return json(403, {
        error: "Forbidden"
      });
    }
    if (action === "finish_embedded_signup") {
      const metaWabaId = String(body.metaWabaId ?? "").trim();
      const metaPhoneNumberId = String(body.metaPhoneNumberId ?? "").trim();
      const accessToken = String(body.accessToken ?? "").trim();
      const displayPhoneNumber = String(body.displayPhoneNumber ?? "").trim();
      if (!metaWabaId) {
        return json(400, {
          error: "metaWabaId is required"
        });
      }
      if (!metaPhoneNumberId) {
        return json(400, {
          error: "metaPhoneNumberId is required"
        });
      }
      if (!accessToken) {
        return json(400, {
          error: "accessToken is required"
        });
      }
      if (!displayPhoneNumber) {
        return json(400, {
          error: "displayPhoneNumber is required"
        });
      }
      const now = new Date().toISOString();
      const upsertConnection = await supabase.from("channel_connections").upsert({
        clinic_id: clinicId,
        provider: "meta",
        channel: "whatsapp",
        meta_waba_id: metaWabaId,
        meta_phone_number_id: metaPhoneNumberId,
        access_token: accessToken,
        status: "connected",
        updated_at: now
      }, {
        onConflict: "clinic_id,provider,channel"
      }).select("id, clinic_id, channel, meta_waba_id, meta_phone_number_id, status").maybeSingle();
      if (upsertConnection.error || !upsertConnection.data?.id) {
        return json(500, {
          error: "DB upsert whatsapp connection failed",
          details: upsertConnection.error
        });
      }
      const connectionId = upsertConnection.data.id;
      const upsertWhatsappNumber = await supabase.from("whatsapp_numbers").upsert({
        clinic_id: clinicId,
        meta_phone_number_id: metaPhoneNumberId,
        display_phone_number: displayPhoneNumber,
        channel_connection_id: connectionId
      }, {
        onConflict: "meta_phone_number_id"
      }).select("id, meta_phone_number_id, display_phone_number, channel_connection_id").maybeSingle();
      if (upsertWhatsappNumber.error) {
        return json(500, {
          error: "DB upsert whatsapp number failed",
          details: upsertWhatsappNumber.error
        });
      }
      return json(200, {
        connection: upsertConnection.data,
        whatsappNumber: upsertWhatsappNumber.data
      });
    }
    if (action === "get_status") {
      const { data, error } = await supabase.from("channel_connections").select(`
          id,
          clinic_id,
          provider,
          channel,
          meta_waba_id,
          meta_phone_number_id,
          status,
          updated_at
        `).eq("clinic_id", clinicId).eq("provider", "meta").eq("channel", "whatsapp").maybeSingle();
      if (error) {
        return json(500, {
          error: "Failed to fetch whatsapp connection",
          details: error
        });
      }
      let whatsappNumber = null;
      if (data?.id) {
        const numberResp = await supabase.from("whatsapp_numbers").select("id, meta_phone_number_id, display_phone_number, channel_connection_id").eq("channel_connection_id", data.id).maybeSingle();
        if (!numberResp.error) {
          whatsappNumber = numberResp.data ?? null;
        }
      }
      return json(200, {
        connected: !!data,
        connection: data ?? null,
        whatsappNumber
      });
    }
    if (action === "disconnect") {
      const now = new Date().toISOString();
      const { data, error } = await supabase.from("channel_connections").update({
        status: "disconnected",
        updated_at: now
      }).eq("clinic_id", clinicId).eq("provider", "meta").eq("channel", "whatsapp").select("id, status").maybeSingle();
      if (error) {
        return json(500, {
          error: "Failed to disconnect whatsapp connection",
          details: error
        });
      }
      return json(200, {
        disconnected: true,
        connection: data ?? null
      });
    }
    return json(400, {
      error: "Invalid action"
    });
  } catch (e) {
    console.error("❌ whatsapp-connect error:", e);
    return json(500, {
      error: "Internal error"
    });
  }
});
