import React, { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { toast } from "react-toastify";
import { Card } from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";
import { Button } from "../../../components/ui/Button";
import { getAuthCallbackUrl } from "../../../lib/appUrl";
import { translateAuthError } from "../../../lib/authErrors";
import { parseMoney } from "../../../lib/money";
import { adminSupabase } from "../lib/adminSupabaseClient";
import {
  PLAN_CODES,
  PLAN_HIGHLIGHTS,
  PLAN_NAMES,
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  type BillingCycle,
  type PlanCode,
  type SubscriptionStatus,
} from "../../../constants/plans";
import {
  parseWhatsappAddon,
  WHATSAPP_ADDON_DEFAULT,
  WHATSAPP_ADDON_MAX,
  WHATSAPP_ADDON_MIN,
} from "../lib/subscriptions";
import { WhatsappAddonField } from "../components/WhatsappAddonField";
import {
  remainingExtraSlots,
  validateExtraAccounts,
  type ExtraAccountDraft,
  type ExtraAccountRole,
} from "../lib/onboarding";

type OnboardedClinic = {
  clinicName: string;
  planCode: PlanCode;
  userName: string;
  email: string;
  extraEmails: string[];
};

type PlanLimit = { code: PlanCode; name: string; max_attendants: number | null };

const newExtraAccount = (): ExtraAccountDraft => ({
  key: crypto.randomUUID(),
  name: "",
  email: "",
  role: "agent",
});

const FALLBACK_ERROR = "Não foi possível criar a empresa. Tente novamente.";

// A edge function responde { error } com o motivo; o supabase-js só expõe o Response
const getOnboardErrorMessage = async (error: any) => {
  let message: string | undefined;
  let email: string | undefined;
  if (error?.context instanceof Response) {
    const data = await error.context
      .clone()
      .json()
      .catch(() => null);
    if (typeof data?.error === "string") message = data.error;
    if (typeof data?.email === "string") email = data.email;
  }

  if (message && /already been registered|already registered/i.test(message)) {
    return `${email ? `O e-mail ${email}` : "Este e-mail"} já tem uma conta no sistema. Cada pessoa pertence a uma única empresa. Nada foi criado.`;
  }
  if (message && /error sending invite email/i.test(message)) {
    return "Não foi possível enviar o e-mail de convite. Nada foi criado; tente novamente em alguns minutos.";
  }
  if (message === "Forbidden" || message === "Unauthorized") {
    return "Sua conta não tem permissão para esta ação.";
  }
  return translateAuthError(
    { message: message ?? error?.message },
    message || FALLBACK_ERROR,
  );
};

export const OnboardingPage: React.FC = () => {
  const [clinicName, setClinicName] = useState("");
  const [userName, setUserName] = useState("");
  const [email, setEmail] = useState("");
  const [planCode, setPlanCode] = useState<PlanCode>("essencial");
  const [status, setStatus] = useState<SubscriptionStatus>("active");
  const [periodEnd, setPeriodEnd] = useState("");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [price, setPrice] = useState("");
  const [addonEnabled, setAddonEnabled] = useState(false);
  const [addonQuantity, setAddonQuantity] = useState(
    String(WHATSAPP_ADDON_DEFAULT),
  );
  const [extraAccounts, setExtraAccounts] = useState<ExtraAccountDraft[]>([]);
  const [plans, setPlans] = useState<PlanLimit[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<OnboardedClinic | null>(null);

  // Limite de contas de cada plano (o servidor confere de novo)
  useEffect(() => {
    let active = true;
    adminSupabase
      .from("subscription_plans")
      .select("code, name, max_attendants")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("[Onboarding] erro ao ler os planos:", error);
          return;
        }
        setPlans((data ?? []) as PlanLimit[]);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedPlan = plans.find((p) => p.code === planCode) ?? null;
  const maxAccounts = selectedPlan?.max_attendants ?? null;
  const remainingSlots = remainingExtraSlots(maxAccounts, extraAccounts.length);
  const overLimit =
    maxAccounts !== null && 1 + extraAccounts.length > maxAccounts;

  const updateExtraAccount = (key: string, patch: Partial<ExtraAccountDraft>) =>
    setExtraAccounts((list) =>
      list.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      clinicName: clinicName.trim(),
      planCode,
      userName: userName.trim(),
      email: email.trim().toLowerCase(),
    };
    if (!payload.clinicName || !payload.userName || !payload.email) {
      toast.error("Preencha todos os campos.");
      return;
    }
    const priceValue = parseMoney(price);
    if (priceValue !== null && !(priceValue >= 0)) {
      toast.error("Valor da assinatura inválido. Use, por exemplo, 199,90.");
      return;
    }
    const addonValue = parseWhatsappAddon(addonEnabled, addonQuantity);
    if (addonValue === undefined) {
      toast.error(
        `Vários números de WhatsApp: informe de ${WHATSAPP_ADDON_MIN} a ${WHATSAPP_ADDON_MAX} números.`,
      );
      return;
    }
    const extrasError = validateExtraAccounts(
      payload.email,
      extraAccounts,
      selectedPlan,
    );
    if (extrasError) {
      toast.error(extrasError);
      return;
    }
    const extraUsers = extraAccounts.map((account) => ({
      name: account.name.trim(),
      email: account.email.trim().toLowerCase(),
      role: account.role,
    }));

    setSubmitting(true);
    try {
      const { error } = await adminSupabase.functions.invoke(
        "admin-onboard-clinic",
        {
          body: {
            clinic_name: payload.clinicName,
            user_name: payload.userName,
            email: payload.email,
            plan_code: planCode,
            status,
            current_period_end: periodEnd || null,
            billing_cycle: billingCycle,
            price: priceValue,
            whatsapp_numbers_addon: addonValue,
            extra_users: extraUsers,
            redirect_to: getAuthCallbackUrl(),
          },
        },
      );
      if (error) throw error;

      setCreated({
        ...payload,
        extraEmails: extraUsers.map((account) => account.email),
      });
      setClinicName("");
      setUserName("");
      setEmail("");
      setPlanCode("essencial");
      setStatus("active");
      setBillingCycle("monthly");
      setPrice("");
      setPeriodEnd("");
      setAddonEnabled(false);
      setAddonQuantity(String(WHATSAPP_ADDON_DEFAULT));
      setExtraAccounts([]);
    } catch (err) {
      toast.error(await getOnboardErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Onboarding</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cadastre uma nova empresa, o primeiro usuário dela e, se o cliente
          pediu, as outras contas. O departamento Recepção é criado como padrão
          e todas as contas já fazem parte dele; o primeiro usuário entra como
          administrador da empresa.
        </p>
      </div>

      {created && (
        <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">
              Empresa {created.clinicName} criada com sucesso no plano{" "}
              {PLAN_NAMES[created.planCode]}.
            </p>
            <p className="mt-1">
              Enviamos um convite para {created.email}. {created.userName}{" "}
              define a senha pelo link do e-mail e já pode entrar no sistema.
            </p>
            {created.extraEmails.length > 0 && (
              <p className="mt-1">
                Também convidamos{" "}
                {created.extraEmails.length === 1
                  ? created.extraEmails[0]
                  : `${created.extraEmails.length} contas: ${created.extraEmails.join(", ")}`}
                .
              </p>
            )}
          </div>
        </div>
      )}

      <Card className="p-5 sm:p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Empresa
            </legend>
            <Input
              label="Nome da empresa"
              placeholder="Ex.: Clínica Bem Estar"
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              maxLength={120}
              required
            />
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Assinatura
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {PLAN_CODES.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setPlanCode(code)}
                  className={[
                    "rounded-lg border px-3 py-2 text-sm font-medium transition",
                    planCode === code
                      ? "border-[#003366] bg-[#003366] text-white"
                      : "border-[#E5E7EB] text-gray-700 hover:border-gray-300",
                  ].join(" ")}
                >
                  {PLAN_NAMES[code]}
                </button>
              ))}
            </div>
            <ul className="grid gap-1 text-xs text-gray-600 sm:grid-cols-2">
              {PLAN_HIGHLIGHTS[planCode].map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-[#1E1E1E]">
                  Cobrança
                </label>
                <select
                  value={billingCycle}
                  onChange={(e) =>
                    setBillingCycle(e.target.value as BillingCycle)
                  }
                  className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
                >
                  {(Object.keys(BILLING_CYCLE_LABELS) as BillingCycle[]).map(
                    (value) => (
                      <option key={value} value={value}>
                        {BILLING_CYCLE_LABELS[value]}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <Input
                label={
                  billingCycle === "annual"
                    ? "Valor da anuidade (R$)"
                    : "Valor da mensalidade (R$)"
                }
                inputMode="decimal"
                placeholder="Ex.: 199,90"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-[#1E1E1E]">
                  Situação
                </label>
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as SubscriptionStatus)
                  }
                  className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
                >
                  {(Object.keys(SUBSCRIPTION_STATUS_LABELS) as SubscriptionStatus[]).map(
                    (value) => (
                      <option key={value} value={value}>
                        {SUBSCRIPTION_STATUS_LABELS[value]}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <Input
                label="Vencimento (opcional)"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
            <WhatsappAddonField
              enabled={addonEnabled}
              quantity={addonQuantity}
              onEnabledChange={setAddonEnabled}
              onQuantityChange={setAddonQuantity}
            />
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Primeiro usuário
            </legend>
            <Input
              label="Nome"
              placeholder="Nome completo"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              maxLength={120}
              required
            />
            <Input
              label="E-mail"
              type="email"
              placeholder="pessoa@empresa.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <p className="text-xs text-gray-500">
              A pessoa recebe um e-mail com o link para definir a própria senha.
            </p>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Outras contas
            </legend>
            <p className="text-xs text-gray-500">
              {maxAccounts === null
                ? selectedPlan
                  ? `O plano ${selectedPlan.name} não tem limite de contas. Cada pessoa recebe o próprio convite por e-mail.`
                  : "Cada pessoa recebe o próprio convite por e-mail."
                : `O plano ${selectedPlan?.name ?? PLAN_NAMES[planCode]} permite até ${maxAccounts} contas, contando o primeiro usuário. ${
                    overLimit
                      ? `Remova ${1 + extraAccounts.length - maxAccounts} para continuar ou escolha outro plano.`
                      : remainingSlots === 0
                        ? "Todas as vagas estão em uso."
                        : `Ainda ${remainingSlots === 1 ? "cabe 1" : `cabem ${remainingSlots}`}.`
                  }`}
            </p>

            {extraAccounts.map((account, index) => {
              const beyondPlan = maxAccounts !== null && index + 2 > maxAccounts;
              return (
                <div
                  key={account.key}
                  className={[
                    "rounded-lg border p-3",
                    beyondPlan ? "border-red-300 bg-red-50" : "border-[#E5E7EB]",
                  ].join(" ")}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">
                      Conta {index + 2}
                      {beyondPlan && (
                        <span className="ml-2 text-xs font-normal text-red-600">
                          fora do limite do plano
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExtraAccounts((list) =>
                          list.filter((item) => item.key !== account.key),
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-red-600"
                      aria-label={`Remover conta ${index + 2}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remover
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem]">
                    <Input
                      label="Nome"
                      placeholder="Nome completo"
                      value={account.name}
                      onChange={(e) =>
                        updateExtraAccount(account.key, { name: e.target.value })
                      }
                      maxLength={120}
                      required
                    />
                    <Input
                      label="E-mail"
                      type="email"
                      placeholder="pessoa@empresa.com.br"
                      value={account.email}
                      onChange={(e) =>
                        updateExtraAccount(account.key, { email: e.target.value })
                      }
                      required
                    />
                    <div>
                      <label className="mb-1 block text-sm font-medium text-[#1E1E1E]">
                        Papel
                      </label>
                      <select
                        value={account.role}
                        onChange={(e) =>
                          updateExtraAccount(account.key, {
                            role: e.target.value as ExtraAccountRole,
                          })
                        }
                        className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
                      >
                        <option value="agent">Atendente</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}

            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setExtraAccounts((list) => [...list, newExtraAccount()])
              }
              disabled={remainingSlots === 0}
              className="border border-dashed border-[#E5E7EB]"
            >
              <Plus className="mr-1 inline h-4 w-4" />
              Adicionar conta
            </Button>
          </fieldset>

          <div className="flex justify-end">
            <Button type="submit" variant="secondary" isLoading={submitting}>
              Criar empresa
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
