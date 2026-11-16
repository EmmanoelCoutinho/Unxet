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
 * E recupera as mensagens recebidas enquanto o número esteve fora
 * (_shared/inboundRecovery.ts): depois que a conexão volta, busca na Evolution
 * o que chegou desde a última mensagem recebida e importa o que falta.
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
import { RECOVERY_GATEWAY_BATCH, RECOVERY_LID_LOOKUP_CONCURRENCY, RECOVERY_MAX_LID_LOOKUPS, fetchLidPhone, fetchStoredMessages, importOutcome, isRateLimitError, gatewayQueueOutcome, knownLidPhones, lidPhoneMap, pickRecoverable, recoveredWebhookBody, recoveryExpired, recoveryPhase, recoveryWindow, unresolvedLids, withPhone } from "../_shared/inboundRecovery.ts";
import { WATCHDOG_WINDOW_MINUTES, restartInstance, watchdogDecision, watchdogNotification } from "../_shared/whatsappWatchdog.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";
const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") ?? "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const EVOLUTION_WEBHOOK_SECRET = Deno.env.get("EVOLUTION_WEBHOOK_SECRET") ?? "";
// Worker da fila de entrada (docs/fila-de-entrada.md), ex.: https://producao.unxet-entrada.workers.dev
// Sem ele, a recuperação chama o evolution-in direto (limitada pelo Supabase).
const INBOUND_GATEWAY_URL = Deno.env.get("INBOUND_GATEWAY_URL") ?? "";
const RECOVERY_GATEWAY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 8000;
// Recuperação: tempo e quantidade por rodada (o que sobrar fica para a próxima)
const RECOVERY_BUDGET_MS = 50_000;
const RECOVERY_MAX_IMPORTS = 150;
const RECOVERY_IMPORT_TIMEOUT_MS = 30_000;
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
/** Das mensagens guardadas na Evolution, as que o Unxet ainda não tem. */ async function missingRecords(supabase, records) {
  const known = new Set();
  for(let i = 0; i < records.length; i += 200){
    const ids = records.slice(i, i + 200).map((record)=>record.key.id);
    const { data, error } = await supabase.from("messages").select("meta_message_id").in("meta_message_id", ids);
    if (error) throw error;
    for (const row of data ?? [])known.add(row.meta_message_id);
  }
  return records.filter((record)=>!known.has(record.key.id));
}
/**
 * Entrega a mensagem recuperada ao evolution-in, como se fosse o webhook
 * dela: telefone, mídia, bloqueio e criação da conversa seguem o caminho de
 * sempre. O cabeçalho x-unxet-recovered evita bot e respostas automáticas.
 */ async function importRecovered(sessionName, record) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/evolution-in`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": EVOLUTION_WEBHOOK_SECRET,
        "x-internal-secret": INTERNAL_BOT_SECRET,
        "x-unxet-recovered": "1"
      },
      body: JSON.stringify(recoveredWebhookBody(sessionName, record)),
      signal: AbortSignal.timeout(RECOVERY_IMPORT_TIMEOUT_MS)
    });
    return importOutcome(response.status, await response.text().catch(()=>""));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Limite de chamadas entre funções: quem chamou para a rodada e loga uma vez só
    if (isRateLimitError(message)) return "rate_limited";
    console.warn("[INBOUND_RECOVERY_IMPORT_ERROR]", {
      sessionName,
      error: message
    });
    return "failed";
  }
}
/**
 * Manda as mensagens recuperadas para a fila de entrada (Worker no
 * Cloudflare), até 100 por pedido. A fila entrega ao evolution-in no ritmo
 * dela e tenta de novo se ele falhar, sem o limite de chamadas entre edge
 * functions. Devolve o que não entrou na fila (segue pelo caminho direto).
 */ async function enqueueRecovered(sessionName, records, result) {
  const url = `${INBOUND_GATEWAY_URL.replace(/\/$/, "")}/evolution-recovery`;
  const leftover = [];
  for(let i = 0; i < records.length; i += RECOVERY_GATEWAY_BATCH){
    const chunk = records.slice(i, i + RECOVERY_GATEWAY_BATCH);
    let outcome = null;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_BOT_SECRET,
          "x-webhook-secret": EVOLUTION_WEBHOOK_SECRET
        },
        body: JSON.stringify({
          webhooks: chunk.map((record)=>recoveredWebhookBody(sessionName, record))
        }),
        signal: AbortSignal.timeout(RECOVERY_GATEWAY_TIMEOUT_MS)
      });
      outcome = gatewayQueueOutcome(response.status, await response.text().catch(()=>""), chunk.length);
      if (!outcome) console.warn("[INBOUND_RECOVERY_QUEUE_FAILED]", { sessionName, status: response.status });
    } catch (err) {
      console.warn("[INBOUND_RECOVERY_QUEUE_FAILED]", {
        sessionName,
        error: err instanceof Error ? err.message : String(err)
      });
    }
    // Fila fora: este lote e os seguintes vão pelo caminho direto
    if (!outcome) return leftover.concat(records.slice(i));
    result.queued += outcome.queued;
    // Grandes demais para a fila: também pelo caminho direto
    for (const index of outcome.rejected)leftover.push(chunk[index]);
  }
  return leftover;
}
/**
 * Recupera as mensagens recebidas enquanto o número esteve fora. Roda nas
 * conexões que o gatilho mark_inbound_recovery marcou ao voltarem para
 * "connected". Nunca lança erro.
 */ async function runInboundRecovery(supabase) {
  const results = [];
  // Esbarrou no limite de chamadas entre funções: o resto fica para a próxima rodada
  let rateLimited = false;
  try {
    const { data: connections, error } = await supabase.from("channel_connections").select("id, session_name, evolution_api_url, evolution_api_key, inbound_recovery_requested_at, inbound_recovery_from").eq("provider", "evolution").eq("status", "connected").is("archived_at", null).not("session_name", "is", null).not("inbound_recovery_requested_at", "is", null);
    if (error) {
      console.error("[INBOUND_RECOVERY_QUERY_ERROR]", error);
      return results;
    }
    const startedAt = Date.now();
    let imports = 0;
    for (const connection of connections ?? []){
      const phase = recoveryPhase(connection.inbound_recovery_requested_at);
      if (phase === "wait") continue;
      const apiUrl = connection.evolution_api_url || EVOLUTION_API_URL;
      const apiKey = connection.evolution_api_key || EVOLUTION_API_KEY;
      const window = recoveryWindow(connection.inbound_recovery_from);
      const result = {
        id: connection.id,
        found: 0,
        missing: 0,
        imported: 0,
        // Descartadas pelo evolution-in, por motivo (ex.: contato bloqueado)
        ignored: {},
        // Sem o telefone do contato (@lid): não há como importar
        unresolved: 0,
        // Entregues à fila de entrada (o evolution-in recebe pela fila)
        queued: 0,
        failed: 0,
        rateLimited: false,
        truncated: false,
        done: false
      };
      let complete = true;
      if (window && apiUrl && apiKey) {
        const stored = await fetchStoredMessages(apiUrl, apiKey, connection.session_name, window);
        if (!stored) {
          complete = false;
        } else {
          const candidates = pickRecoverable(stored.records);
          const missing = await missingRecords(supabase, candidates);
          result.found = candidates.length;
          result.missing = missing.length;
          result.truncated = stored.truncated;
          // Telefone das mensagens do histórico que vieram só com o @lid
          const lidMap = lidPhoneMap(stored.records);
          // Quem já escreveu antes: o Unxet tem o @lid e o telefone do contato
          const lidsBefore = unresolvedLids(missing, lidMap);
          if (lidsBefore.length > 0) {
            const { data: known, error: knownError } = await supabase.rpc("inbound_recovery_lid_phones", {
              p_connection_id: connection.id,
              p_lids: lidsBefore
            });
            if (knownError) console.warn("[INBOUND_RECOVERY_LID_QUERY_ERROR]", connection.id, knownError);
            for (const [lid, phone] of knownLidPhones(known))lidMap.set(lid, phone);
          }
          const lids = unresolvedLids(missing, lidMap);
          // Contatos que passaram do teto de buscas são procurados na próxima rodada
          if (lids.length > RECOVERY_MAX_LID_LOOKUPS) complete = false;
          // Em paralelo, poucos de cada vez (são consultas à Evolution)
          const toLookUp = lids.slice(0, RECOVERY_MAX_LID_LOOKUPS);
          for(let i = 0; i < toLookUp.length; i += RECOVERY_LID_LOOKUP_CONCURRENCY){
            await Promise.all(toLookUp.slice(i, i + RECOVERY_LID_LOOKUP_CONCURRENCY).map(async (lid)=>{
              const phone = await fetchLidPhone(apiUrl, apiKey, connection.session_name, lid);
              if (phone) lidMap.set(lid, phone);
            }));
          }
          const ready = [];
          for (const record of missing){
            const withNumber = withPhone(record, lidMap);
            if (withNumber) ready.push(withNumber);
            else result.unresolved += 1;
          }
          // Caminho principal: tudo para a fila de entrada, em lotes. O que a
          // fila não aceitou segue pelo caminho direto, mais lento.
          const leftover = INBOUND_GATEWAY_URL ? await enqueueRecovered(connection.session_name, ready, result) : ready;
          for (const record of leftover){
            if (rateLimited || imports >= RECOVERY_MAX_IMPORTS || Date.now() - startedAt > RECOVERY_BUDGET_MS) {
              complete = false;
              break;
            }
            imports += 1;
            const outcome = await importRecovered(connection.session_name, record);
            if (outcome === "rate_limited") {
              rateLimited = true;
              result.rateLimited = true;
              complete = false;
              break;
            }
            if (outcome === "imported") result.imported += 1;
            else if (outcome === "failed") {
              result.failed += 1;
              // Tenta de novo na próxima rodada
              complete = false;
            } else {
              const reason = outcome.replace(/^ignored:/, "");
              result.ignored[reason] = (result.ignored[reason] ?? 0) + 1;
            }
          }
        }
      }
      // Última rodada e nada ficou para trás: limpa a marca. A comparação com
      // a hora da marca evita apagar uma reconexão que aconteceu nesse meio-tempo.
      const expired = recoveryExpired(connection.inbound_recovery_requested_at);
      if (phase === "last" && (complete || expired)) {
        const { error: clearError } = await supabase.from("channel_connections").update({
          inbound_recovery_requested_at: null,
          inbound_recovery_from: null
        }).eq("id", connection.id).eq("inbound_recovery_requested_at", connection.inbound_recovery_requested_at);
        if (clearError) console.error("[INBOUND_RECOVERY_CLEAR_ERROR]", connection.id, clearError);
      }
      result.done = phase === "last" && (complete || expired);
      if (result.missing > 0 || result.truncated || result.done) results.push(result);
    }
  } catch (err) {
    console.error("[INBOUND_RECOVERY_ERROR]", err);
  }
  if (rateLimited) console.warn("[INBOUND_RECOVERY_RATE_LIMITED]", "limite de chamadas entre funções; o restante fica para a próxima rodada");
  if (results.length > 0) console.log("[INBOUND_RECOVERY]", JSON.stringify(results));
  return results;
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
    const { data: connections, error } = await supabase.from("channel_connections").select("id, session_name, status, evolution_api_url, evolution_api_key, groups_enabled").eq("provider", "evolution").in("status", [
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
      // (grupos conforme a opção do número, sem histórico). Normalmente é só uma leitura.
      if (result.exists) {
        const settings = await ensureInstanceSettings(apiUrl, apiKey, connection.session_name, {
          groupsEnabled: connection.groups_enabled === true
        });
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
    const recovery = await runInboundRecovery(supabase);
    return new Response(JSON.stringify({
      success: true,
      checked: connections?.length ?? 0,
      changes,
      watchdog,
      recovery
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
