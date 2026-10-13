import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangleIcon,
  BanIcon,
  CalendarClockIcon,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { CgClose } from "react-icons/cg";
import { useClinic } from "../contexts/ClinicContext";
import { useAuth } from "../contexts/AuthContext";
import { useClinicUserNames } from "../hooks/useClinicUserNames";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { MessageStatusBadge } from "../modules/scheduledMessages/components/StatusBadge";
import {
  useQrWhatsappConnected,
  useScheduledMessageActions,
  useScheduledMessages,
} from "../modules/scheduledMessages/hooks/useScheduledMessages";
import type {
  ScheduledMessage,
  ScheduledMessageStatus,
} from "../modules/scheduledMessages/types/scheduledMessages";
import {
  formatScheduleDateTime,
  isCancellable,
  isEditable,
  recipientLabel,
  summarizeRecipients,
} from "../modules/scheduledMessages/utils/schedule";

type Filter = "all" | "upcoming" | "sent" | "problems" | "cancelled";

const FILTERS: { key: Filter; label: string; statuses: ScheduledMessageStatus[] }[] = [
  { key: "all", label: "Todas", statuses: [] },
  { key: "upcoming", label: "Agendadas", statuses: ["scheduled", "processing"] },
  { key: "sent", label: "Enviadas", statuses: ["sent"] },
  { key: "problems", label: "Com falha", statuses: ["partial", "failed"] },
  { key: "cancelled", label: "Canceladas", statuses: ["cancelled"] },
];

type PendingAction = { type: "cancel" | "delete"; item: ScheduledMessage };

const describeRecipients = (item: ScheduledMessage) => {
  const names = item.recipients.slice(0, 2).map(recipientLabel);
  const rest = item.recipients.length - names.length;
  return rest > 0 ? `${names.join(", ")} e mais ${rest}` : names.join(" e ");
};

const describeProgress = (item: ScheduledMessage) => {
  const { total, sent, failed } = summarizeRecipients(item.recipients);
  if (item.status === "scheduled") {
    return total === 1 ? "1 destinatário" : `${total} destinatários`;
  }
  const parts = [`${sent} de ${total} enviada${total === 1 ? "" : "s"}`];
  if (failed > 0) parts.push(`${failed} com falha`);
  return parts.join(" · ");
};

export const ScheduledMessagesPage: React.FC = () => {
  const navigate = useNavigate();
  const { clinicId, membership } = useClinic();
  const { authUser } = useAuth();
  const isAdmin = membership?.role === "admin";

  const { scheduledMessages, loading, error, refetch } =
    useScheduledMessages(clinicId);
  const { cancel, remove, acting } = useScheduledMessageActions();
  const qrConnected = useQrWhatsappConnected(clinicId);
  // Só o admin vê programações de outras pessoas
  const userNames = useClinicUserNames(clinicId, isAdmin);

  const [filter, setFilter] = useState<Filter>("all");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const counts = useMemo(() => {
    const result = {} as Record<Filter, number>;
    for (const { key, statuses } of FILTERS) {
      result[key] =
        statuses.length === 0
          ? scheduledMessages.length
          : scheduledMessages.filter((item) => statuses.includes(item.status))
              .length;
    }
    return result;
  }, [scheduledMessages]);

  const visible = useMemo(() => {
    const statuses = FILTERS.find((item) => item.key === filter)?.statuses ?? [];
    const filtered =
      statuses.length === 0
        ? scheduledMessages
        : scheduledMessages.filter((item) => statuses.includes(item.status));
    // Nas agendadas, a próxima a sair vem primeiro
    return filter === "upcoming" ? [...filtered].reverse() : filtered;
  }, [scheduledMessages, filter]);

  const goToNew = () => navigate("/inbox/scheduled-messages/new");
  const goToItem = (id: string) => navigate(`/inbox/scheduled-messages/${id}`);

  const confirmAction = async () => {
    if (!pendingAction) return;
    const { type, item } = pendingAction;

    try {
      if (type === "cancel") {
        await cancel(item.id);
        toast.success("Programação cancelada.");
      } else {
        await remove(item.id);
        toast.success("Programação excluída.");
      }
      setPendingAction(null);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível concluir a ação.");
      setPendingAction(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b bg-white px-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <PreTitleIcon icon={CalendarClockIcon} />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Mensagens programadas
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {isAdmin
                  ? "Mensagens de WhatsApp agendadas pela equipe para sair em um dia e horário definidos."
                  : "Agende mensagens de WhatsApp para sair em um dia e horário definidos."}
              </p>
            </div>
          </div>

          <Button type="button" onClick={goToNew} className="rounded-full">
            <span className="flex items-center gap-2">
              <PlusIcon className="h-4 w-4" />
              Nova programação
            </span>
          </Button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                filter === key
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
              <span className="ml-1.5 text-xs opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        {!qrConnected && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              O WhatsApp por QR Code da empresa está desconectado. As
              programações só saem se ele estiver conectado no horário do envio.
              {isAdmin && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => navigate("/inbox/settings/integrations/meta")}
                    className="font-semibold underline"
                  >
                    Conectar agora
                  </button>
                </>
              )}
            </p>
          </div>
        )}

        {error ? (
          <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900">
              Não foi possível carregar
            </h2>
            <p className="mt-2 text-sm text-gray-500">{error}</p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => refetch()}
              className="mt-4"
            >
              Tentar novamente
            </Button>
          </Card>
        ) : loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white"
              />
            ))}
          </div>
        ) : scheduledMessages.length === 0 ? (
          <Card className="rounded-2xl p-5 text-center sm:p-8">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <CalendarClockIcon className="h-6 w-6 text-slate-500" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-gray-900">
              Nenhuma mensagem programada
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Escolha os clientes, escreva a mensagem e defina quando ela deve
              ser enviada.
            </p>
            <Button type="button" onClick={goToNew} className="mt-6 rounded-full">
              Criar primeira programação
            </Button>
          </Card>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Nenhuma programação neste filtro.
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((item) => {
              const editable = isEditable(item.status);
              const createdByOther =
                isAdmin && item.createdBy !== authUser?.id;

              return (
                <Card
                  key={item.id}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <MessageStatusBadge status={item.status} />
                        <span className="text-sm font-medium text-slate-900">
                          {formatScheduleDateTime(item.scheduledAt)}
                        </span>
                      </div>

                      <p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                        {item.message}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <UsersIcon className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">
                            {describeRecipients(item)}
                          </span>
                        </span>
                        <span>{describeProgress(item)}</span>
                        {createdByOther && (
                          <span>
                            Criada por{" "}
                            {(item.createdBy && userNames[item.createdBy]) ||
                              "atendente removido"}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => goToItem(item.id)}
                      >
                        <span className="flex items-center gap-2">
                          {editable ? (
                            <PencilIcon className="h-4 w-4" />
                          ) : (
                            <EyeIcon className="h-4 w-4" />
                          )}
                          {editable ? "Editar" : "Detalhes"}
                        </span>
                      </Button>
                      {isCancellable(item.status) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPendingAction({ type: "cancel", item })
                          }
                        >
                          <span className="flex items-center gap-2 text-amber-700">
                            <BanIcon className="h-4 w-4" />
                            Cancelar
                          </span>
                        </Button>
                      )}
                      {item.status !== "processing" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPendingAction({ type: "delete", item })
                          }
                          aria-label="Excluir programação"
                        >
                          <span className="flex items-center gap-2 text-red-600">
                            <Trash2Icon className="h-4 w-4" />
                            Excluir
                          </span>
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-3 py-4 sm:px-4">
          <div className="max-h-full w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 shadow-lg sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {pendingAction.type === "cancel"
                    ? "Cancelar programação"
                    : "Excluir programação"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {pendingAction.type === "delete"
                    ? "A programação e o histórico de envio dela serão apagados. As mensagens já enviadas continuam nas conversas."
                    : pendingAction.item.status === "processing"
                      ? "Quem já recebeu a mensagem continua como enviado; os demais não receberão."
                      : "A mensagem não será enviada. A programação fica no histórico como cancelada."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="rounded-full border p-2 text-sm text-slate-500 hover:text-slate-700"
                aria-label="Fechar"
              >
                <CgClose />
              </button>
            </div>

            <div className="mt-5 space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-medium text-slate-900">
                  {formatScheduleDateTime(pendingAction.item.scheduledAt)}
                </p>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap">
                  {pendingAction.item.message}
                </p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setPendingAction(null)}
                >
                  Voltar
                </Button>
                <Button
                  type="button"
                  onClick={confirmAction}
                  disabled={acting}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {acting
                    ? "Aguarde..."
                    : pendingAction.type === "cancel"
                      ? "Cancelar programação"
                      : "Excluir"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
