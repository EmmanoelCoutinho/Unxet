import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangleIcon,
  BanIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  LoaderIcon,
  MegaphoneIcon,
  MessageCircleReplyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  TargetIcon,
  Trash2Icon,
  UsersIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../contexts/ClinicContext";
import { useAuth } from "../contexts/AuthContext";
import { useClinicUserNames } from "../hooks/useClinicUserNames";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { MessageStatusBadge } from "../modules/scheduledMessages/components/StatusBadge";
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
  aggregateCampaigns,
  campaignTitle,
  effectiveStatus,
  estimateSendDurationMs,
  formatCurrency,
  formatDuration,
  formatPhone,
  formatScheduleDateTime,
  isCancellable,
  isEditable,
  progressPercent,
  ratePercent,
  startsIn,
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

// Ícone e cor do quadradinho à esquerda de cada campanha
const STATUS_ICON: Record<
  ScheduledMessageStatus,
  { icon: React.ElementType<{ className?: string }>; tone: string }
> = {
  scheduled: { icon: CalendarClockIcon, tone: "bg-blue-50 text-blue-600" },
  processing: { icon: SendIcon, tone: "bg-amber-50 text-amber-600" },
  sent: { icon: CheckCircle2Icon, tone: "bg-green-50 text-green-600" },
  partial: { icon: CircleAlertIcon, tone: "bg-orange-50 text-orange-600" },
  failed: { icon: XCircleIcon, tone: "bg-red-50 text-red-600" },
  cancelled: { icon: BanIcon, tone: "bg-slate-100 text-slate-500" },
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

// Nome sem letra é telefone gravado como nome
const previewLabel = (value: string) => (/\p{L}/u.test(value) ? value : formatPhone(value));

const normalize = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export const ScheduledMessagesPage: React.FC = () => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { clinicId, membership } = useClinic();
  const { authUser } = useAuth();
  const isAdmin = membership?.role === "admin";

  const { scheduledMessages, loading, error, refetch } = useScheduledMessages(clinicId);
  const { cancel, remove } = useScheduledMessageActions();
  const qrConnected = useQrWhatsappConnected(clinicId);
  // Só o admin vê campanhas de outras pessoas
  const userNames = useClinicUserNames(clinicId, isAdmin);

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const withStatus = useMemo(
    () => scheduledMessages.map((item) => ({ item, status: effectiveStatus(item) })),
    [scheduledMessages],
  );

  const counts = useMemo(() => {
    const result = {} as Record<Filter, number>;
    for (const { key, statuses } of FILTERS) {
      result[key] =
        statuses.length === 0
          ? withStatus.length
          : withStatus.filter(({ status }) => statuses.includes(status)).length;
    }
    return result;
  }, [withStatus]);

  const visible = useMemo(() => {
    const statuses = FILTERS.find((f) => f.key === filter)?.statuses ?? [];
    const term = normalize(search.trim());
    const filtered = withStatus.filter(
      ({ item, status }) =>
        (statuses.length === 0 || statuses.includes(status)) &&
        (!term || normalize(item.name).includes(term) || normalize(item.message).includes(term)),
    );
    // Nas agendadas, a próxima a sair vem primeiro
    return filter === "upcoming" ? [...filtered].reverse() : filtered;
  }, [withStatus, filter, search]);

  const totals = useMemo(() => aggregateCampaigns(scheduledMessages), [scheduledMessages]);

  const goToNew = () => navigate(`${CAMPAIGNS_PATH}/new`);
  const goToItem = (id: string) => navigate(`${CAMPAIGNS_PATH}/${id}`);

  const handleCancel = async (item: CampaignSummary, status: ScheduledMessageStatus) => {
    const ok = await confirm({
      title: `Cancelar "${campaignTitle(item)}"?`,
      description:
        status === "processing"
          ? "Quem já recebeu continua como enviado; os demais não receberão."
          : "A mensagem não será enviada. A campanha fica no histórico como cancelada.",
      confirmLabel: "Cancelar campanha",
      cancelLabel: "Voltar",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await cancel(item.id);
      toast.success("Campanha cancelada.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível cancelar.");
    }
  };

  const handleDelete = async (item: CampaignSummary) => {
    const ok = await confirm({
      title: `Excluir "${campaignTitle(item)}"?`,
      description:
        "A campanha e o resultado dela serão apagados. As mensagens já enviadas continuam nas conversas.",
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await remove(item.id);
      toast.success("Campanha excluída.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível excluir.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
          {/* Título */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
                <MegaphoneIcon className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Campanhas</h1>
                <p className="mt-0.5 text-sm text-slate-500">
                  Envie uma mensagem para vários clientes e acompanhe quem leu, respondeu e aderiu.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={goToNew}
              className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4" />
              Nova campanha
            </button>
          </div>

          {!qrConnected && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>
                O WhatsApp por QR Code da empresa está desconectado. As campanhas só saem se ele estiver
                conectado no horário do envio.
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

          {/* Números gerais */}
          {scheduledMessages.length > 0 && (
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi icon={MegaphoneIcon} label="Campanhas" value={String(totals.campaigns)} />
              <Kpi icon={SendIcon} label="Mensagens enviadas" value={totals.sent.toLocaleString("pt-BR")} />
              <Kpi
                icon={MessageCircleReplyIcon}
                label="Taxa de resposta"
                value={`${ratePercent(totals.replied, totals.sent)}%`}
                hint={plural(totals.replied, "resposta", "respostas")}
              />
              <Kpi
                icon={TargetIcon}
                label="Adesões"
                value={String(totals.converted)}
                hint={totals.revenue > 0 ? formatCurrency(totals.revenue) : undefined}
                accent
              />
            </div>
          )}

          {/* Busca e filtros */}
          {scheduledMessages.length > 0 && (
            <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                {FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    aria-pressed={filter === key}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                      filter === key
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                    }`}
                  >
                    {label}
                    <span
                      className={`rounded-full px-1.5 text-xs ${
                        filter === key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {counts[key]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="relative w-full xl:w-72">
                <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar campanha"
                  aria-label="Buscar campanha"
                  className="w-full rounded-full border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </div>
            </div>
          )}

          {/* Lista */}
          <div className="mt-4 pb-6">
            {error ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-slate-900">Não foi possível carregar</h2>
                <p className="mt-2 text-sm text-slate-500">{error}</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="mt-4 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Tentar novamente
                </button>
              </div>
            ) : loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />
                ))}
              </div>
            ) : scheduledMessages.length === 0 ? (
              <EmptyState onCreate={goToNew} />
            ) : visible.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
                Nenhuma campanha {search.trim() ? "encontrada" : "neste filtro"}.
              </p>
            ) : (
              <ul className="space-y-3">
                {visible.map(({ item, status }) => (
                  <CampaignRow
                    key={item.id}
                    item={item}
                    status={status}
                    createdBy={
                      isAdmin && item.createdBy !== authUser?.id
                        ? (item.createdBy && userNames[item.createdBy]) || "atendente removido"
                        : null
                    }
                    onOpen={() => goToItem(item.id)}
                    onCancel={() => handleCancel(item, status)}
                    onDelete={() => handleDelete(item)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */

const Kpi: React.FC<{
  icon: React.ElementType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}> = ({ icon: Icon, label, value, hint, accent }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
      <Icon className={`h-4 w-4 ${accent ? "text-green-600" : "text-slate-400"}`} />
      {label}
    </div>
    <p className={`mt-2 text-2xl font-semibold ${accent ? "text-green-700" : "text-slate-900"}`}>{value}</p>
    {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
  </div>
);

const Metric: React.FC<{ label: string; value: string; hint?: string; tone?: string }> = ({
  label,
  value,
  hint,
  tone = "text-slate-900",
}) => (
  <div className="min-w-0">
    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`mt-0.5 text-base font-semibold ${tone}`}>{value}</p>
    {hint && <p className="truncate text-[11px] text-slate-500">{hint}</p>}
  </div>
);

const CampaignRow: React.FC<{
  item: CampaignSummary;
  status: ScheduledMessageStatus;
  createdBy: string | null;
  onOpen: () => void;
  onCancel: () => void;
  onDelete: () => void;
}> = ({ item, status, createdBy, onOpen, onCancel, onDelete }) => {
  const { icon: StatusIcon, tone } = STATUS_ICON[status];
  const { stats } = item;
  const scheduled = status === "scheduled";
  const sending = status === "processing";
  const editable = isEditable(status);
  const names = item.previewNames.map(previewLabel);
  const rest = stats.total - names.length;

  return (
    <li className="group relative rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-blue-200 hover:shadow-md">
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
        {/* Identificação: o título abre a campanha */}
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${tone}`}>
            <StatusIcon className={`h-5 w-5 ${sending ? "animate-pulse" : ""}`} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onOpen}
                className="min-w-0 truncate text-left text-base font-semibold text-slate-900 after:absolute after:inset-0 after:content-[''] hover:text-blue-700"
              >
                {campaignTitle(item)}
              </button>
              <MessageStatusBadge status={status} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <CalendarClockIcon className="h-3.5 w-3.5" />
                {scheduled ? "Sai " : ""}
                {formatScheduleDateTime(item.scheduledAt)}
                {scheduled && startsIn(item.scheduledAt) ? ` · ${startsIn(item.scheduledAt)}` : ""}
              </span>
              <span className="flex min-w-0 items-center gap-1">
                <UsersIcon className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">
                  {plural(stats.total, "destinatário", "destinatários")}
                  {names.length > 0 && (
                    <span className="hidden sm:inline">
                      {" "}
                      · {names.join(", ")}
                      {rest > 0 ? ` e mais ${rest}` : ""}
                    </span>
                  )}
                </span>
              </span>
              {createdBy && <span>Criada por {createdBy}</span>}
            </p>
            {sending && (
              <div className="relative mt-3 max-w-md">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-amber-700">
                    <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                    Enviando · {progressPercent(stats)}%
                  </span>
                  <span className="text-slate-500">
                    {stats.total - stats.waiting} de {stats.total}
                    {stats.waiting > 0
                      ? ` · ~${formatDuration(estimateSendDurationMs(stats.waiting))}`
                      : ""}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all duration-700"
                    style={{ width: `${progressPercent(stats)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Métricas (agendada ainda não tem) */}
        {!scheduled && (
          <div className="grid grid-cols-4 gap-3 border-t border-slate-100 pt-3 lg:w-[380px] lg:flex-shrink-0 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <Metric
              label="Enviadas"
              value={`${stats.sent}`}
              hint={stats.failed > 0 ? `${stats.failed} com falha` : `de ${stats.total}`}
            />
            <Metric label="Lidas" value={`${ratePercent(stats.read, stats.sent)}%`} hint={`${stats.read}`} />
            <Metric
              label="Respostas"
              value={`${ratePercent(stats.replied, stats.sent)}%`}
              hint={`${stats.replied}`}
              tone="text-blue-700"
            />
            <Metric
              label="Adesões"
              value={`${stats.converted}`}
              hint={stats.revenue > 0 ? formatCurrency(stats.revenue) : undefined}
              tone="text-green-700"
            />
          </div>
        )}

        {/* Ações */}
        <div className="relative z-10 flex items-center justify-end gap-1 lg:flex-shrink-0">
          {editable && (
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            >
              <PencilIcon className="h-3.5 w-3.5" />
              Editar
            </button>
          )}
          <RowMenu
            label={campaignTitle(item)}
            canCancel={isCancellable(status)}
            canDelete={!sending}
            onCancel={onCancel}
            onDelete={onDelete}
          />
        </div>
      </div>
    </li>
  );
};

/** Menu "⋯" com as ações menos usadas (fecha ao clicar fora ou no Esc). */
const RowMenu: React.FC<{
  label: string;
  canCancel: boolean;
  canDelete: boolean;
  onCancel: () => void;
  onDelete: () => void;
}> = ({ label, canCancel, canDelete, onCancel, onDelete }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!canCancel && !canDelete) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mais ações: ${label}`}
        className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
      >
        <MoreHorizontalIcon className="h-5 w-5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {canCancel && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onCancel();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-amber-700 transition hover:bg-amber-50"
            >
              <BanIcon className="h-4 w-4" />
              Cancelar envio
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
            >
              <Trash2Icon className="h-4 w-4" />
              Excluir
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const EmptyState: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-10">
    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
      <MegaphoneIcon className="h-7 w-7" />
    </span>
    <h2 className="mt-4 text-xl font-semibold text-slate-900">Crie sua primeira campanha</h2>
    <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
      Ex.: "Black Friday, 30% de desconto". Em poucos passos você manda para seus clientes e vê quem
      respondeu e aderiu.
    </p>
    <ol className="mx-auto mt-6 grid max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
      {[
        ["Escreva", "A mensagem, com o nome de cada cliente."],
        ["Escolha", "Todos, por etiqueta ou um a um."],
        ["Acompanhe", "Leituras, respostas e adesões."],
      ].map(([title, text], index) => (
        <li key={title} className="rounded-xl bg-slate-50 p-4">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
            {index + 1}
          </span>
          <p className="mt-2 text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-0.5 text-xs text-slate-500">{text}</p>
        </li>
      ))}
    </ol>
    <button
      type="button"
      onClick={onCreate}
      className="mt-6 inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
    >
      <PlusIcon className="h-4 w-4" />
      Criar campanha
    </button>
  </div>
);
