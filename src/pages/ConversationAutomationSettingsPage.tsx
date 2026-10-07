import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { useClinic } from "../contexts/ClinicContext";
import { supabase } from "../lib/supabaseClient";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
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
};

type AutomationFormErrors = {
  returnToPendingAfterMinutes?: string;
  autoCloseAfterMinutes?: string;
  slaFirstResponseAfterMinutes?: string;
};

const DEFAULT_SETTINGS: AutomationFormValues = {
  returnToPendingEnabled: false,
  returnToPendingAfterMinutes: "60",
  autoCloseEnabled: false,
  autoCloseAfterMinutes: "1440",
  reopenOnInboundEnabled: true,
  slaFirstResponseEnabled: false,
  slaFirstResponseAfterMinutes: "5",
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
}) => {
  return (
    <Card className="p-6">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <SettingsToggle
            checked={enabled}
            onChange={onEnabledChange}
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
          "O tempo minimo e de 5 minutos.";
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

    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, []);

  const fetchSettings = useCallback(async () => {
    if (!clinicId) {
      setLoading(false);
      setLoadError("Clinica não identificada.");
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
        toast.error("Não foi possivel identificar a clinica atual.");
        return;
      }

      if (!validateForm(values)) {
        toast.error("Corrija os campos obrigatorios antes de salvar.");
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
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("conversation_automation_settings")
        .upsert(payload, { onConflict: "clinic_id" })
        .select("*")
        .single();

      if (error) {
        toast.error("Erro ao salvar configuracoes.");
        setSaving(false);
        return;
      }

      setFormValues(mapRowToForm(data as ConversationAutomationSettingsRow));
      setFormErrors({});
      if (showSuccessToast) {
        toast.success("Configuracoes salvas com sucesso.");
      }
      setSaving(false);
    },
    [clinicId, validateForm],
  );

  const handleSubmit = async () => {
    if (saving) return;
    await persistSettings(formValues, true);
  };

  const handleToggleChange = async (patch: Partial<AutomationFormValues>) => {
    if (saving) return;
    const nextValues = { ...formValues, ...patch };
    setFormValues(nextValues);
    await persistSettings(nextValues, false);
  };

  if (loading) {
    return (
      <div className="flex h-full flex-1 flex-col bg-slate-50">
        <div className="border-b bg-white px-8 py-6">
          <h1 className="text-2xl font-semibold text-slate-900">
            Automações do chat
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Carregando configuracoes da clinica...
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-6">
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
      <div className="border-b bg-white px-8 py-6">
        <div className="flex gap-3">
          <PreTitleIcon icon={Settings2Icon} />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Automações do chat
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Configure regras automaticas de SLA e ciclo de vida das conversas.
            </p>
          </div>
        </div>
        <div className="flex py-4 items-center justify-between">
          <SettingsTabs />

          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            isLoading={saving}
            disabled={!canSubmit}
          >
            Salvar configuracoes
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl space-y-5">
          {loadError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p>Não foi possivel carregar as configuracoes.</p>
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
            description="Indica quando o cliente aguardou a primeira resposta alem do limite definido."
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
            title="Fechamento automatico"
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
            title="Reabrir conversa automaticamente"
            description="Ligado: se o cliente enviar nova mensagem, a conversa encerrada volta para a fila de espera com todo o histórico. Desligado: a conversa encerrada é mantida e um novo atendimento é aberto."
            enabled={formValues.reopenOnInboundEnabled}
            onEnabledChange={(value) =>
              handleToggleChange({
                reopenOnInboundEnabled: value,
              })
            }
            showMinutesInput={false}
          />

          <div className="flex items-center justify-end pt-2">
            <Button
              type="button"
              variant="primary"
              onClick={handleSubmit}
              isLoading={saving}
              disabled={!canSubmit}
            >
              Salvar configuracoes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
