import React, { useState } from "react";
import {
  CalendarClockIcon,
  CheckIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../../../contexts/ClinicContext";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import { useContactScheduledActions, useContactScheduledMessages } from "../hooks/useContactScheduledMessages";
import type { ContactScheduledMessage } from "../api/recurring";
import { describeRecurrence } from "../utils/recurrence";
import { RECIPIENT_STATUS_LABEL } from "../utils/schedule";
import { ScheduleContactMessageModal } from "./ScheduleContactMessageModal";

const STATUS: Record<ContactScheduledMessage["status"], { label: string; tone: string }> = {
  active: { label: "Ativa", tone: "bg-green-50 text-green-700" },
  paused: { label: "Pausada", tone: "bg-amber-50 text-amber-700" },
  finished: { label: "Concluída", tone: "bg-slate-100 text-slate-600" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Seção "Mensagens agendadas" no painel do cliente (Carteira de clientes). */
export const ContactScheduledMessages: React.FC<{
  contactId: string;
  contactName: string;
  hasPhone: boolean;
}> = ({ contactId, contactName, hasPhone }) => {
  const { hasFeature } = useClinic();
  const confirm = useConfirm();
  const { items, loading } = useContactScheduledMessages(contactId);
  const { setStatus, remove, busy } = useContactScheduledActions(contactId);
  const [editing, setEditing] = useState<ContactScheduledMessage | "new" | null>(null);

  if (!hasFeature("scheduled_messages")) return null;

  const toggle = async (item: ContactScheduledMessage) => {
    try {
      await setStatus({ id: item.id, status: item.status === "active" ? "paused" : "active" });
      toast.success(item.status === "active" ? "Mensagem pausada." : "Mensagem retomada.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível alterar.");
    }
  };

  const del = async (item: ContactScheduledMessage) => {
    const ok = await confirm({
      title: "Excluir mensagem agendada?",
      description: "Os próximos envios não acontecem. O que já foi enviado continua na conversa.",
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await remove(item.id);
      toast.success("Mensagem agendada excluída.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível excluir.");
    }
  };

  return (
    <div className="border-t border-gray-100 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-950">Mensagens agendadas</h3>
          <p className="mt-1 text-sm text-gray-500">
            Envie uma vez ou repita todo dia, toda semana ou todo mês.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          disabled={!hasPhone}
          title={hasPhone ? undefined : "Cliente sem telefone de WhatsApp"}
          className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          Agendar mensagem
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-sm text-gray-500">Carregando...</p>
        ) : items.length === 0 ? (
          <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
            {hasPhone ? "Nenhuma mensagem agendada para este cliente." : "Este cliente não tem telefone de WhatsApp."}
          </p>
        ) : (
          items.map((item) => {
            const recurring = item.frequency !== "once";
            const status = STATUS[item.status];
            return (
              <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start gap-3">
                  <span
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                      recurring ? "bg-violet-50 text-violet-600" : "bg-blue-50 text-blue-600"
                    }`}
                  >
                    {recurring ? <RepeatIcon className="h-4 w-4" /> : <CalendarClockIcon className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{describeRecurrence(item)}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.tone}`}>
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-gray-600">{item.message}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                      {item.status === "active" && item.nextRunAt && (
                        <span>Próximo envio: {when(item.nextRunAt)}</span>
                      )}
                      {item.lastSend && (
                        <span className="flex items-center gap-1">
                          {item.lastSend.recipientStatus === "sent" && <CheckIcon className="h-3 w-3 text-green-600" />}
                          Último: {when(item.lastSend.scheduledAt)}
                          {item.lastSend.recipientStatus
                            ? ` · ${RECIPIENT_STATUS_LABEL[item.lastSend.recipientStatus]}`
                            : ""}
                        </span>
                      )}
                      {recurring && item.runCount > 0 && <span>{item.runCount} enviada(s)</span>}
                    </div>
                    {item.lastError && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                        <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        Pausada automaticamente: {item.lastError}
                      </p>
                    )}
                    {item.lastSend?.recipientError && (
                      <p className="mt-1 text-xs text-red-600">{item.lastSend.recipientError}</p>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center">
                    {item.status !== "finished" && (
                      <button
                        type="button"
                        onClick={() => toggle(item)}
                        disabled={busy}
                        className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                        aria-label={item.status === "active" ? "Pausar" : "Retomar"}
                        title={item.status === "active" ? "Pausar" : "Retomar"}
                      >
                        {item.status === "active" ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing(item)}
                      className="rounded-lg p-2 text-gray-400 transition hover:bg-blue-50 hover:text-blue-600"
                      aria-label="Editar"
                      title={item.status === "finished" ? "Editar e agendar de novo" : "Editar"}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => del(item)}
                      disabled={busy}
                      className="rounded-lg p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                      aria-label="Excluir"
                      title="Excluir"
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {editing && (
        <ScheduleContactMessageModal
          contactId={contactId}
          contactName={contactName}
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};
