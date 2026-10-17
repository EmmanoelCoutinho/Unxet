import React, { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WrenchIcon } from "lucide-react";
import { toast } from "react-toastify";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Textarea } from "../../../components/ui/Textarea";
import { Toggle } from "../../../components/ui/Toggle";
import { DEFAULT_MAINTENANCE_MESSAGE } from "../../../constants/maintenance";
import { adminSupabase } from "../lib/adminSupabaseClient";

type MaintenanceSettings = {
  maintenance_enabled: boolean;
  maintenance_message: string | null;
  updated_at: string;
};

type MaintenanceUpdate = Partial<
  Pick<MaintenanceSettings, "maintenance_enabled" | "maintenance_message">
>;

const SETTINGS_COLUMNS = "maintenance_enabled, maintenance_message, updated_at";
const maintenanceQueryKey = ["admin", "platform-maintenance"] as const;

const fetchSettings = async (): Promise<MaintenanceSettings> => {
  const { data, error } = await adminSupabase
    .from("platform_settings")
    .select(SETTINGS_COLUMNS)
    .eq("id", true)
    .single();
  if (error) throw error;
  return data;
};

// Sem permissão o update não casa nenhuma linha e o .single() acusa o erro
const updateSettings = async (
  changes: MaintenanceUpdate,
): Promise<MaintenanceSettings> => {
  const { data, error } = await adminSupabase
    .from("platform_settings")
    .update(changes)
    .eq("id", true)
    .select(SETTINGS_COLUMNS)
    .single();
  if (error) throw error;
  return data;
};

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });

export const MaintenancePage: React.FC = () => {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");

  const settingsQuery = useQuery({
    queryKey: maintenanceQueryKey,
    queryFn: fetchSettings,
  });
  const settings = settingsQuery.data;

  useEffect(() => {
    if (settings) setMessage(settings.maintenance_message ?? "");
  }, [settings?.maintenance_message]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(maintenanceQueryKey, data);
    },
  });

  const handleToggle = (enabled: boolean) => {
    mutation.mutate(
      { maintenance_enabled: enabled },
      {
        onSuccess: () =>
          toast.success(
            enabled
              ? "Aviso de manutenção ligado para todas as empresas."
              : "Aviso de manutenção desligado.",
          ),
        onError: () =>
          toast.error("Não foi possível alterar o aviso. Tente novamente."),
      },
    );
  };

  const handleSaveMessage = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate(
      { maintenance_message: message.trim() || null },
      {
        onSuccess: () => toast.success("Mensagem salva."),
        onError: () =>
          toast.error("Não foi possível salvar a mensagem. Tente novamente."),
      },
    );
  };

  const savedMessage = settings?.maintenance_message ?? "";
  const messageChanged = message.trim() !== savedMessage;
  const previewMessage = message.trim() || DEFAULT_MAINTENANCE_MESSAGE;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Manutenção</h1>
        <p className="mt-1 text-sm text-gray-500">
          Quando ligado, todas as empresas veem uma faixa logo abaixo da barra
          superior do sistema avisando que estamos em manutenção. A faixa
          aparece e some na hora, sem precisar recarregar a página.
        </p>
      </div>

      {settingsQuery.isLoading ? (
        <div className="h-40 animate-pulse rounded-lg border border-[#E5E7EB] bg-white" />
      ) : settingsQuery.isError || !settings ? (
        <Card className="flex flex-col items-start gap-3 p-5 text-sm text-gray-600 sm:p-8">
          <p>Não foi possível carregar a configuração de manutenção.</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => settingsQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </Card>
      ) : (
        <Card className="space-y-6 p-5 sm:p-8">
          <div className="space-y-2">
            <Toggle
              label="Exibir aviso de manutenção"
              helper={
                settings.maintenance_enabled
                  ? "Ligado: a faixa está aparecendo para todas as empresas."
                  : "Desligado: ninguém vê a faixa."
              }
              checked={settings.maintenance_enabled}
              onChange={handleToggle}
              disabled={mutation.isPending}
            />
            <p className="text-xs text-gray-500">
              Última alteração em {formatDateTime(settings.updated_at)}.
            </p>
          </div>

          <form onSubmit={handleSaveMessage} className="space-y-3">
            <Textarea
              label="Mensagem da faixa"
              placeholder={DEFAULT_MAINTENANCE_MESSAGE}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={200}
              className="min-h-[72px]"
            />
            <p className="text-xs text-gray-500">
              Deixe em branco para usar a mensagem padrão.
            </p>

            <div>
              <p className="mb-1 text-sm font-medium text-[#1E1E1E]">
                Pré-visualização
              </p>
              <div className="flex items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-900 sm:text-sm">
                <WrenchIcon className="h-4 w-4 shrink-0" aria-hidden />
                <span>{previewMessage}</span>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="secondary"
                disabled={!messageChanged}
                isLoading={
                  mutation.isPending &&
                  "maintenance_message" in (mutation.variables ?? {})
                }
              >
                Salvar mensagem
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
};
