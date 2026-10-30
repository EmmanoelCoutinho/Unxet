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
 * - Pode convidar também as outras contas pedidas pelo cliente (extra_users),
 *   que entram na Recepção. O total de contas respeita o limite de atendentes
 *   do plano escolhido.
 * - Se a criação da empresa falhar, as contas recém-convidadas são excluídas
 *   para nenhum e-mail ficar preso a um cadastro pela metade.
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

const emailInUse = (email: string) =>
  `O e-mail ${email} já está vinculado a outra empresa.`;

// Teto de segurança; o limite de verdade é o do plano escolhido
const MAX_EXTRA_USERS = 50;

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
    // Adicional "Vários números de WhatsApp": vazio = desligado
    const hasAddon = body?.whatsapp_numbers_addon !== null &&
      body?.whatsapp_numbers_addon !== undefined && body?.whatsapp_numbers_addon !== "";
    const whatsappNumbersAddon = hasAddon ? Number(body.whatsapp_numbers_addon) : null;
    if (hasAddon && !(Number.isInteger(whatsappNumbersAddon) && whatsappNumbersAddon >= 2 && whatsappNumbersAddon <= 50)) {
      return json(400, { error: "Quantidade de números de WhatsApp inválida (de 2 a 50)" });
    }

    // Outras contas pedidas pelo cliente: entram na Recepção como atendente
    // (ou administrador) junto com o primeiro usuário
    const rawExtra = body?.extra_users ?? [];
    if (!Array.isArray(rawExtra) || rawExtra.length > MAX_EXTRA_USERS) {
      return json(400, { error: "Lista de contas inválida" });
    }
    const extraUsers = [];
    const seenEmails = new Set([email]);
    for (const item of rawExtra) {
      const extraName = item?.name?.toString().trim() ?? "";
      const extraEmail = item?.email?.toString().trim().toLowerCase() ?? "";
      const extraRole = item?.role?.toString().trim() || "agent";
      if (!extraName) return json(400, { error: "Informe o nome de todas as contas" });
      if (!isValidEmail(extraEmail)) {
        return json(400, { error: `E-mail inválido: ${extraEmail || "(vazio)"}`, email: extraEmail });
      }
      if (extraRole !== "admin" && extraRole !== "agent") {
        return json(400, { error: "Papel inválido", email: extraEmail });
      }
      if (seenEmails.has(extraEmail)) {
        return json(400, { error: `O e-mail ${extraEmail} aparece mais de uma vez`, email: extraEmail });
      }
      seenEmails.add(extraEmail);
      extraUsers.push({ name: extraName, email: extraEmail, role: extraRole });
    }

    // O limite de atendentes do plano vale para o total de contas
    const { data: plan, error: planErr } = await admin
      .from("subscription_plans")
      .select("name, max_attendants")
      .eq("code", planCode)
      .maybeSingle();
    if (planErr || !plan) {
      log("plan_lookup_failed", { error: planErr?.message, planCode });
      return json(500, { error: "Não foi possível ler o plano" });
    }
    const totalAccounts = 1 + extraUsers.length;
    if (plan.max_attendants !== null && totalAccounts > plan.max_attendants) {
      log("plan_attendant_limit", { planCode, totalAccounts });
      return json(409, {
        error: `O plano ${plan.name} permite até ${plan.max_attendants} contas, contando o primeiro usuário.`,
        code: "plan_limit"
      });
    }

    log("onboard_start", {
      requesterId: requester.id,
      clinicName,
      email,
      extraUsers: extraUsers.length
    });

    const accounts = [
      { name: userName, email, role: "admin" },
      ...extraUsers
    ];

    // Cada conta pertence a uma única empresa. Conta ativa o próprio Auth recusa,
    // mas um convite ainda não aceito seria reenviado e devolveria a MESMA conta:
    // barramos aqui para não mexer em quem já é de outra empresa.
    for (const account of accounts) {
      const { data: existingByEmail, error: existingErr } = await admin
        .from("clinic_users")
        .select("user_id")
        .ilike("email", account.email.replace(/[\\%_]/g, "\\$&"))
        .limit(1);
      if (existingErr) {
        log("existing_email_check_failed", { error: existingErr.message });
        return json(500, { error: existingErr.message });
      }
      if (existingByEmail?.length) {
        log("email_already_linked", { email: account.email });
        return json(409, { error: emailInUse(account.email), email: account.email });
      }
    }

    // Convites recém-feitos; se algo falhar no caminho, todos são excluídos
    // para nenhum e-mail ficar preso a um cadastro pela metade
    const invitedIds: string[] = [];
    const rollbackInvites = async () => {
      for (const id of invitedIds) {
        const { error: rollbackErr } = await admin.auth.admin.deleteUser(id);
        if (rollbackErr) log("invite_rollback_failed", { error: rollbackErr.message, userId: id });
      }
    };

    // As contas vêm primeiro: e-mail já cadastrado barra tudo antes de criar a empresa.
    for (const account of accounts) {
      const { data: inviteData, error: inviteErr } =
        await admin.auth.admin.inviteUserByEmail(account.email, {
          redirectTo,
          data: { name: account.name, role: account.role }
        });
      if (inviteErr || !inviteData?.user?.id) {
        log("invite_failed", { error: inviteErr?.message, email: account.email });
        await rollbackInvites();
        return json(400, {
          error: inviteErr?.message ?? "Não foi possível criar a conta do usuário",
          email: account.email
        });
      }
      const invitedId = inviteData.user.id;

      // Vínculo antigo sem e-mail gravado escapa da checagem acima: a conta já é
      // de outra empresa e NÃO pode ser vinculada de novo nem excluída no rollback.
      const { data: existingLink, error: linkErr } = await admin
        .from("clinic_users")
        .select("user_id")
        .eq("user_id", invitedId)
        .maybeSingle();
      if (linkErr || existingLink) {
        log(linkErr ? "existing_link_check_failed" : "user_already_linked", {
          error: linkErr?.message,
          userId: invitedId
        });
        await rollbackInvites();
        return linkErr
          ? json(500, { error: linkErr.message })
          : json(409, { error: emailInUse(account.email), email: account.email });
      }

      invitedIds.push(invitedId);
      account.user_id = invitedId;
    }

    const [firstAccount, ...extraAccounts] = accounts;
    const { data: created, error: onboardErr } = await admin.rpc(
      "platform_onboard_clinic",
      {
        p_clinic_name: clinicName,
        p_user_id: firstAccount.user_id,
        p_user_name: userName,
        p_user_email: email,
        p_plan_code: planCode,
        p_status: status,
        p_current_period_end: periodEnd,
        p_billing_cycle: billingCycle,
        p_price: price,
        p_whatsapp_numbers_addon: whatsappNumbersAddon,
        p_extra_users: extraAccounts.map((account) => ({
          user_id: account.user_id,
          name: account.name,
          email: account.email,
          role: account.role
        }))
      }
    );
    if (onboardErr) {
      log("onboard_rpc_failed", { error: onboardErr.message, userIds: invitedIds });
      await rollbackInvites();
      return json(500, { error: "Não foi possível criar a empresa. Tente novamente." });
    }

    log("onboard_ok", { clinicId: created.clinic_id, userIds: invitedIds });
    return json(200, {
      ok: true,
      clinic_id: created.clinic_id,
      department_id: created.department_id,
      user_id: firstAccount.user_id,
      email,
      extra_users: extraAccounts.map((account) => ({
        user_id: account.user_id,
        email: account.email
      }))
    });
  } catch (error) {
    log("unexpected_error", { error: String(error?.message ?? error) });
    return json(500, { error: "Erro inesperado ao criar a empresa" });
  }
});
