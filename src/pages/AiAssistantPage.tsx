import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { CheckIcon, SparklesIcon } from "lucide-react";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { Button } from "../components/ui/Button";
import { useAuth } from "../contexts/AuthContext";
import { useClinic } from "../contexts/ClinicContext";
import {
  AI_SETTINGS_LIMITS,
  aiAssistantService,
  DEFAULT_AI_SETTINGS,
  type AiSettings,
} from "../services/aiAssistant";

const fieldClass =
  "w-full rounded-[10px] border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-[3px] focus:ring-blue-500/20 disabled:bg-slate-50";

const Field = ({
  id,
  label,
  help,
  children,
  count,
  max,
}: {
  id: string;
  label: string;
  help?: string;
  children: React.ReactNode;
  count?: number;
  max?: number;
}) => (
  <div>
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label htmlFor={id} className="text-[13px] font-semibold text-slate-700">
        {label}
      </label>
      {max !== undefined && count !== undefined && count > max * 0.8 ? (
        <span className={count > max ? "text-xs text-red-600" : "text-xs text-slate-500"}>
          {count.toLocaleString("pt-BR")} / {max.toLocaleString("pt-BR")}
        </span>
      ) : null}
    </div>
    {help ? <p className="mb-2 text-xs leading-relaxed text-slate-500">{help}</p> : null}
    {children}
  </div>
);

const NotContracted = () => (
  <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6">
    <h2 className="text-lg font-semibold text-slate-900">
      Atendimento com IA no WhatsApp
    </h2>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">
      O assistente responde seus clientes com as informações da sua empresa:
      tira dúvidas, explica serviços e horários e passa a conversa para a
      equipe quando precisa de uma pessoa.
    </p>
    <ul className="mt-4 space-y-2 text-sm text-slate-700">
      {[
        "Você escreve o que a IA precisa saber e ela segue as suas regras",
        "Entra como uma etapa do bot, junto com os botões que você já usa",
        "Passa para o setor certo com um resumo do que o cliente pediu",
      ].map((item) => (
        <li key={item} className="flex gap-2">
          <CheckIcon className="mt-0.5 h-4 w-4 flex-none text-green-600" />
          {item}
        </li>
      ))}
    </ul>
    <p className="mt-5 text-sm font-medium text-slate-900">
      O assistente com IA é um adicional. Fale com a Unxet para ativar.
    </p>
  </div>
);

export const AiAssistantPage: React.FC = () => {
  const { clinicId, subscription, membership } = useClinic();
  const { authUser } = useAuth();
  const isAdmin = membership?.role === "admin";
  const limit = subscription?.ai_replies_addon ?? null;

  const [saved, setSaved] = useState<AiSettings | null>(null);
  const [form, setForm] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [used, setUsed] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clinicId || limit === null) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    Promise.all([
      aiAssistantService.getSettings(clinicId),
      aiAssistantService.getRepliesThisMonth(clinicId).catch(() => null),
    ])
      .then(([settings, replies]) => {
        if (!active) return;
        setSaved(settings);
        setForm(settings);
        setUsed(replies);
      })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [clinicId, limit]);

  const dirty = useMemo(
    () => saved !== null && JSON.stringify(saved) !== JSON.stringify(form),
    [saved, form],
  );

  const tooLong =
    form.business_info.length > AI_SETTINGS_LIMITS.business_info ||
    form.faq.length > AI_SETTINGS_LIMITS.faq ||
    form.rules.length > AI_SETTINGS_LIMITS.rules;

  const set = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!clinicId || !isAdmin) return;
    setSaving(true);
    try {
      await aiAssistantService.saveSettings(clinicId, form, authUser?.id ?? null);
      const fresh = await aiAssistantService.getSettings(clinicId);
      setSaved(fresh);
      setForm(fresh);
      toast.success("Configuração da IA salva.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const editable = isAdmin && !saving;

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b bg-white px-4 pb-4 pt-6 sm:px-10 sm:pt-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <PreTitleIcon icon={SparklesIcon} />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Assistente com IA
              </h1>
              <p className="text-sm text-gray-500">
                O que a IA sabe sobre a sua empresa e como ela fala com os clientes.
              </p>
            </div>
          </div>
          {limit !== null ? (
            <div className="flex items-center gap-3">
              {dirty ? (
                <span className="text-[13px] font-medium text-orange-700">
                  Alterações não salvas
                </span>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                isLoading={saving}
                disabled={!dirty || saving || tooLong || !isAdmin}
              >
                Salvar
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-10">
        {limit === null ? (
          <NotContracted />
        ) : loading ? (
          <div className="mx-auto max-w-3xl space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            ))}
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Uso neste mês</div>
                <div className="text-xs text-slate-500">
                  Cada mensagem que a IA envia conta uma resposta. Quando o
                  limite acaba, as conversas vão direto para a equipe.
                </div>
              </div>
              <div className="whitespace-nowrap text-lg font-bold text-slate-900">
                {used === null ? "—" : used.toLocaleString("pt-BR")}
                <span className="text-sm font-medium text-slate-500">
                  {" "}de {limit.toLocaleString("pt-BR")} respostas
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="ai-name" label="Nome do assistente" help="Como a IA se apresenta para o cliente.">
                  <input
                    id="ai-name"
                    value={form.assistant_name}
                    maxLength={AI_SETTINGS_LIMITS.assistant_name}
                    disabled={!editable}
                    onChange={(e) => set("assistant_name", e.target.value)}
                    className={fieldClass}
                  />
                </Field>
                <Field id="ai-tone" label="Tom de voz">
                  <select
                    id="ai-tone"
                    value={form.tone}
                    disabled={!editable}
                    onChange={(e) => set("tone", e.target.value as AiSettings["tone"])}
                    className={fieldClass}
                  >
                    <option value="friendly">Simpático, trata por "você"</option>
                    <option value="formal">Formal, trata por "senhor(a)"</option>
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.use_emojis}
                  disabled={!editable}
                  onChange={(e) => set("use_emojis", e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Pode usar emojis
              </label>
            </div>

            <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5">
              <Field
                id="ai-business"
                label="Sobre a empresa"
                help="Serviços, preços, horários, endereço, formas de pagamento, prazos. A IA só responde com o que estiver aqui."
                count={form.business_info.length}
                max={AI_SETTINGS_LIMITS.business_info}
              >
                <textarea
                  id="ai-business"
                  rows={8}
                  value={form.business_info}
                  disabled={!editable}
                  onChange={(e) => set("business_info", e.target.value)}
                  placeholder={"Atendemos de segunda a sexta, das 8h às 18h.\nEndereço: Rua ...\nServiços: ..."}
                  className={fieldClass + " resize-y"}
                />
              </Field>
              <Field
                id="ai-faq"
                label="Perguntas frequentes"
                help="As dúvidas que mais chegam e como a equipe costuma responder."
                count={form.faq.length}
                max={AI_SETTINGS_LIMITS.faq}
              >
                <textarea
                  id="ai-faq"
                  rows={8}
                  value={form.faq}
                  disabled={!editable}
                  onChange={(e) => set("faq", e.target.value)}
                  placeholder={"Vocês aceitam cartão?\nSim, em até 3x sem juros.\n\nTem estacionamento?\n..."}
                  className={fieldClass + " resize-y"}
                />
              </Field>
              <Field
                id="ai-rules"
                label="Regras"
                help="O que a IA deve sempre ou nunca fazer. Ex.: nunca dar desconto, sempre pedir o nome antes de transferir."
                count={form.rules.length}
                max={AI_SETTINGS_LIMITS.rules}
              >
                <textarea
                  id="ai-rules"
                  rows={5}
                  value={form.rules}
                  disabled={!editable}
                  onChange={(e) => set("rules", e.target.value)}
                  className={fieldClass + " resize-y"}
                />
              </Field>
            </div>

            <p className="pb-4 text-xs leading-relaxed text-slate-500">
              Para a IA atender, adicione uma etapa do tipo "Atendimento com IA"
              no <Link to="/inbox/bots" className="text-blue-700 hover:text-blue-900">editor do bot</Link>.
              Lá você define o objetivo de cada etapa e para qual setor ela passa a conversa.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AiAssistantPage;
