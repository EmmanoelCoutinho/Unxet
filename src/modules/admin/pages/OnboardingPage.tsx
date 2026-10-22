import React, { FormEvent, useState } from "react";
import { CheckCircle2 } from "lucide-react";
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

type OnboardedClinic = {
  clinicName: string;
  planCode: PlanCode;
  userName: string;
  email: string;
};

const FALLBACK_ERROR = "Não foi possível criar a empresa. Tente novamente.";

// A edge function responde { error } com o motivo; o supabase-js só expõe o Response
const getOnboardErrorMessage = async (error: any) => {
  let message: string | undefined;
  if (error?.context instanceof Response) {
    const data = await error.context
      .clone()
      .json()
      .catch(() => null);
    if (typeof data?.error === "string") message = data.error;
  }

  if (message && /already been registered|already registered/i.test(message)) {
    return "Este e-mail já tem uma conta no sistema. Cada pessoa pertence a uma única empresa.";
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
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<OnboardedClinic | null>(null);

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
            redirect_to: getAuthCallbackUrl(),
          },
        },
      );
      if (error) throw error;

      setCreated(payload);
      setClinicName("");
      setUserName("");
      setEmail("");
      setPlanCode("essencial");
      setStatus("active");
      setBillingCycle("monthly");
      setPrice("");
      setPeriodEnd("");
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
          Cadastre uma nova empresa e o primeiro usuário dela. O departamento
          Recepção é criado como padrão e o usuário entra como administrador da
          empresa, já fazendo parte dele.
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
