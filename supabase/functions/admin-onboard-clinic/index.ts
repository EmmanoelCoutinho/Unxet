// deno-lint-ignore-file
// @ts-nocheck
/**
 * admin-onboard-clinic — onboarding de uma nova empresa pelo painel da Unxet.
 *
 * - Somente administradores da plataforma (platform_admins) podem chamar.
 * - Convida o primeiro usuário por e-mail (ele define a senha pelo link, como
 *   nos convites de atendente).
 * - Cria a empresa, o departamento padrão "Recepção" e vincula o usuário como
 *   admin da empresa e membro da Recepção (RPC platform_onboard_clinic, tudo
 *   em uma transação), já com o plano e a situação da assinatura escolhidos.
 * - Se a criação da empresa falhar, a conta recém-convidada é excluída para o
 *   e-mail não ficar preso a um cadastro pela metade.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Mesmos valores de subscription_plans e do check de clinic_subscriptions.status
const PLAN_CODES = ["essencial", "profissional", "empresarial"];
const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "suspended", "canceled"];
const BILLING_CYCLES = ["monthly", "annual"];

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

const log = (step: string, payload: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    fn: "admin-onboard-clinic",
    step,
    ...payload
  }));

const EMAIL_IN_USE = "Este e-mail já está vinculado a outra empresa.";

const isValidEmail =(email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: platformAdmin, error: platformErr } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", requester.id)
      .maybeSingle();
    if (platformErr) {
      log("platform_admin_check_failed", { error: platformErr.message });
      return json(500, { error: platformErr.message });
    }
    if (!platformAdmin) {
      log("forbidden_not_platform_admin", { requesterId: requester.id });
      return json(403, { error: "Forbidden" });
    }

    const body = await req.json().catch(() => ({}));
    const clinicName = body?.clinic_name?.toString().trim();
    const userName = body?.user_name?.toString().trim();
    const email = body?.email?.toString().trim().toLowerCase();
    // INVITE_REDIRECT_TO (secret da function) tem prioridade: garante que o link do
    // convite aponte para o app em produção mesmo que o cadastro seja feito de localhost.
    const redirectTo =
      (Deno.env.get("INVITE_REDIRECT_TO") ?? body?.redirect_to) || undefined;

    if (!clinicName) return json(400, { error: "Informe o nome da empresa" });
    if (!userName) return json(400, { error: "Informe o nome do usuário" });
    if (!email || !isValidEmail(email)) {
      return json(400, { error: "Informe um e-mail válido" });
    }
    const planCode = body?.plan_code?.toString().trim() || "essencial";
    if (!PLAN_CODES.includes(planCode)) {
      return json(400, { error: "Plano inválido" });
    }
    const status = body?.status?.toString().trim() || "active";
    if (!SUBSCRIPTION_STATUSES.includes(status)) {
      return json(400, { error: "Situação da assinatura inválida" });
    }
    const periodEnd = /^\d{4}-\d{2}-\d{2}$/.test(body?.current_period_end ?? "")
      ? body.current_period_end
      : null;
    const billingCycle = body?.billing_cycle?.toString().trim() || "monthly";
    if (!BILLING_CYCLES.includes(billingCycle)) {
      return json(400, { error: "Ciclo de cobrança inválido" });
    }
    const hasPrice = body?.price !== null && body?.price !== undefined && body?.price !== "";
    const price = hasPrice ? Number(body.price) : null;
    if (hasPrice && !(Number.isFinite(price) && price >= 0)) {
      return json(400, { error: "Valor da assinatura inválido" });
    }

    log("onboard_start", { requesterId: requester.id, clinicName, email });

    // Cada conta pertence a uma única empresa. Conta ativa o próprio Auth recusa,
    // mas um convite ainda não aceito seria reenviado e devolveria a MESMA conta:
    // barramos aqui para não mexer em quem já é de outra empresa.
    const { data: existingByEmail, error: existingErr } = await admin
      .from("clinic_users")
      .select("user_id")
      .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
      .limit(1);
    if (existingErr) {
      log("existing_email_check_failed", { error: existingErr.message });
      return json(500, { error: existingErr.message });
    }
    if (existingByEmail?.length) {
      log("email_already_linked", { email });
      return json(409, { error: EMAIL_IN_USE });
    }

    // A conta vem primeiro: e-mail já cadastrado barra tudo antes de criar a empresa.
    const { data: inviteData, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { name: userName, role: "admin" }
      });
    if (inviteErr || !inviteData?.user?.id) {
      log("invite_failed", { error: inviteErr?.message });
      return json(400, {
        error: inviteErr?.message ?? "Não foi possível criar a conta do usuário"
      });
    }
    const userId = inviteData.user.id;

    // Vínculo antigo sem e-mail gravado escapa da checagem acima: a conta já é
    // de outra empresa e NÃO pode ser vinculada de novo nem excluída no rollback.
    const { data: existingLink, error: linkErr } = await admin
      .from("clinic_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (linkErr) {
      log("existing_link_check_failed", { error: linkErr.message, userId });
      return json(500, { error: linkErr.message });
    }
    if (existingLink) {
      log("user_already_linked", { userId });
      return json(409, { error: EMAIL_IN_USE });
    }

    const { data: created, error: onboardErr } = await admin.rpc(
      "platform_onboard_clinic",
      {
        p_clinic_name: clinicName,
        p_user_id: userId,
        p_user_name: userName,
        p_user_email: email,
        p_plan_code: planCode,
        p_status: status,
        p_current_period_end: periodEnd,
        p_billing_cycle: billingCycle,
        p_price: price
      }
    );
    if (onboardErr) {
      log("onboard_rpc_failed", { error: onboardErr.message, userId });
      const { error: rollbackErr } = await admin.auth.admin.deleteUser(userId);
      if (rollbackErr) log("invite_rollback_failed", { error: rollbackErr.message, userId });
      return json(500, { error: "Não foi possível criar a empresa. Tente novamente." });
    }

    log("onboard_ok", { clinicId: created.clinic_id, userId });
    return json(200, {
      ok: true,
      clinic_id: created.clinic_id,
      department_id: created.department_id,
      user_id: userId,
      email
    });
  } catch (error) {
    log("unexpected_error", { error: String(error?.message ?? error) });
    return json(500, { error: "Erro inesperado ao criar a empresa" });
  }
});
