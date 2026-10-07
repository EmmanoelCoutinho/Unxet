import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const META_REDIRECT_URI = Deno.env.get("META_REDIRECT_URI") ?? "";
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
async function graphGet(path, token) {
  const url = new URL(`https://graph.facebook.com/v21.0/${path}`);
  if (token) url.searchParams.set("access_token", token);
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
async function graphPost(path, payload) {
  const url = new URL(`https://graph.facebook.com/v21.0/${path}`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)){
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) body.set(k, v.join(","));
    else body.set(k, String(v));
  }
  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const jsonBody = await resp.json().catch(()=>({}));
  return {
    ok: resp.ok,
    status: resp.status,
    body: jsonBody
  };
}
async function exchangeCodeForToken(code) {
  const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("client_secret", META_APP_SECRET);
  url.searchParams.set("redirect_uri", META_REDIRECT_URI);
  url.searchParams.set("code", code);
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
async function exchangeForLongLived(userAccessToken) {
  const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("client_secret", META_APP_SECRET);
  url.searchParams.set("fb_exchange_token", userAccessToken);
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
/**
 * ✅ Instagram OAuth (instagram.com) token exchange
 * Obs: esse endpoint é do fluxo OAuth do Instagram, não do Graph oauth/access_token.
 */ async function exchangeIgCodeForToken(code) {
  const url = "https://api.instagram.com/oauth/access_token";
  const form = new URLSearchParams();
  form.set("client_id", META_APP_ID);
  form.set("client_secret", META_APP_SECRET);
  form.set("grant_type", "authorization_code");
  form.set("redirect_uri", META_REDIRECT_URI);
  form.set("code", code);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });
  const body = await resp.json().catch(()=>({}));
  return {
    ok: resp.ok,
    status: resp.status,
    body
  };
}
async function requireClinicAdmin(supabase, clinicId, userId) {
  const { data, error } = await supabase.from("clinic_users").select("role").eq("clinic_id", clinicId).eq("user_id", userId).maybeSingle();
  if (error || !data) return false;
  return String(data.role) === "admin";
}
serve(async (req)=>{
  try {
    if (req.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
    if (req.method !== "POST") return json(405, {
      error: "Method not allowed"
    });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, {
        error: "Misconfigured env"
      });
    }
    if (!META_APP_ID || !META_APP_SECRET || !META_REDIRECT_URI) {
      return json(500, {
        error: "Meta OAuth env missing"
      });
    }
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    if (!jwt) return json(401, {
      error: "Missing auth"
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    const userId = userData?.user?.id ?? null;
    if (userErr || !userId) return json(401, {
      error: "Invalid auth"
    });
    const body = await req.json().catch(()=>({}));
    const action = body.action ?? "exchange_code";
    const clinicId = String(body.clinicId ?? "").trim();
    if (!clinicId) return json(400, {
      error: "clinicId is required"
    });
    const isAdmin = await requireClinicAdmin(supabase, clinicId, userId);
    if (!isAdmin) return json(403, {
      error: "Forbidden"
    });
    let userAccessToken = String(body.userAccessToken ?? "").trim();
    // ✅ STEP 1: Facebook OAuth -> list pages
    if (action === "exchange_code") {
      const code = String(body.code ?? "").trim();
      if (!code) return json(400, {
        error: "code is required"
      });
      const ex = await exchangeCodeForToken(code);
      if (!ex.ok) return json(502, {
        error: "Meta token exchange failed",
        meta: ex.body
      });
      userAccessToken = String(ex.body?.access_token ?? "").trim();
      if (!userAccessToken) return json(502, {
        error: "Missing access_token from Meta",
        meta: ex.body
      });
      const ll = await exchangeForLongLived(userAccessToken);
      if (ll.ok && ll.body?.access_token) {
        userAccessToken = String(ll.body.access_token).trim();
      }
      const pagesResp = await graphGet("me/accounts?fields=id,name,access_token", userAccessToken);
      if (!pagesResp.ok) return json(502, {
        error: "Meta pages fetch failed",
        meta: pagesResp.body
      });
      const pages = Array.isArray(pagesResp.body?.data) ? pagesResp.body.data : [];
      if (pages.length === 0) return json(200, {
        pages: [],
        needsSelection: false
      });
      if (pages.length === 1) {
        const p = pages[0];
        return json(200, {
          pages,
          needsSelection: false,
          suggested: {
            pageId: p.id,
            pageName: p.name
          },
          userAccessToken
        });
      }
      return json(200, {
        pages,
        needsSelection: true,
        userAccessToken
      });
    }
    // ✅ STEP 2: Connect page + subscribe page fields + discover IG user id (for DB)
    if (action === "connect_page") {
      const pageId = String(body.pageId ?? "").trim();
      if (!pageId) return json(400, {
        error: "pageId is required"
      });
      if (!userAccessToken) return json(400, {
        error: "userAccessToken is required"
      });
      const pagesResp = await graphGet("me/accounts?fields=id,name,access_token", userAccessToken);
      if (!pagesResp.ok) return json(502, {
        error: "Meta pages fetch failed",
        meta: pagesResp.body
      });
      const pages = Array.isArray(pagesResp.body?.data) ? pagesResp.body.data : [];
      const page = pages.find((p)=>String(p?.id) === pageId);
      if (!page?.access_token) return json(404, {
        error: "Page not found or missing page token"
      });
      const pageAccessToken = String(page.access_token).trim();
      const subPage = await graphPost(`${pageId}/subscribed_apps`, {
        subscribed_fields: [
          "messages",
          "messaging_postbacks",
          "message_deliveries",
          "message_reads"
        ],
        access_token: pageAccessToken
      });
      console.log("SUBSCRIBE PAGE:", subPage.status, JSON.stringify(subPage.body));
      if (!subPage.ok) {
        return json(502, {
          error: "Meta subscribe page failed",
          meta: subPage.body
        });
      }
      const igResp = await graphGet(`${pageId}?fields=instagram_business_account,connected_instagram_account`, pageAccessToken);
      console.log("IG lookup:", JSON.stringify(igResp.body));
      const igUserId = String(igResp.ok ? igResp.body?.instagram_business_account?.id ?? igResp.body?.connected_instagram_account?.id ?? "" : "").trim();
      if (igUserId) {
        console.log("✅ IG User ID encontrado:", igUserId);
        console.log("ℹ️ Para receber DMs do Instagram: configure Webhooks (Instagram -> messages) no painel do app.");
      }
      const now = new Date().toISOString();
      const upsertMessenger = await supabase.from("channel_connections").upsert({
        clinic_id: clinicId,
        provider: "meta",
        channel: "messenger",
        meta_page_id: pageId,
        access_token: pageAccessToken,
        status: "connected",
        updated_at: now
      }, {
        onConflict: "clinic_id,provider,channel"
      }).select("id").maybeSingle();
      if (upsertMessenger.error) {
        return json(500, {
          error: "DB upsert messenger failed",
          details: upsertMessenger.error
        });
      }
      let instagramConnectionId = null;
      if (igUserId) {
        const upsertInstagram = await supabase.from("channel_connections").upsert({
          clinic_id: clinicId,
          provider: "meta",
          channel: "instagram",
          meta_page_id: pageId,
          meta_ig_user_id: igUserId,
          access_token: pageAccessToken,
          status: "connected",
          updated_at: now
        }, {
          onConflict: "clinic_id,provider,channel"
        }).select("id").maybeSingle();
        if (upsertInstagram.error) {
          return json(500, {
            error: "DB upsert instagram failed",
            details: upsertInstagram.error
          });
        }
        instagramConnectionId = upsertInstagram.data?.id ?? null;
      }
      const checkSubs = await graphGet(`${pageId}/subscribed_apps`, pageAccessToken);
      if (!checkSubs.ok) {
        console.log("⚠️ Could not read subscribed_apps:", checkSubs.status, JSON.stringify(checkSubs.body));
      } else {
        const list = Array.isArray(checkSubs.body?.data) ? checkSubs.body.data : [];
        console.log("✅ subscribed_apps count:", list.length);
      }
      return json(200, {
        messenger: {
          pageId,
          connectionId: upsertMessenger.data?.id ?? null
        },
        instagram: igUserId ? {
          igUserId,
          connectionId: instagramConnectionId
        } : null
      });
    }
    /**
     * ✅ STEP 3: Instagram OAuth callback (instagram.com/oauth/authorize -> code)
     * Aqui finalizamos a autorização do IG e persistimos o token/ig_user_id se vier.
     *
     * Obs: O IG oauth retorna geralmente: { access_token, user_id }
     */ if (action === "exchange_ig_code") {
      const pageId = String(body.pageId ?? "").trim();
      const code = String(body.code ?? "").trim();
      if (!pageId) return json(400, {
        error: "pageId is required"
      });
      if (!code) return json(400, {
        error: "code is required"
      });
      const igEx = await exchangeIgCodeForToken(code);
      console.log("IG TOKEN EXCHANGE:", igEx.status, JSON.stringify(igEx.body));
      if (!igEx.ok) {
        return json(502, {
          error: "Instagram token exchange failed",
          meta: igEx.body
        });
      }
      const igAccessToken = String(igEx.body?.access_token ?? "").trim();
      const igUserId = String(igEx.body?.user_id ?? "").trim();
      const now = new Date().toISOString();
      // Atualiza a conexão instagram do clinic para marcar que IG OAuth foi concluído
      const upsertInstagram = await supabase.from("channel_connections").upsert({
        clinic_id: clinicId,
        provider: "meta",
        channel: "instagram",
        meta_page_id: pageId,
        meta_ig_user_id: igUserId || null,
        // guardamos o token IG aqui (se vier).
        // Se você preferir guardar em outra coluna, troque aqui.
        access_token: igAccessToken || null,
        status: "connected",
        updated_at: now
      }, {
        onConflict: "clinic_id,provider,channel"
      }).select("id, meta_ig_user_id, status").maybeSingle();
      if (upsertInstagram.error) {
        return json(500, {
          error: "DB upsert instagram (ig oauth) failed",
          details: upsertInstagram.error
        });
      }
      return json(200, {
        instagram: {
          connectionId: upsertInstagram.data?.id ?? null,
          igUserId: upsertInstagram.data?.meta_ig_user_id ?? igUserId ?? null,
          status: upsertInstagram.data?.status ?? "connected"
        }
      });
    }
    return json(400, {
      error: "Invalid action"
    });
  } catch (e) {
    console.error("❌ meta-connect error:", e);
    return json(500, {
      error: "Internal error"
    });
  }
});
