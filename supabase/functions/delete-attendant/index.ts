// deno-lint-ignore-file
// @ts-nocheck
/**
 * delete-attendant — exclui um atendente do sistema (não apenas remove o acesso).
 *
 * - Somente administradores da clínica podem excluir.
 * - Não é possível excluir a si mesmo nem o último administrador.
 * - Conversas em atendimento com a pessoa voltam para a fila (pending).
 * - O vínculo (clinic_users) é removido e a conta do Supabase Auth é excluída
 *   de forma lógica (soft delete): o login deixa de funcionar e o e-mail fica
 *   livre para um novo convite, mas o histórico (eventos de conversa, bots
 *   criados etc.) continua íntegro, sem quebrar chaves estrangeiras.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser, getClinicMembership } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

const log = (step: string, payload: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    fn: "delete-attendant",
    step,
    ...payload
  }));

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const requester = await getAuthenticatedUser(req);
    if (!requester) return json(401, { error: "Unauthorized" });

    const body = await req.json().catch(() => ({}));
    const clinicId = body?.clinic_id?.toString().trim();
    const userId = body?.user_id?.toString().trim();
    if (!clinicId || !userId) {
      return json(400, { error: "clinic_id e user_id são obrigatórios" });
    }

    if (userId === requester.id) {
      return json(400, { error: "Você não pode excluir a sua própria conta." });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const requesterMembership = await getClinicMembership(admin, requester.id, clinicId);
    if (!requesterMembership || requesterMembership.role !== "admin") {
      log("forbidden_not_admin", { requesterId: requester.id, clinicId });
      return json(403, { error: "Forbidden" });
    }

    const target = await getClinicMembership(admin, userId, clinicId);
    if (!target) {
      return json(404, { error: "Atendente não encontrado nesta empresa." });
    }

    if (target.role === "admin") {
      const { count, error: countErr } = await admin
        .from("clinic_users")
        .select("user_id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("role", "admin");
      if (countErr) return json(500, { error: countErr.message });
      if ((count ?? 0) <= 1) {
        return json(400, { error: "Você não pode excluir o último administrador da Empresa." });
      }
    }

    log("delete_start", { requesterId: requester.id, clinicId, userId });

    // Conversas em atendimento voltam para a fila do setor.
    const { error: convErr } = await admin
      .from("conversations")
      .update({
        assigned_user_id: null,
        status: "pending",
        updated_at: new Date().toISOString()
      })
      .eq("clinic_id", clinicId)
      .eq("assigned_user_id", userId)
      .eq("status", "open");
    if (convErr) {
      log("requeue_conversations_failed", { error: convErr.message });
      return json(500, { error: convErr.message });
    }

    // Com soft delete os ON DELETE CASCADE não disparam: limpa manualmente.
    const { error: pushErr } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId);
    if (pushErr) log("push_cleanup_failed", { error: pushErr.message });

    const { error: memberErr } = await admin
      .from("clinic_users")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("user_id", userId);
    if (memberErr) {
      log("clinic_user_delete_failed", { error: memberErr.message });
      return json(500, { error: memberErr.message });
    }

    const { error: authErr } = await admin.auth.admin.deleteUser(userId, true);
    if (authErr) {
      log("auth_delete_failed", { error: authErr.message });
      return json(500, {
        error: "O acesso foi removido, mas não foi possível excluir a conta. Tente novamente mais tarde."
      });
    }

    log("delete_ok", { userId });
    return json(200, { ok: true, user_id: userId });
  } catch (error) {
    log("unexpected_error", { error: String(error?.message ?? error) });
    return json(500, { error: "Erro inesperado ao excluir atendente" });
  }
});
