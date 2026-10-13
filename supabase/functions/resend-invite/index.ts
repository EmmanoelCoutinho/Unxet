// deno-lint-ignore-file
// @ts-nocheck
/**
 * resend-invite — reenvia o e-mail de convite para um atendente que ainda não
 * aceitou (ex.: o link expirou).
 *
 * - Somente administradores da clínica podem reenviar.
 * - Só funciona para quem ainda não definiu a senha (accepted_at nulo, mantido
 *   por trigger em auth.users); para quem já aceitou, o caminho é o
 *   "Esqueci minha senha".
 * - Quem nunca abriu o link recebe um novo convite. Quem abriu (e-mail já
 *   confirmado) mas não definiu a senha recebe um link de definição de senha,
 *   pois o Supabase não reenvia convite para e-mail confirmado.
 * - Mantém nome, cargo e setor atuais do vínculo e atualiza invited_at.
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
    fn: "resend-invite",
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

    // INVITE_REDIRECT_TO tem prioridade, como no invite-attendant.
    const redirectTo =
      (Deno.env.get("INVITE_REDIRECT_TO") ?? body?.redirect_to) || undefined;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const requesterMembership = await getClinicMembership(admin, requester.id, clinicId);
    if (!requesterMembership || requesterMembership.role !== "admin") {
      log("forbidden_not_admin", { requesterId: requester.id, clinicId });
      return json(403, { error: "Forbidden" });
    }

    const { data: target, error: targetErr } = await admin
      .from("clinic_users")
      .select("user_id, role, name, email, accepted_at")
      .eq("clinic_id", clinicId)
      .eq("user_id", userId)
      .maybeSingle();
    if (targetErr) return json(500, { error: targetErr.message });
    if (!target) {
      return json(404, { error: "Atendente não encontrado nesta empresa." });
    }

    if (target.accepted_at) {
      return json(409, {
        error: "Este atendente já aceitou o convite. Se esqueceu a senha, ele pode usar \"Esqueci minha senha\" na tela de login."
      });
    }

    const { data: authData, error: authErr } = await admin.auth.admin.getUserById(userId);
    if (authErr || !authData?.user) {
      log("auth_user_lookup_failed", { userId, error: authErr?.message });
      return json(404, { error: "Conta do atendente não encontrada." });
    }

    const authUser = authData.user;

    const email = (authUser.email ?? target.email ?? "").trim().toLowerCase();
    if (!email) {
      return json(400, { error: "Atendente sem e-mail cadastrado." });
    }

    const linkType = authUser.email_confirmed_at ? "recovery" : "invite";
    log("resend_start", { requesterId: requester.id, clinicId, userId, linkType, redirectTo });

    const { error: sendErr } = linkType === "invite"
      ? await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          clinic_id: clinicId,
          name: target.name ?? null,
          role: target.role
        }
      })
      : await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (sendErr) {
      log("send_failed", { linkType, error: sendErr.message });
      return json(400, { error: sendErr.message });
    }

    const invitedAt = new Date().toISOString();
    const { error: updErr } = await admin
      .from("clinic_users")
      .update({ invited_at: invitedAt })
      .eq("clinic_id", clinicId)
      .eq("user_id", userId);
    if (updErr) log("invited_at_update_failed", { error: updErr.message });

    log("resend_ok", { userId });
    return json(200, { ok: true, user_id: userId, email, invited_at: invitedAt, link_type: linkType });
  } catch (error) {
    log("unexpected_error", { error: String(error?.message ?? error) });
    return json(500, { error: "Erro inesperado ao reenviar convite" });
  }
});
