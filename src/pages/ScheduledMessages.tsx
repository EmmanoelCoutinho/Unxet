import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangleIcon,
  BanIcon,
  EyeIcon,
  MegaphoneIcon,
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
  CampaignFunnelInline,
  CampaignProgress,
} from "../modules/scheduledMessages/components/CampaignInsights";
import {
  useQrWhatsappConnected,
  useScheduledMessageActions,
  useScheduledMessages,
} from "../modules/scheduledMessages/hooks/useScheduledMessages";
import type {
  CampaignSummary,
  ScheduledMessageStatus,
} from "../modules/scheduledMessages/types/scheduledMessages";
import {
  campaignTitle,
  effectiveStatus,
  formatPhone,
  formatScheduleDateTime,
  isCancellable,
  isEditable,
} from "../modules/scheduledMessages/utils/schedule";
import { CAMPAIGNS_PATH } from "../modules/scheduledMessages/paths";

type Filter = "all" | "upcoming" | "sent" | "problems" | "cancelled";

const FILTERS: { key: Filter; label: string; statuses: ScheduledMessageStatus[] }[] = [
  { key: "all", label: "Todas", statuses: [] },
  { key: "upcoming", label: "Agendadas e enviando", statuses: ["scheduled", "processing"] },
  { key: "sent", label: "Concluídas", statuses: ["sent"] },
  { key: "problems", label: "Com falha", statuses: ["partial", "failed"] },
  { key: "cancelled", label: "Canceladas", statuses: ["cancelled"] },
];

type PendingAction = { type: "cancel" | "delete"; item: CampaignSummary };

// Nome sem letra é telefone gravado como nome
const previewLabel = (value: string) =>
  /\p{L}/u.test(value) ? value : formatPhone(value);

const describeRecipients = (item: CampaignSummary) => {
  const names = item.previewNames.map(previewLabel);
  const rest = item.stats.total - names.length;
  if (names.length === 0) return "Sem destinatários";
  return rest > 0 ? `${names.join(", ")} e mais ${rest}` : names.join(" e ");
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
  // Só o admin vê campanhas de outras pessoas
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

  const goToNew = () => navigate(`${CAMPAIGNS_PATH}/new`);
  const goToItem = (id: string) => navigate(`${CAMPAIGNS_PATH}/${id}`);

  const confirmAction = async () => {
    if (!pendingAction) return;
    const { type, item } = pendingAction;

    try {
      if (type === "cancel") {
        await cancel(item.id);
        toast.success("Campanha cancelada.");
      } else {
        await remove(item.id);
        toast.success("Campanha excluída.");
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
            <PreTitleIcon icon={MegaphoneIcon} />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Campanhas</h1>
              <p className="mt-1 text-sm text-gray-500">
                Envie uma mensagem para vários clientes, agora ou num horário
                marcado, e acompanhe quem leu, respondeu e aderiu.
              </p>
            </div>
          </div>

          <Button type="button" onClick={goToNew} className="rounded-full">
            <span className="flex items-center gap-2">
              <PlusIcon className="h-4 w-4" />
              Nova campanha
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
              O WhatsApp por QR Code da empresa está desconectado. As campanhas
              só saem se ele estiver conectado no horário do envio.
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
              <MegaphoneIcon className="h-6 w-6 text-slate-500" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-gray-900">
              Nenhuma campanha ainda
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Ex.: "Promoção do Dia das Crianças, 50% de desconto". Escolha os
              clientes, escreva a mensagem e envie agora ou agende.
            </p>
            <Button type="button" onClick={goToNew} className="mt-6 rounded-full">
              Criar primeira campanha
            </Button>
          </Card>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Nenhuma campanha neste filtro.
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((item) => {
              const status = effectiveStatus(item);
              const editable = isEditable(status);
              const createdByOther =
                isAdmin && item.createdBy !== authUser?.id;
              const started = status !== "scheduled";

              return (
                <Card
                  key={item.id}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => goToItem(item.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <MessageStatusBadge status={status} />
                        <span className="truncate text-base font-semibold text-slate-900">
                          {campaignTitle(item)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {status === "scheduled" ? "Agendada para " : "Enviada a partir de "}
                        {formatScheduleDateTime(item.scheduledAt)}
                      </p>

                      {item.name && (
                        <p className="mt-2 line-clamp-1 whitespace-pre-wrap text-sm text-slate-600">
                          {item.message}
                        </p>
                      )}

                      {started && item.stats.total > 0 && (
                        <div className="mt-3 max-w-xl">
                          <CampaignProgress
                            stats={item.stats}
                            status={status}
                            compact
                          />
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <UsersIcon className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">
                            {item.stats.total} destinatário
                            {item.stats.total === 1 ? "" : "s"} ·{" "}
                            {describeRecipients(item)}
                          </span>
                        </span>
                        {createdByOther && (
                          <span>
                            Criada por{" "}
                            {(item.createdBy && userNames[item.createdBy]) ||
                              "atendente removido"}
                          </span>
                        )}
                      </div>

                      {started && item.stats.sent > 0 && (
                        <div className="mt-2">
                          <CampaignFunnelInline stats={item.stats} />
                        </div>
                      )}
                    </button>

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
                          {editable ? "Editar" : "Resultado"}
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
                      {status !== "processing" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPendingAction({ type: "delete", item })
                          }
                          aria-label="Excluir campanha"
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
                    ? "Cancelar campanha"
                    : "Excluir campanha"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {pendingAction.type === "delete"
                    ? "A campanha e o resultado dela serão apagados. As mensagens já enviadas continuam nas conversas."
                    : pendingAction.item.status === "processing"
                      ? "Quem já recebeu a mensagem continua como enviado; os demais não receberão."
                      : "A mensagem não será enviada. A campanha fica no histórico como cancelada."}
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
                  {campaignTitle(pendingAction.item)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
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
                      ? "Cancelar campanha"
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
