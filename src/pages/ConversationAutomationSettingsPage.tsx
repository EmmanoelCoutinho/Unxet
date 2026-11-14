import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { useClinic } from "../contexts/ClinicContext";
import { supabase } from "../lib/supabaseClient";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Textarea } from "../components/ui/Textarea";
import { TutorialButton } from "../modules/tutorials/TutorialPlayer";
import { Card } from "../components/ui/Card";
import { SettingsTabs } from "../components/settings/SettingsTabs";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { Settings2Icon } from "lucide-react";

type ConversationAutomationSettingsRow = {
  clinic_id: string;
  return_to_pending_enabled: boolean;
  return_to_pending_after_minutes: number | null;
  auto_close_enabled: boolean;
  auto_close_after_minutes: number | null;
  reopen_on_inbound_enabled: boolean;
  sla_first_response_enabled: boolean;
  sla_first_response_after_minutes: number | null;
  satisfaction_survey_enabled: boolean;
  satisfaction_survey_message: string;
  satisfaction_survey_thanks_message: string | null;
  sign_agent_messages?: boolean;
  created_at: string;
  updated_at: string;
};

type AutomationFormValues = {
  returnToPendingEnabled: boolean;
  returnToPendingAfterMinutes: string;
  autoCloseEnabled: boolean;
  autoCloseAfterMinutes: string;
  reopenOnInboundEnabled: boolean;
  slaFirstResponseEnabled: boolean;
  slaFirstResponseAfterMinutes: string;
  surveyEnabled: boolean;
  surveyMessage: string;
  surveyThanksMessage: string;
  signAgentMessages: boolean;
};

type AutomationFormErrors = {
  returnToPendingAfterMinutes?: string;
  autoCloseAfterMinutes?: string;
  slaFirstResponseAfterMinutes?: string;
  surveyMessage?: string;
};

// A nota da pesquisa é sempre de 0 a 10 (não é configurável)
const SURVEY_SCALE_MIN = 0;
const SURVEY_SCALE_MAX = 10;

const DEFAULT_SURVEY_MESSAGE = `Como você avalia o nosso atendimento? Responda com uma nota de ${SURVEY_SCALE_MIN} a ${SURVEY_SCALE_MAX}, sendo ${SURVEY_SCALE_MIN} muito insatisfeito e ${SURVEY_SCALE_MAX} muito satisfeito.`;

/** Escala que o texto pede ("nota de 1 a 5"), ou null se não cita nenhuma. */
const scaleInMessage = (message: string) => {
  const text = message.toLowerCase();
  for (const range of text.matchAll(/(?<![\d:,.h])(\d{1,2})\s*(?:a|até|ate|ao|-|–)\s*(\d{1,2})(?![\d:h])/g)) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min >= 0 && max <= 10 && min < max) return { min, max };
  }
  return null;
};

/** Texto que pede outra escala: o cliente responderia pelo que lê. */
const surveyMessageScaleError = (message: string) => {
  const scale = scaleInMessage(message);
  if (!scale || (scale.min === SURVEY_SCALE_MIN && scale.max === SURVEY_SCALE_MAX)) return null;
  return `A nota da pesquisa é de ${SURVEY_SCALE_MIN} a ${SURVEY_SCALE_MAX}, mas a mensagem pede de ${scale.min} a ${scale.max}. Ajuste o texto.`;
};

const DEFAULT_SETTINGS: AutomationFormValues = {
  returnToPendingEnabled: false,
  returnToPendingAfterMinutes: "60",
  autoCloseEnabled: false,
  autoCloseAfterMinutes: "1440",
  reopenOnInboundEnabled: true,
  slaFirstResponseEnabled: false,
  slaFirstResponseAfterMinutes: "5",
  surveyEnabled: false,
  surveyMessage: DEFAULT_SURVEY_MESSAGE,
  surveyThanksMessage: "Obrigado pela sua avaliação!",
  signAgentMessages: true,
};

const parsePositiveInteger = (value: string) => {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value.trim())) return null;

  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const mapRowToForm = (
  row: ConversationAutomationSettingsRow | null,
): AutomationFormValues => {
  if (!row) return DEFAULT_SETTINGS;

  return {
    returnToPendingEnabled: row.return_to_pending_enabled,
    returnToPendingAfterMinutes:
      row.return_to_pending_after_minutes?.toString() ??
      DEFAULT_SETTINGS.returnToPendingAfterMinutes,
    autoCloseEnabled: row.auto_close_enabled,
    autoCloseAfterMinutes:
      row.auto_close_after_minutes?.toString() ??
      DEFAULT_SETTINGS.autoCloseAfterMinutes,
    reopenOnInboundEnabled: row.reopen_on_inbound_enabled,
    slaFirstResponseEnabled: row.sla_first_response_enabled,
    slaFirstResponseAfterMinutes:
      row.sla_first_response_after_minutes?.toString() ??
      DEFAULT_SETTINGS.slaFirstResponseAfterMinutes,
    surveyEnabled: row.satisfaction_survey_enabled ?? false,
    surveyMessage:
      row.satisfaction_survey_message ?? DEFAULT_SETTINGS.surveyMessage,
    surveyThanksMessage: row.satisfaction_survey_thanks_message ?? "",
    signAgentMessages: row.sign_agent_messages !== false,
  };
};

const SettingsToggle = ({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) => (
  <label className="inline-flex items-center gap-3">
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        checked ? "bg-blue-600" : "bg-slate-300",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
    </button>
    <span className="text-sm font-medium text-slate-700">
      {checked ? "Ativado" : "Desativado"}
    </span>
  </label>
);

const AutomationCard = ({
  title,
  description,
  enabled,
  onEnabledChange,
  minutesValue,
  onMinutesChange,
  minutesError,
  showMinutesInput = true,
  minMinutes = 1,
  locked = false,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  minutesValue?: string;
  onMinutesChange?: (value: string) => void;
  minutesError?: string;
  showMinutesInput?: boolean;
  minMinutes?: number;
  /** Mostra o estado, mas não deixa mudar */
  locked?: boolean;
}) => {
  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <SettingsToggle
            checked={enabled}
            onChange={onEnabledChange}
            disabled={locked}
            label={title}
          />
        </div>

        {showMinutesInput && onMinutesChange && minutesValue !== undefined ? (
          <div className="max-w-xs">
            <Input
              type="number"
              inputMode="numeric"
              min={minMinutes}
              step={1}
              label="Tempo em minutos"
              value={minutesValue}
              onChange={(event) => onMinutesChange(event.target.value)}
              disabled={!enabled}
              error={minutesError}
              placeholder="Ex: 60"
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
};

export const ConversationAutomationSettingsPage: React.FC = () => {
  const { clinicId } = useClinic();

  const [formValues, setFormValues] =
    useState<AutomationFormValues>(DEFAULT_SETTINGS);
  const [formErrors, setFormErrors] = useState<AutomationFormErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const validateForm = useCallback((values: AutomationFormValues) => {
    const nextErrors: AutomationFormErrors = {};

    if (values.returnToPendingEnabled) {
      const minutes = parsePositiveInteger(values.returnToPendingAfterMinutes);
      if (!minutes) {
        nextErrors.returnToPendingAfterMinutes =
          "Informe um inteiro positivo maior que zero.";
      } else if (minutes < 5) {
        nextErrors.returnToPendingAfterMinutes =
          "O tempo mínimo é de 5 minutos.";
      }
    }

    if (values.autoCloseEnabled) {
      const minutes = parsePositiveInteger(values.autoCloseAfterMinutes);
      if (!minutes) {
        nextErrors.autoCloseAfterMinutes =
          "Informe um inteiro positivo maior que zero.";
      }
    }

    if (values.slaFirstResponseEnabled) {
      const minutes = parsePositiveInteger(values.slaFirstResponseAfterMinutes);
      if (!minutes) {
        nextErrors.slaFirstResponseAfterMinutes =
          "Informe um inteiro positivo maior que zero.";
      }
    }

    if (!values.surveyMessage.trim()) {
      nextErrors.surveyMessage = "Informe a mensagem da pesquisa.";
    } else if (values.surveyEnabled) {
      const scaleError = surveyMessageScaleError(values.surveyMessage);
      if (scaleError) nextErrors.surveyMessage = scaleError;
    }

    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, []);

  const fetchSettings = useCallback(async () => {
    if (!clinicId) {
      setLoading(false);
      setLoadError("Clínica não identificada.");
      return;
    }

    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from("conversation_automation_settings")
      .select("*")
      .eq("clinic_id", clinicId)
      .limit(1)
      .maybeSingle();

    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }

    setFormValues(
      mapRowToForm((data as ConversationAutomationSettingsRow) ?? null),
    );
    setFormErrors({});
    setLoading(false);
  }, [clinicId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const canSubmit = useMemo(
    () => clinicId !== null && !loading && !saving,
    [clinicId, loading, saving],
  );

  const persistSettings = useCallback(
    async (values: AutomationFormValues, showSuccessToast: boolean) => {
      if (!clinicId) {
        toast.error("Não foi possível identificar a clínica atual.");
        return;
      }

      if (!validateForm(values)) {
        toast.error("Corrija os campos obrigatórios antes de salvar.");
        return;
      }

      setSaving(true);

      const payload = {
        clinic_id: clinicId,
        return_to_pending_enabled: values.returnToPendingEnabled,
        return_to_pending_after_minutes: parsePositiveInteger(
          values.returnToPendingAfterMinutes,
        ),
        auto_close_enabled: values.autoCloseEnabled,
        auto_close_after_minutes: parsePositiveInteger(
          values.autoCloseAfterMinutes,
        ),
        reopen_on_inbound_enabled: values.reopenOnInboundEnabled,
        sla_first_response_enabled: values.slaFirstResponseEnabled,
        sla_first_response_after_minutes: parsePositiveInteger(
          values.slaFirstResponseAfterMinutes,
        ),
        satisfaction_survey_enabled: values.surveyEnabled,
        satisfaction_survey_message: values.surveyMessage.trim(),
        satisfaction_survey_thanks_message:
          values.surveyThanksMessage.trim() || null,
        satisfaction_survey_scale_min: SURVEY_SCALE_MIN,
        satisfaction_survey_scale_max: SURVEY_SCALE_MAX,
        sign_agent_messages: values.signAgentMessages,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("conversation_automation_settings")
        .upsert(payload, { onConflict: "clinic_id" })
        .select("*")
        .single();

      if (error) {
        toast.error("Erro ao salvar configurações.");
        setSaving(false);
        return;
      }

      setFormValues(mapRowToForm(data as ConversationAutomationSettingsRow));
      setFormErrors({});
      if (showSuccessToast) {
        toast.success("Configurações salvas com sucesso.");
      }
      setSaving(false);
    },
    [clinicId, validateForm],
  );

  const handleSubmit = async () => {
    if (saving) return;
    await persistSettings(formValues, true);
  };

  // Aviso enquanto digita (ao salvar vira erro)
  const surveyMessageOtherScale = formValues.surveyEnabled
    ? surveyMessageScaleError(formValues.surveyMessage)
    : null;

  const surveyMessageMissesScale =
    formValues.surveyEnabled &&
    !surveyMessageOtherScale &&
    !(formValues.surveyMessage.match(/\d+/g) ?? ([] as string[])).includes(
      String(SURVEY_SCALE_MAX),
    );

  const handleToggleChange = async (patch: Partial<AutomationFormValues>) => {
    if (saving) return;
    const nextValues = { ...formValues, ...patch };
    setFormValues(nextValues);
    await persistSettings(nextValues, false);
  };

  if (loading) {
    return (
      <div className="flex h-full flex-1 flex-col bg-slate-50">
        <div className="border-b bg-white px-4 py-5 sm:px-8 sm:py-6">
          <h1 className="text-2xl font-semibold text-slate-900">
            Automações do chat
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Carregando configurações da empresa...
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-6">
          <div className="space-y-4">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="h-36 animate-pulse rounded-lg border border-slate-200 bg-white"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-slate-50">
      <div className="border-b bg-white px-4 py-5 sm:px-8 sm:py-6">
        <div className="flex gap-3">
          <PreTitleIcon icon={Settings2Icon} />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Automações do chat
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Configure regras automáticas de SLA e ciclo de vida das conversas.
            </p>
            <TutorialButton tutorialId="automacoes-conversa" className="mt-1" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 pt-2 sm:py-4">
          <SettingsTabs />

          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            isLoading={saving}
            disabled={!canSubmit}
            className="hidden flex-shrink-0 sm:block"
          >
            Salvar configurações
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-5 sm:px-8 sm:py-6">
        <div className="mx-auto max-w-4xl space-y-5">
          {loadError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p>Não foi possível carregar as configurações.</p>
              <p className="mt-1">{loadError}</p>
              <button
                type="button"
                onClick={fetchSettings}
                className="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                Tentar novamente
              </button>
            </div>
          ) : null}

          <AutomationCard
            title="SLA da primeira resposta"
            description="Indica quando o cliente aguardou a primeira resposta além do limite definido."
            enabled={formValues.slaFirstResponseEnabled}
            onEnabledChange={(value) =>
              handleToggleChange({
                slaFirstResponseEnabled: value,
              })
            }
            minutesValue={formValues.slaFirstResponseAfterMinutes}
            onMinutesChange={(value) =>
              setFormValues((prev) => ({
                ...prev,
                slaFirstResponseAfterMinutes: value,
              }))
            }
            minutesError={formErrors.slaFirstResponseAfterMinutes}
          />

          <AutomationCard
            title="Voltar para fila de espera"
            description="Se o atendente ficar o tempo definido sem responder o cliente, a conversa volta para a fila de espera."
            enabled={formValues.returnToPendingEnabled}
            onEnabledChange={(value) =>
              handleToggleChange({
                returnToPendingEnabled: value,
              })
            }
            minMinutes={5}
            minutesValue={formValues.returnToPendingAfterMinutes}
            onMinutesChange={(value) =>
              setFormValues((prev) => ({
                ...prev,
                returnToPendingAfterMinutes: value,
              }))
            }
            minutesError={formErrors.returnToPendingAfterMinutes}
          />

          <AutomationCard
            title="Fechamento automático"
            description="Encerra a conversa automaticamente depois do tempo configurado sem novas mensagens."
            enabled={formValues.autoCloseEnabled}
            onEnabledChange={(value) =>
              handleToggleChange({
                autoCloseEnabled: value,
              })
            }
            minutesValue={formValues.autoCloseAfterMinutes}
            onMinutesChange={(value) =>
              setFormValues((prev) => ({
                ...prev,
                autoCloseAfterMinutes: value,
              }))
            }
            minutesError={formErrors.autoCloseAfterMinutes}
          />

          <AutomationCard
            title="Nome do atendente nas mensagens"
            description={'Ligado: o cliente recebe o nome de quem respondeu na primeira linha da mensagem (ex.: "Maria:" e, embaixo, o texto). Útil quando mais de um atendente responde a mesma conversa. No WhatsApp o nome vai em negrito.'}
            enabled={formValues.signAgentMessages}
            onEnabledChange={(value) =>
              handleToggleChange({
                signAgentMessages: value,
              })
            }
            showMinutesInput={false}
          />

          <AutomationCard
            title="Reabrir conversa automaticamente"
            description="Se o cliente enviar nova mensagem, a conversa encerrada volta para a fila de espera com todo o histórico. Depois de ligada, esta opção não pode ser desligada, para o atendimento anterior não se separar do novo."
            enabled={formValues.reopenOnInboundEnabled}
            // Desligar está travado; quem ainda está com ela desligada pode ligar
            locked={formValues.reopenOnInboundEnabled}
            onEnabledChange={(value) => {
              if (!value) return;
              handleToggleChange({ reopenOnInboundEnabled: true });
            }}
            showMinutesInput={false}
          />

          <Card className="p-4 sm:p-6">
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-3xl">
                  <h2 className="text-lg font-semibold text-slate-900">
                    Pesquisa de satisfação
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Ao finalizar um atendimento, o cliente recebe a pergunta e
                    responde com uma nota de 0 a 10. A nota é registrada sem
                    reabrir a conversa e aparece nos relatórios.
                  </p>
                </div>
                <SettingsToggle
                  checked={formValues.surveyEnabled}
                  onChange={(value) =>
                    handleToggleChange({ surveyEnabled: value })
                  }
                  label="Pesquisa de satisfação"
                />
              </div>

              <Textarea
                label="Mensagem da pesquisa"
                value={formValues.surveyMessage}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    surveyMessage: event.target.value,
                  }))
                }
                maxLength={1000}
                disabled={!formValues.surveyEnabled}
                error={formErrors.surveyMessage}
              />
              {surveyMessageOtherScale && !formErrors.surveyMessage ? (
                <p className="-mt-3 text-xs text-amber-600">
                  {surveyMessageOtherScale}
                </p>
              ) : (
                surveyMessageMissesScale &&
                !formErrors.surveyMessage && (
                  <p className="-mt-3 text-xs text-amber-600">
                    Confira se a mensagem explica que a nota é de{" "}
                    {SURVEY_SCALE_MIN} a {SURVEY_SCALE_MAX}.
                  </p>
                )
              )}

              <Textarea
                label="Mensagem de agradecimento (opcional)"
                value={formValues.surveyThanksMessage}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    surveyThanksMessage: event.target.value,
                  }))
                }
                maxLength={500}
                disabled={!formValues.surveyEnabled}
                placeholder="Deixe em branco para não enviar agradecimento."
              />

              <p className="text-xs text-slate-500">
                A pesquisa é enviada quando um atendente finaliza a conversa
                (não no fechamento automático). Não há prazo: a nota vale
                mesmo dias depois, e notas fracionadas (como 9,5) são
                arredondadas. Se o cliente mandar outra mensagem que não seja
                nota, a conversa reabre normalmente. No WhatsApp oficial, o
                envio depende da janela de 24 horas desde a última mensagem
                do cliente.
              </p>
            </div>
          </Card>

          {/* No celular este é o único botão de salvar e fica fixo no rodapé */}
          <div className="sticky bottom-0 -mx-4 flex items-center justify-end border-t bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-2">
            <Button
              type="button"
              variant="primary"
              onClick={handleSubmit}
              isLoading={saving}
              disabled={!canSubmit}
              className="w-full sm:w-auto"
            >
              Salvar configurações
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
