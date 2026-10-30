// deno-lint-ignore-file
// @ts-nocheck
/**
 * deal-task-reminders — lembrete (push) das tarefas do funil de vendas
 *
 * Chamada a cada minuto pelo pg_cron (migration 20261026000000_leads_kanban),
 * só quando há tarefa vencendo; autenticada pelo header x-internal-secret
 * (INTERNAL_BOT_SECRET).
 *
 * claim_deal_task_reminders já marca as tarefas como avisadas (reminded_at),
 * então cada tarefa gera um aviso só. Quem recebe: o responsável pela tarefa;
 * sem ele, o responsável pela negociação; sem ele, quem criou a tarefa.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/security.ts";
import { sendPushToUsers } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";
const MAX_PER_RUN = 100;

const TYPE_LABEL: Record<string, string> = {
  call: "Ligar",
  message: "Mandar mensagem",
  meeting: "Reunião",
  other: "Tarefa",
};

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const providedSecret = req.headers.get("x-internal-secret") ?? "";
    if (!INTERNAL_BOT_SECRET || !timingSafeEqual(providedSecret, INTERNAL_BOT_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: tasks, error } = await supabase.rpc("claim_deal_task_reminders", {
      p_max: MAX_PER_RUN,
    });
    if (error) {
      console.error("[DEAL_REMINDER_CLAIM_ERROR]", error);
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    }

    let sent = 0;
    for (const task of tasks ?? []) {
      if (!task.user_id) continue;
      try {
        const who = task.contact_name || task.deal_title || "Negociação";
        await sendPushToUsers(supabase, [task.user_id], {
          title: `${TYPE_LABEL[task.task_type] ?? "Tarefa"}: ${task.title}`,
          body: `${who} · funil de vendas`,
          // Agrupa por tarefa no aparelho (ver public/sw.js)
          conversationId: `deal-task-${task.task_id}`,
          url: `/inbox/leads?deal=${task.deal_id}`,
        });
        sent++;
      } catch (err) {
        console.error("[DEAL_REMINDER_PUSH_ERROR]", task.task_id, err instanceof Error ? err.message : String(err));
      }
    }

    console.log("[DEAL_REMINDERS]", JSON.stringify({ claimed: tasks?.length ?? 0, sent }));
    return new Response(JSON.stringify({ success: true, claimed: tasks?.length ?? 0, sent }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[DEAL_REMINDERS_FATAL_ERROR]", err);
    return new Response(JSON.stringify({ success: false }), { status: 500 });
  }
});
