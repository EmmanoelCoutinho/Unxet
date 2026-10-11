/**
 * evolution-connection-sync — Confere o estado real das instâncias da Evolution
 *
 * O status de channel_connections depende do webhook CONNECTION_UPDATE
 * (evolution-in). Quando o cliente remove o aparelho em "Dispositivos
 * conectados" no WhatsApp, esse evento pode não chegar; esta função consulta
 * /instance/connectionState de cada conexão e corrige o que estiver diferente.
 *
 * Chamada a cada 5 minutos pelo pg_cron (migration
 * 20261011000000_evolution_connection_sync_cron.sql), autenticada pelo header
 * x-internal-secret (INTERNAL_BOT_SECRET).
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/security.ts";
import { reconcileConnectionStatus } from "../_shared/evolutionWebhook.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";
const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") ?? "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const REQUEST_TIMEOUT_MS = 8000;
/**
 * Consulta o estado da instância. Retorna null quando a Evolution não
 * respondeu de forma confiável (rede, timeout, 5xx) — nesse caso não mexemos
 * no status.
 */ async function fetchInstanceState(apiUrl, apiKey, sessionName) {
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/instance/connectionState/${encodeURIComponent(sessionName)}`, {
      method: "GET",
      headers: {
        apikey: apiKey
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return {
        exists: false,
        state: null
      };
    }
    if (!response.ok) {
      console.warn("[CONNECTION_SYNC_EVOLUTION_ERROR]", {
        sessionName,
        status: response.status
      });
      await response.body?.cancel();
      return null;
    }
    const data = await response.json();
    const state = data?.instance?.state ?? data?.state ?? data?.status ?? null;
    return {
      exists: true,
      state: state ? String(state) : null
    };
  } catch (err) {
    console.warn("[CONNECTION_SYNC_FETCH_FAILED]", {
      sessionName,
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}
serve(async (req)=>{
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405
      });
    }
    const providedSecret = req.headers.get("x-internal-secret") ?? "";
    if (!INTERNAL_BOT_SECRET || !timingSafeEqual(providedSecret, INTERNAL_BOT_SECRET)) {
      return new Response("Unauthorized", {
        status: 401
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // "connecting" fica de fora: é o fluxo do QR Code, controlado pelo webhook
    const { data: connections, error } = await supabase.from("channel_connections").select("id, session_name, status, evolution_api_url, evolution_api_key").eq("provider", "evolution").in("status", [
      "connected",
      "disconnected"
    ]).not("session_name", "is", null);
    if (error) {
      console.error("[CONNECTION_SYNC_QUERY_ERROR]", error);
      return new Response(JSON.stringify({
        success: false
      }), {
        status: 500
      });
    }
    const changes = [];
    await Promise.all((connections ?? []).map(async (connection)=>{
      const apiUrl = connection.evolution_api_url || EVOLUTION_API_URL;
      const apiKey = connection.evolution_api_key || EVOLUTION_API_KEY;
      if (!apiUrl || !apiKey) return;
      const result = await fetchInstanceState(apiUrl, apiKey, connection.session_name);
      if (!result) return;
      const nextStatus = reconcileConnectionStatus(connection.status, result.state, result.exists);
      if (!nextStatus) return;
      const now = new Date().toISOString();
      const patch = nextStatus === "connected" ? {
        status: "connected",
        qr_code: null,
        last_connection_at: now,
        updated_at: now
      } : {
        status: "disconnected",
        last_disconnection_at: now,
        updated_at: now
      };
      // .eq("status") evita sobrescrever uma mudança feita pelo webhook nesse meio-tempo
      const { error: updateError } = await supabase.from("channel_connections").update(patch).eq("id", connection.id).eq("status", connection.status);
      if (updateError) {
        console.error("[CONNECTION_SYNC_UPDATE_ERROR]", connection.id, updateError);
        return;
      }
      changes.push({
        id: connection.id,
        from: connection.status,
        to: nextStatus,
        evolutionState: result.state,
        instanceExists: result.exists
      });
    }));
    console.log("[CONNECTION_SYNC]", JSON.stringify({
      checked: connections?.length ?? 0,
      changes
    }));
    return new Response(JSON.stringify({
      success: true,
      checked: connections?.length ?? 0,
      changes
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("[CONNECTION_SYNC_FATAL_ERROR]", err);
    return new Response(JSON.stringify({
      success: false
    }), {
      status: 500
    });
  }
});
