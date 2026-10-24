import React, { useCallback, useEffect, useState } from "react";
import { LogOutIcon, PlusIcon, QrCodeIcon, Trash2Icon } from "lucide-react";
import { Button } from "../ui/Button";
import { useConfirm } from "../ui/ConfirmDialog";
import { supabase } from "../../lib/supabaseClient";
import {
  formatConnectionPhone,
  whatsappConnectionLabel,
} from "../../lib/whatsappConnections";

export type EvolutionConnection = {
  id: string;
  status: string;
  qr_code?: string | null;
  connected_phone?: string | null;
  connected_name?: string | null;
  display_name?: string | null;
  default_department_id?: string | null;
  last_connection_at?: string | null;
  last_disconnection_at?: string | null;
};

export type DepartmentOption = {
  id: string;
  name: string;
  is_default: boolean;
};

type Props = {
  clinicId: string;
  connections: EvolutionConnection[];
  departments: DepartmentOption[];
  // WhatsApp oficial conectado: novos números por QR Code ficam bloqueados
  blockedByMeta: boolean;
  // Quantos números o adicional permite (null = adicional desligado)
  maxNumbers: number | null;
  onChanged: () => Promise<void> | void;
  onError: (message: string | null) => void;
};

// Supabase devolve o corpo da edge function em error.context
const functionErrorMessage = async (error: unknown, fallback: string) => {
  const context = (error as { context?: unknown })?.context;
  const payload =
    context instanceof Response
      ? ((await context
          .clone()
          .json()
          .catch(() => null)) as { error?: string; message?: string } | null)
      : null;
  return payload?.error ?? payload?.message ?? fallback;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
};

const statusBadge = (status: string) => {
  const config =
    status === "connected"
      ? {
          cls: "border-green-200 bg-green-50 text-green-700",
          label: "Conectado",
        }
      : status === "connecting"
        ? {
            cls: "border-blue-200 bg-blue-50 text-blue-700",
            label: "Conectando",
          }
        : status === "disconnecting"
          ? {
              cls: "border-gray-200 bg-gray-50 text-gray-700",
              label: "Desconectando",
            }
          : {
              cls: "border-gray-200 bg-gray-50 text-gray-700",
              label: "Desconectado",
            };

  return (
    <span className={`rounded-full border px-2 py-1 text-xs ${config.cls}`}>
      {config.label}
    </span>
  );
};

type ItemProps = Omit<Props, "connections" | "clinicId" | "maxNumbers"> & {
  connection: EvolutionConnection;
};

const EvolutionConnectionItem: React.FC<ItemProps> = ({
  connection,
  departments,
  blockedByMeta,
  onChanged,
  onError,
}) => {
  const confirm = useConfirm();
  const [busy, setBusy] = useState<
    "qr" | "disconnect" | "archive" | "save" | null
  >(null);
  const [name, setName] = useState(connection.display_name ?? "");

  useEffect(() => {
    setName(connection.display_name ?? "");
  }, [connection.display_name]);

  const isConnected = connection.status === "connected";
  const phone = formatConnectionPhone(connection.connected_phone);
  const label = whatsappConnectionLabel(connection, "Número sem nome");
  const lastConnection = formatDateTime(connection.last_connection_at);
  const lastDisconnection = formatDateTime(connection.last_disconnection_at);

  const saveFields = useCallback(
    async (patch: {
      display_name?: string;
      default_department_id?: string | null;
    }) => {
      onError(null);
      setBusy("save");
      const { error } = await supabase
        .from("channel_connections")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", connection.id);
      setBusy(null);

      if (error) {
        onError(error.message);
        return;
      }
      await onChanged();
    },
    [connection.id, onChanged, onError],
  );

  const saveName = async () => {
    const trimmed = name.trim();
    if (trimmed === (connection.display_name ?? "")) return;
    if (!trimmed || trimmed.length > 60) {
      onError("Dê um nome ao número (até 60 caracteres).");
      setName(connection.display_name ?? "");
      return;
    }
    await saveFields({ display_name: trimmed });
  };

  const connect = async () => {
    onError(null);
    setBusy("qr");
    const { error } = await supabase.functions.invoke(
      "create-evolution-connection",
      { body: { connectionId: connection.id } },
    );
    setBusy(null);

    if (error) {
      onError(
        await functionErrorMessage(
          error,
          "Não foi possível iniciar a conexão via QR Code.",
        ),
      );
      return;
    }
    await onChanged();
  };

  const disconnect = async () => {
    onError(null);
    setBusy("disconnect");
    const { error } = await supabase.functions.invoke(
      "disconnect-evolution-connection",
      { body: { connectionId: connection.id } },
    );
    setBusy(null);

    if (error) {
      onError(
        await functionErrorMessage(
          error,
          "Não foi possível desconectar o número.",
        ),
      );
      return;
    }
    await onChanged();
  };

  const archive = async () => {
    const ok = await confirm({
      title: `Remover "${label}"?`,
      description:
        "O número é desconectado e sai da lista. As conversas antigas continuam no histórico, mas não será mais possível responder por ele.",
      confirmLabel: "Remover número",
      tone: "danger",
    });
    if (!ok) return;

    onError(null);
    setBusy("archive");
    const { error } = await supabase.functions.invoke(
      "archive-evolution-connection",
      { body: { connectionId: connection.id } },
    );
    setBusy(null);

    if (error) {
      onError(
        await functionErrorMessage(error, "Não foi possível remover o número."),
      );
      return;
    }
    await onChanged();
  };

  // Só faz sentido escolher quando a empresa tem mais de um setor
  const showDepartment = departments.length > 1;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label className="block text-xs font-medium uppercase tracking-wide text-gray-400">
            Nome do número
          </label>
          <input
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            disabled={busy !== null}
            placeholder="Ex.: Recepção"
            className="mt-1 w-full rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-sm font-semibold text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
          />
          {phone || connection.connected_name ? (
            <p className="mt-1 text-xs text-gray-500">
              {[phone, connection.connected_name].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        {statusBadge(connection.status)}
      </div>

      {showDepartment ? (
        <div className="mt-3">
          <label className="block text-xs font-medium uppercase tracking-wide text-gray-400">
            Conversas novas entram em
          </label>
          <select
            value={connection.default_department_id ?? ""}
            onChange={(event) =>
              saveFields({ default_department_id: event.target.value || null })
            }
            disabled={busy !== null}
            className="mt-1 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
          >
            <option value="">Departamento padrão da empresa</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {!isConnected && connection.qr_code ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-5 text-center">
          <p className="text-sm font-semibold text-gray-900">
            Escaneie o QR Code
          </p>
          <p className="mt-1 text-sm text-gray-600">
            Abra o WhatsApp no celular e conecte o dispositivo.
          </p>
          <div className="mt-4 flex justify-center">
            <img
              src={connection.qr_code}
              alt={`QR Code do WhatsApp ${label}`}
              className="h-64 w-64 max-w-full"
            />
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-gray-500">
        {isConnected && lastConnection
          ? `Conectado em ${lastConnection}`
          : !isConnected && lastDisconnection
            ? `Última desconexão em ${lastDisconnection}`
            : null}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {isConnected ? (
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700"
            onClick={disconnect}
            disabled={busy !== null}
          >
            <span className="flex items-center gap-2">
              <LogOutIcon className="h-4 w-4" />
              {busy === "disconnect" ? "Desconectando..." : "Desconectar"}
            </span>
          </Button>
        ) : (
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700"
            onClick={connect}
            disabled={busy !== null || blockedByMeta}
          >
            <span className="flex items-center gap-2">
              <QrCodeIcon className="h-4 w-4" />
              {busy === "qr"
                ? "Gerando QR Code..."
                : connection.qr_code
                  ? "Gerar novo QR Code"
                  : "Conectar via QR Code"}
            </span>
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-red-600 hover:bg-red-50"
          onClick={archive}
          disabled={busy !== null}
        >
          <span className="flex items-center gap-2">
            <Trash2Icon className="h-4 w-4" />
            {busy === "archive" ? "Removendo..." : "Remover"}
          </span>
        </Button>
      </div>
    </div>
  );
};

export const EvolutionConnectionsPanel: React.FC<Props> = ({
  clinicId,
  connections,
  departments,
  blockedByMeta,
  maxNumbers,
  onChanged,
  onError,
}) => {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const showForm = adding || connections.length === 0;
  // Adicional desligado (ou no limite): os números que existem ficam, mas não
  // dá para adicionar outro
  const canAdd =
    connections.length === 0 ||
    (maxNumbers !== null && connections.length < maxNumbers);

  const addConnection = async (event: React.FormEvent) => {
    event.preventDefault();
    const displayName = newName.trim();
    if (!displayName) {
      onError("Dê um nome ao número (ex.: Recepção).");
      return;
    }

    onError(null);
    setCreating(true);
    const { error } = await supabase.functions.invoke(
      "create-evolution-connection",
      { body: { clinicId, displayName } },
    );
    setCreating(false);

    if (error) {
      // Ex.: limite de números do plano; a função explica o motivo em { error }
      onError(
        await functionErrorMessage(
          error,
          "Não foi possível iniciar a conexão via QR Code.",
        ),
      );
      return;
    }

    setNewName("");
    setAdding(false);
    await onChanged();
  };

  return (
    <div className="space-y-3">
      {blockedByMeta ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          Esta opção fica indisponível enquanto houver um WhatsApp conectado via
          Meta.
        </div>
      ) : null}

      {connections.map((connection) => (
        <EvolutionConnectionItem
          key={connection.id}
          connection={connection}
          departments={departments}
          blockedByMeta={blockedByMeta}
          onChanged={onChanged}
          onError={onError}
        />
      ))}

      {blockedByMeta ? null : !canAdd ? (
        <p className="text-xs text-gray-500">
          {maxNumbers !== null
            ? `A empresa usa ${connections.length} de ${maxNumbers} números de WhatsApp. Para conectar mais, fale com a Unxet.`
            : "Para conectar mais números, fale com a Unxet."}
        </p>
      ) : showForm ? (
        <form
          onSubmit={addConnection}
          className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4"
        >
          <label
            htmlFor="new-evolution-connection-name"
            className="block text-sm font-medium text-gray-900"
          >
            {connections.length === 0 ? "Nome do número" : "Novo número"}
          </label>
          <p className="text-xs text-gray-500">
            Aparece no atendimento para a equipe saber por qual número o cliente
            falou.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="new-evolution-connection-name"
              value={newName}
              maxLength={60}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ex.: Recepção, Financeiro"
              disabled={creating}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                className="shrink-0 bg-green-600 hover:bg-green-700"
                disabled={creating}
              >
                <span className="flex items-center gap-2">
                  <QrCodeIcon className="h-4 w-4" />
                  {creating ? "Gerando QR Code..." : "Gerar QR Code"}
                </span>
              </Button>
              {connections.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                    setNewName("");
                  }}
                  disabled={creating}
                >
                  Cancelar
                </Button>
              ) : null}
            </div>
          </div>
        </form>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="border border-dashed border-gray-300"
          onClick={() => setAdding(true)}
        >
          <span className="flex items-center gap-2">
            <PlusIcon className="h-4 w-4" />
            Adicionar número
          </span>
        </Button>
      )}
    </div>
  );
};
