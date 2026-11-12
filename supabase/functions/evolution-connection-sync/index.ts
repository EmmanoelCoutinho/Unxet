/**
 * evolution-connection-sync — Confere o estado real das instâncias da Evolution
 *
 * O status de channel_connections depende do webhook CONNECTION_UPDATE
 * (evolution-in). Quando o cliente remove o aparelho em "Dispositivos
 * conectados" no WhatsApp, esse evento pode não chegar; esta função consulta
 * /instance/connectionState de cada conexão e corrige o que estiver diferente.
 *
 * Também faz o papel de vigia (_shared/whatsappWatchdog.ts): número conectado
 * que costuma receber mensagens e ficou em silêncio é reiniciado sozinho; se
 * continuar sem receber, os administradores são avisados.
 *
 * Chamada a cada 5 minutos pelo pg_cron (migration
 * 20261011000000_evolution_connection_sync_cron.sql), autenticada pelo header
 * x-internal-secret (INTERNAL_BOT_SECRET).
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/security.ts";
import { reconcileConnectionStatus } from "../_shared/evolutionWebhook.ts";
import { connectionRejectionReason, rejectConnection } from "../_shared/evolutionLimit.ts";
import { ensureInstanceSettings } from "../_shared/evolutionSettings.ts";
import { sendPushToUsers } from "../_shared/push.ts";
import { WATCHDOG_WINDOW_MINUTES, restartInstance, watchdogDecision, watchdogNotification } from "../_shared/whatsappWatchdog.ts";
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
const INTEGRATIONS_URL = "/settings/integrations/meta";
/** Sino (e push, no aviso que pede ação) para os administradores da empresa. */ async function notifyAdmins(supabase, activity, kind) {
  const notification = watchdogNotification(kind, activity);
  const { data: admins, error } = await supabase.from("clinic_users").select("user_id").eq("clinic_id", activity.clinic_id).eq("role", "admin");
  if (error) {
    console.error("[WATCHDOG_ADMINS_ERROR]", activity.connection_id, error);
    return;
  }
  const userIds = [
    ...new Set((admins ?? []).map((row)=>row.user_id).filter(Boolean))
  ];
  if (userIds.length === 0) return;
  const { error: insertError } = await supabase.from("user_notifications").insert(userIds.map((userId)=>({
      user_id: userId,
      clinic_id: activity.clinic_id,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      url: INTEGRATIONS_URL
    })));
  if (insertError) console.error("[WATCHDOG_NOTIFY_ERROR]", activity.connection_id, insertError);
  if (kind !== "alert") return;
  await sendPushToUsers(supabase, userIds, {
    title: notification.title,
    body: notification.body,
    conversationId: `whatsapp-watchdog:${activity.connection_id}`,
    url: INTEGRATIONS_URL
  });
}
/**
 * Vigia: reinicia o número que ficou em silêncio fora do normal. Só olha as
 * instâncias que a Evolution acabou de informar como abertas. Nunca lança
 * erro: uma falha aqui não pode atrapalhar a conferência das conexões.
 */ async function runWatchdog(supabase, openConnectionIds) {
  const actions = [];
  try {
    if (openConnectionIds.size === 0) return actions;
    const { data: activities, error } = await supabase.rpc("whatsapp_inbound_activity", {
      p_window_minutes: WATCHDOG_WINDOW_MINUTES
    });
    if (error) {
      console.error("[WATCHDOG_QUERY_ERROR]", error);
      return actions;
    }
    for (const activity of activities ?? []){
      if (!openConnectionIds.has(activity.connection_id)) continue;
      const decision = watchdogDecision(activity);
      if (decision !== "restart" && decision !== "alert") continue;
      const now = new Date().toISOString();
      if (decision === "restart") {
        const apiUrl = activity.evolution_api_url || EVOLUTION_API_URL;
        const apiKey = activity.evolution_api_key || EVOLUTION_API_KEY;
        if (!apiUrl || !apiKey) continue;
        const restarted = await restartInstance(apiUrl, apiKey, activity.session_name);
        // Marca mesmo se a Evolution recusou, para não insistir a cada 5 minutos
        const { error: markError } = await supabase.from("channel_connections").update({
          watchdog_restarted_at: now
        }).eq("id", activity.connection_id);
        if (markError) console.error("[WATCHDOG_MARK_ERROR]", activity.connection_id, markError);
        if (restarted) await notifyAdmins(supabase, activity, "restart");
        actions.push({
          id: activity.connection_id,
          action: "restart",
          restarted,
          baseline: activity.baseline_counts
        });
        continue;
      }
      const { error: markError } = await supabase.from("channel_connections").update({
        watchdog_alerted_at: now
      }).eq("id", activity.connection_id);
      if (markError) console.error("[WATCHDOG_MARK_ERROR]", activity.connection_id, markError);
      await notifyAdmins(supabase, activity, "alert");
      actions.push({
        id: activity.connection_id,
        action: "alert",
        baseline: activity.baseline_counts
      });
    }
  } catch (err) {
    console.error("[WATCHDOG_ERROR]", err);
  }
  if (actions.length > 0) console.log("[WATCHDOG]", JSON.stringify(actions));
  return actions;
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
    // "connecting" fica de fora: é o fluxo do QR Code, controlado pelo webhook.
    // Número removido (archived_at) não tem mais instância na Evolution.
    const { data: connections, error } = await supabase.from("channel_connections").select("id, session_name, status, evolution_api_url, evolution_api_key").eq("provider", "evolution").in("status", [
      "connected",
      "disconnected"
    ]).not("session_name", "is", null).is("archived_at", null);
    if (error) {
      console.error("[CONNECTION_SYNC_QUERY_ERROR]", error);
      return new Response(JSON.stringify({
        success: false
      }), {
        status: 500
      });
    }
    const changes = [];
    const settingsUpdated = [];
    const openConnectionIds = new Set();
    await Promise.all((connections ?? []).map(async (connection)=>{
      const apiUrl = connection.evolution_api_url || EVOLUTION_API_URL;
      const apiKey = connection.evolution_api_key || EVOLUTION_API_KEY;
      if (!apiUrl || !apiKey) return;
      const result = await fetchInstanceState(apiUrl, apiKey, connection.session_name);
      if (!result) return;
      // Corrige instâncias antigas ou alteradas no Evolution Manager
      // (ignorar grupos, sem histórico). Normalmente é só uma leitura.
      if (result.exists) {
        const settings = await ensureInstanceSettings(apiUrl, apiKey, connection.session_name);
        if (settings === "updated") settingsUpdated.push(connection.id);
      }
      if (connection.status === "connected" && (result.state === "open" || result.state === "connected")) {
        openConnectionIds.add(connection.id);
      }
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
      const rejection = connectionRejectionReason(updateError);
      if (rejection) {
        // Número que nunca tinha conectado e passou do limite (ou celular repetido)
        await rejectConnection(supabase, connection, apiUrl, apiKey, rejection);
        return;
      }
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
      changes,
      settingsUpdated
    }));
    const watchdog = await runWatchdog(supabase, openConnectionIds);
    return new Response(JSON.stringify({
      success: true,
      checked: connections?.length ?? 0,
      changes,
      watchdog
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
