import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractWabaIds, metaErrorMessage, parsePhoneNumbers } from "../_shared/whatsappSignup.ts";
import { clinicCanUseWhatsappNumber, PLAN_LIMIT_MESSAGES } from "../_shared/plan.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// App Meta de WhatsApp (o mesmo de VITE_META_APP_WABA_ID no front)
const META_WABA_APP_ID = Deno.env.get("META_WABA_APP_ID") ?? "";
const META_WABA_APP_SECRET = Deno.env.get("META_WABA_APP_SECRET") ?? "";
// Precisa ser idêntico ao redirect_uri usado no dialog/oauth (VITE_META_REDIRECT_URI)
const META_REDIRECT_URI = Deno.env.get("META_WABA_REDIRECT_URI") || Deno.env.get("META_REDIRECT_URI") || "";
const GRAPH = "https://graph.facebook.com/v21.0";
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
async function graphGet(path, params = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params))url.searchParams.set(k, String(v));
  const resp = await fetch(url.toString(), {
    method: "GET"
  });
  const body = await resp.json().catch(()=>({}));
  return {
    ok: resp.ok,
    status: resp.status,
    body
  };
}
async function graphPost(path, accessToken) {
  const resp = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const body = await resp.json().catch(()=>({}));
  return {
    ok: resp.ok,
    status: resp.status,
    body
  };
}
// Erro do fluxo de conexão: `error` é a mensagem mostrada ao usuário no front
const signupError = (status, error, meta)=>json(status, {
    error,
    meta: meta ?? null
  });
async function persistConnection(supabase, clinicId, { metaWabaId, metaPhoneNumberId, accessToken, displayPhoneNumber }) {
  // Reconectar o próprio número oficial não ocupa vaga nova no plano
  const { data: currentOfficial } = await supabase.from("channel_connections").select("id").eq("clinic_id", clinicId).eq("provider", "meta").eq("channel", "whatsapp").maybeSingle();
  if (!await clinicCanUseWhatsappNumber(supabase, clinicId, currentOfficial?.id ?? null)) {
    return signupError(403, PLAN_LIMIT_MESSAGES.whatsapp);
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
// Embedded signup: troca o code do dialog/oauth por token, descobre o WABA e o
// número concedidos, assina o app no WABA (webhook) e grava a conexão.
async function exchangeCode(supabase, clinicId, code) {
  if (!META_WABA_APP_ID || !META_WABA_APP_SECRET || !META_REDIRECT_URI) {
    console.error("❌ whatsapp-connect: META_WABA_APP_ID / META_WABA_APP_SECRET / META_REDIRECT_URI ausentes");
    return signupError(500, "Integração com o WhatsApp não configurada no servidor.");
  }
  const ex = await graphGet("oauth/access_token", {
    client_id: META_WABA_APP_ID,
    client_secret: META_WABA_APP_SECRET,
    redirect_uri: META_REDIRECT_URI,
    code
  });
  let accessToken = String(ex.body?.access_token ?? "").trim();
  if (!ex.ok || !accessToken) {
    console.error("❌ whatsapp-connect: troca do code falhou", ex.status, ex.body);
    const detail = metaErrorMessage(ex.body);
    return signupError(502, `A Meta recusou a autorização${detail ? `: ${detail}` : ""}. Tente conectar novamente.`, ex.body);
  }
  // Token de usuário comum expira em ~1h; tenta estender. O token de system
  // user do embedded signup não precisa (a chamada falha e mantemos o original).
  const ll = await graphGet("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: META_WABA_APP_ID,
    client_secret: META_WABA_APP_SECRET,
    fb_exchange_token: accessToken
  });
  if (ll.ok && ll.body?.access_token) accessToken = String(ll.body.access_token).trim();
  const debug = await graphGet("debug_token", {
    input_token: accessToken,
    access_token: `${META_WABA_APP_ID}|${META_WABA_APP_SECRET}`
  });
  if (!debug.ok) {
    console.error("❌ whatsapp-connect: debug_token falhou", debug.status, debug.body);
    return signupError(502, "Não foi possível validar a autorização com a Meta.", debug.body);
  }
  const wabaIds = extractWabaIds(debug.body?.data);
  if (wabaIds.length === 0) {
    return signupError(422, "Nenhuma conta do WhatsApp Business foi compartilhada na autorização. Conecte novamente e selecione a conta e o número.");
  }
  // Uma conexão por empresa: usa o primeiro WABA que tiver número
  let metaWabaId = "";
  let phone = null;
  for (const wabaId of wabaIds){
    const numbers = await graphGet(`${wabaId}/phone_numbers`, {
      fields: "id,display_phone_number,verified_name",
      access_token: accessToken
    });
    if (!numbers.ok) {
      console.error("❌ whatsapp-connect: phone_numbers falhou", wabaId, numbers.status, numbers.body);
      continue;
    }
    const list = parsePhoneNumbers(numbers.body);
    if (list.length > 0) {
      if (wabaIds.length > 1 || list.length > 1) {
        console.warn("⚠️ whatsapp-connect: mais de um WABA/número concedido; usando o primeiro", {
          wabaIds,
          wabaId,
          numbers: list.map((n)=>n.id)
        });
      }
      metaWabaId = wabaId;
      phone = list[0];
      break;
    }
  }
  if (!phone) {
    return signupError(422, "A conta do WhatsApp Business compartilhada não tem número de telefone. Adicione um número na Meta e conecte novamente.");
  }
  // Sem a assinatura o meta-webhook não recebe as mensagens desse WABA
  const sub = await graphPost(`${metaWabaId}/subscribed_apps`, accessToken);
  if (!sub.ok) {
    console.error("❌ whatsapp-connect: subscribed_apps falhou", metaWabaId, sub.status, sub.body);
    const detail = metaErrorMessage(sub.body);
    return signupError(502, `Não foi possível ativar o recebimento de mensagens do número${detail ? `: ${detail}` : ""}.`, sub.body);
  }
  return persistConnection(supabase, clinicId, {
    metaWabaId,
    metaPhoneNumberId: phone.id,
    accessToken,
    displayPhoneNumber: phone.displayPhoneNumber
  });
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
      return persistConnection(supabase, clinicId, {
        metaWabaId,
        metaPhoneNumberId,
        accessToken,
        displayPhoneNumber
      });
    }
    if (action === "exchange_code") {
      const code = String(body.code ?? "").trim();
      if (!code) {
        return json(400, {
          error: "code is required"
        });
      }
      return exchangeCode(supabase, clinicId, code);
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
