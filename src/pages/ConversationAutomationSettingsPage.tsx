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
  satisfaction_survey_window_minutes: number;
  satisfaction_survey_scale_min?: number | null;
  satisfaction_survey_scale_max?: number | null;
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
  surveyWindowHours: string;
  surveyScaleMin: string;
  surveyScaleMax: string;
  signAgentMessages: boolean;
};

type AutomationFormErrors = {
  returnToPendingAfterMinutes?: string;
  autoCloseAfterMinutes?: string;
  slaFirstResponseAfterMinutes?: string;
  surveyMessage?: string;
  surveyWindowHours?: string;
  surveyScale?: string;
};

// Limites do banco: 5 minutos a 7 dias
const SURVEY_MAX_WINDOW_HOURS = 168;

// Escala da nota: de 0 a 10 no máximo (mínima menor que a máxima)
const SURVEY_SCALE_PRESETS = [
  { min: 1, max: 5 },
  { min: 1, max: 10 },
  { min: 0, max: 10 },
];

const defaultSurveyMessage = (min: number, max: number) =>
  `Como você avalia o nosso atendimento? Responda com uma nota de ${min} a ${max}, sendo ${min} muito insatisfeito e ${max} muito satisfeito.`;

const parseScaleValue = (value: string) =>
  /^\d{1,2}$/.test(value.trim()) ? Number(value.trim()) : null;

const surveyScaleError = (minValue: string, maxValue: string) => {
  const min = parseScaleValue(minValue);
  const max = parseScaleValue(maxValue);
  if (min === null || max === null || min < 0 || max > 10) {
    return "Use notas de 0 a 10.";
  }
  if (min >= max) return "A nota mínima precisa ser menor que a máxima.";
  return null;
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
  surveyMessage: defaultSurveyMessage(1, 5),
  surveyThanksMessage: "Obrigado pela sua avaliação!",
  surveyWindowHours: "24",
  surveyScaleMin: "1",
  surveyScaleMax: "5",
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
    surveyWindowHours: row.satisfaction_survey_window_minutes
      ? Math.max(1, Math.round(row.satisfaction_survey_window_minutes / 60)).toString()
      : DEFAULT_SETTINGS.surveyWindowHours,
    surveyScaleMin: String(row.satisfaction_survey_scale_min ?? 1),
    surveyScaleMax: String(row.satisfaction_survey_scale_max ?? 5),
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
    }

    const surveyHours = parsePositiveInteger(values.surveyWindowHours);
    if (!surveyHours || surveyHours > SURVEY_MAX_WINDOW_HOURS) {
      nextErrors.surveyWindowHours = `Informe de 1 a ${SURVEY_MAX_WINDOW_HOURS} horas.`;
    }

    const scaleError = surveyScaleError(values.surveyScaleMin, values.surveyScaleMax);
    if (scaleError) nextErrors.surveyScale = scaleError;

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
        satisfaction_survey_window_minutes:
          (parsePositiveInteger(values.surveyWindowHours) ?? 24) * 60,
        satisfaction_survey_scale_min: parseScaleValue(values.surveyScaleMin) ?? 1,
        satisfaction_survey_scale_max: parseScaleValue(values.surveyScaleMax) ?? 5,
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

  // Ao trocar a escala, a mensagem padrão acompanha; texto personalizado
  // fica como está (com um aviso se não citar a nota máxima).
  const handleSurveyScaleChange = (minValue: string, maxValue: string) => {
    setFormValues((prev) => {
      const oldMin = parseScaleValue(prev.surveyScaleMin);
      const oldMax = parseScaleValue(prev.surveyScaleMax);
      const newMin = parseScaleValue(minValue);
      const newMax = parseScaleValue(maxValue);
      const usesDefaultMessage =
        oldMin !== null &&
        oldMax !== null &&
        prev.surveyMessage.trim() === defaultSurveyMessage(oldMin, oldMax);
      return {
        ...prev,
        surveyScaleMin: minValue,
        surveyScaleMax: maxValue,
        surveyMessage:
          usesDefaultMessage && newMin !== null && newMax !== null && newMin < newMax
            ? defaultSurveyMessage(newMin, newMax)
            : prev.surveyMessage,
      };
    });
    setFormErrors((prev) => ({ ...prev, surveyScale: undefined }));
  };

  const surveyMessageMissesScale =
    formValues.surveyEnabled &&
    !surveyScaleError(formValues.surveyScaleMin, formValues.surveyScaleMax) &&
    !(formValues.surveyMessage.match(/\d+/g) ?? ([] as string[])).includes(
      String(Number(formValues.surveyScaleMax)),
    );

  // Escala que o texto pede ("nota de 1 a 10"): é a que vale para o cliente
  const surveyMessageScale = (() => {
    const text = formValues.surveyMessage.toLowerCase();
    for (const range of text.matchAll(/(?<![\d:,.h])(\d{1,2})\s*(?:a|até|ate|ao|-|–)\s*(\d{1,2})(?![\d:h])/g)) {
      const min = Number(range[1]);
      const max = Number(range[2]);
      if (min >= 0 && max <= 10 && min < max) return { min, max };
    }
    return null;
  })();
  const surveyMessageOtherScale =
    formValues.surveyEnabled &&
    surveyMessageScale !== null &&
    (String(surveyMessageScale.min) !== formValues.surveyScaleMin.trim() ||
      String(surveyMessageScale.max) !== formValues.surveyScaleMax.trim());

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
                    responde com uma nota na escala que você escolher (por
                    exemplo, de 1 a 5 ou de 0 a 10). A nota é registrada sem
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

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-700">
                  Escala da nota
                </span>
                <div className="flex flex-wrap gap-2">
                  {SURVEY_SCALE_PRESETS.map((preset) => {
                    const active =
                      formValues.surveyScaleMin === String(preset.min) &&
                      formValues.surveyScaleMax === String(preset.max);
                    return (
                      <button
                        key={`${preset.min}-${preset.max}`}
                        type="button"
                        disabled={!formValues.surveyEnabled}
                        onClick={() =>
                          handleSurveyScaleChange(String(preset.min), String(preset.max))
                        }
                        className={`rounded-full border px-3 py-1 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          active
                            ? "border-blue-600 bg-blue-50 font-medium text-blue-700"
                            : "border-slate-300 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {preset.min} a {preset.max}
                      </button>
                    );
                  })}
                </div>
                <div className="grid max-w-xs grid-cols-2 gap-3">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={9}
                    step={1}
                    label="Nota mínima"
                    value={formValues.surveyScaleMin}
                    onChange={(event) =>
                      handleSurveyScaleChange(event.target.value, formValues.surveyScaleMax)
                    }
                    disabled={!formValues.surveyEnabled}
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={10}
                    step={1}
                    label="Nota máxima"
                    value={formValues.surveyScaleMax}
                    onChange={(event) =>
                      handleSurveyScaleChange(formValues.surveyScaleMin, event.target.value)
                    }
                    disabled={!formValues.surveyEnabled}
                  />
                </div>
                {formErrors.surveyScale ? (
                  <p className="text-xs text-red-600">{formErrors.surveyScale}</p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Notas fora da escala não contam como resposta. Nos
                    relatórios, avaliações feitas com outra escala são
                    convertidas para a escala atual.
                  </p>
                )}
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
              {surveyMessageOtherScale && surveyMessageScale && !formErrors.surveyMessage ? (
                <p className="-mt-3 text-xs text-amber-600">
                  A mensagem pede nota de {surveyMessageScale.min} a{" "}
                  {surveyMessageScale.max}, diferente da escala escolhida (
                  {formValues.surveyScaleMin} a {formValues.surveyScaleMax}). O
                  cliente responde pelo que lê, então a nota será registrada de{" "}
                  {surveyMessageScale.min} a {surveyMessageScale.max}. Ajuste a
                  escala ou o texto para ficarem iguais.
                </p>
              ) : (
                surveyMessageMissesScale &&
                !formErrors.surveyMessage && (
                  <p className="-mt-3 text-xs text-amber-600">
                    Confira se a mensagem explica a escala de{" "}
                    {formValues.surveyScaleMin} a {formValues.surveyScaleMax}.
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

              <div className="max-w-xs">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={SURVEY_MAX_WINDOW_HOURS}
                  step={1}
                  label="Prazo para resposta (horas)"
                  value={formValues.surveyWindowHours}
                  onChange={(event) =>
                    setFormValues((prev) => ({
                      ...prev,
                      surveyWindowHours: event.target.value,
                    }))
                  }
                  disabled={!formValues.surveyEnabled}
                  error={formErrors.surveyWindowHours}
                />
              </div>

              <p className="text-xs text-slate-500">
                A pesquisa é enviada quando um atendente finaliza a conversa
                (não no fechamento automático). No WhatsApp oficial, o envio
                depende da janela de 24 horas desde a última mensagem do
                cliente.
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
