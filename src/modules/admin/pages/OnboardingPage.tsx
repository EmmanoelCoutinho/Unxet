import React, { FormEvent, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "react-toastify";
import { Card } from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";
import { Button } from "../../../components/ui/Button";
import { getAuthCallbackUrl } from "../../../lib/appUrl";
import { translateAuthError } from "../../../lib/authErrors";
import { adminSupabase } from "../lib/adminSupabaseClient";

type OnboardedClinic = {
  clinicName: string;
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
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<OnboardedClinic | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      clinicName: clinicName.trim(),
      userName: userName.trim(),
      email: email.trim().toLowerCase(),
    };
    if (!payload.clinicName || !payload.userName || !payload.email) {
      toast.error("Preencha todos os campos.");
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
            redirect_to: getAuthCallbackUrl(),
          },
        },
      );
      if (error) throw error;

      setCreated(payload);
      setClinicName("");
      setUserName("");
      setEmail("");
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
              Empresa {created.clinicName} criada com sucesso.
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
