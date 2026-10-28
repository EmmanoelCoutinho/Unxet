import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  BanIcon,
  CalendarClockIcon,
  CheckIcon,
  KanbanSquareIcon,
  MessageCircleIcon,
  PhoneIcon,
  RotateCcwIcon,
  SearchIcon,
  TargetIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../../../contexts/ClinicContext";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import { useOpenConversation } from "../../floatingChats/useOpenConversation";
import { useLeadActions } from "../../leads/hooks/useLeads";
import {
  useCampaignTags,
  useQrWhatsappNumbers,
  useScheduledMessageActions,
} from "../hooks/useScheduledMessages";
import type { CampaignStats, ScheduledMessage, ScheduledRecipient } from "../types/scheduledMessages";
import {
  campaignStats,
  campaignTitle,
  effectiveStatus,
  estimateSendDurationMs,
  formatCurrency,
  formatDuration,
  formatPhone,
  formatScheduleDateTime,
  isCancellable,
  previewMessageText,
  ratePercent,
  recipientLabel,
  retrySummary,
} from "../utils/schedule";
import { CAMPAIGNS_PATH } from "../paths";
import { CampaignProgress } from "./CampaignInsights";
import { MessageStatusBadge, RecipientStatusBadge } from "./StatusBadge";
import { WhatsappPreview } from "./WhatsappPreview";

type RecipientFilter = "all" | "replied" | "converted" | "unread" | "failed";

const RECIPIENT_FILTERS: {
  key: RecipientFilter;
  label: string;
  match: (r: ScheduledRecipient) => boolean;
}[] = [
  { key: "all", label: "Todos", match: () => true },
  { key: "replied", label: "Responderam", match: (r) => Boolean(r.repliedAt) },
  { key: "converted", label: "Aderiram", match: (r) => Boolean(r.convertedAt) },
  { key: "unread", label: "Não leram", match: (r) => r.status === "sent" && !r.readAt },
  { key: "failed", label: "Com falha", match: (r) => r.status === "failed" },
];

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

const normalize = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const initialsOf = (label: string) => {
  const parts = label.split(/\s+/).filter((p) => /\p{L}/u.test(p));
  if (parts.length === 0) return "#";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
};

export const CampaignResultView: React.FC<{ scheduledMessage: ScheduledMessage }> = ({
  scheduledMessage,
}) => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const openConversation = useOpenConversation();
  const { clinicId } = useClinic();
  const { cancel, retry, acting } = useScheduledMessageActions();
  const leadActions = useLeadActions();
  const { numbers } = useQrWhatsappNumbers(clinicId);
  const { tags } = useCampaignTags(clinicId);

  const recipients = scheduledMessage.recipients;
  const stats = useMemo(() => campaignStats(recipients), [recipients]);
  const missing = useMemo(() => retrySummary(recipients), [recipients]);
  const status = effectiveStatus(scheduledMessage);
  const finished = status !== "processing" && status !== "scheduled";

  const [filter, setFilter] = useState<RecipientFilter>("all");
  const [search, setSearch] = useState("");

  const filterCounts = useMemo(() => {
    const counts = {} as Record<RecipientFilter, number>;
    for (const f of RECIPIENT_FILTERS) counts[f.key] = recipients.filter(f.match).length;
    return counts;
  }, [recipients]);

  const visible = useMemo(() => {
    const match = RECIPIENT_FILTERS.find((f) => f.key === filter)?.match ?? (() => true);
    const term = normalize(search.trim());
    const digits = search.replace(/\D/g, "");
    return recipients.filter(
      (r) =>
        match(r) &&
        (!term ||
          normalize(r.name).includes(term) ||
          (digits.length >= 3 && r.phone.includes(digits))),
    );
  }, [recipients, filter, search]);

  const numberLabel =
    numbers.length > 1 ? numbers.find((n) => n.id === scheduledMessage.channelConnectionId)?.label : undefined;
  const conversionTag = tags.find((t) => t.id === scheduledMessage.conversionTagId) ?? null;
  const previewName =
    recipients.find((r) => /\p{L}/u.test(r.name ?? ""))?.name?.trim().split(/\s+/)[0] ?? "Maria";

  /* -------------------------------- Ações -------------------------------- */

  const handleCancel = async () => {
    const ok = await confirm({
      title: "Cancelar os envios restantes?",
      description: "Quem já recebeu continua como enviado; os demais não receberão.",
      confirmLabel: "Cancelar envios",
      cancelLabel: "Voltar",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await cancel(scheduledMessage.id);
      toast.success("Campanha cancelada.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível cancelar.");
    }
  };

  const handleRetry = async () => {
    const ok = await confirm({
      title: `Tentar de novo para ${plural(missing.toRetry, "cliente", "clientes")}?`,
      description: (
        <>
          A mesma mensagem volta para a fila, no mesmo ritmo seguro (cerca de{" "}
          {formatDuration(estimateSendDurationMs(missing.toRetry))}). Antes, confira se o WhatsApp está
          conectado.
          {missing.permanent > 0 &&
            ` Os ${plural(missing.permanent, "número", "números")} sem WhatsApp ficam de fora.`}
        </>
      ),
      confirmLabel: "Tentar de novo",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    try {
      const count = await retry(scheduledMessage.id);
      toast.success(`${plural(count, "cliente voltou", "clientes voltaram")} para a fila de envio.`);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível tentar de novo.");
    }
  };

  const handleToFunnel = async () => {
    try {
      const count = await leadActions.campaignToDeals({ campaignId: scheduledMessage.id, onlyReplied: true });
      if (count === 0) {
        toast.info("Quem respondeu já está no funil.");
        return;
      }
      toast.success(`${plural(count, "negociação criada", "negociações criadas")} no funil de vendas.`);
      navigate("/inbox/leads");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível levar ao funil.");
    }
  };

  /* -------------------------------- Tela --------------------------------- */

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Cabeçalho */}
        <header className="border-b bg-white">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <button
                type="button"
                onClick={() => navigate(CAMPAIGNS_PATH)}
                className="mt-0.5 rounded-full border border-slate-200 p-2 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                aria-label="Voltar para a lista de campanhas"
              >
                <ArrowLeftIcon className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl font-semibold text-slate-900">{campaignTitle(scheduledMessage)}</h1>
                  <MessageStatusBadge status={status} />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <CalendarClockIcon className="h-4 w-4" />
                    {formatScheduleDateTime(scheduledMessage.scheduledAt)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <UsersIcon className="h-4 w-4" />
                    {plural(stats.total, "destinatário", "destinatários")}
                  </span>
                  {numberLabel && (
                    <span className="flex items-center gap-1.5">
                      <PhoneIcon className="h-4 w-4" />
                      {numberLabel}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:flex-shrink-0">
              {stats.replied > 0 && (
                <button
                  type="button"
                  onClick={handleToFunnel}
                  disabled={leadActions.movingFromCampaign}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-60"
                  title="Cria uma negociação para cada cliente que respondeu"
                >
                  <KanbanSquareIcon className="h-4 w-4" />
                  Levar quem respondeu ao funil
                </button>
              )}
              {isCancellable(scheduledMessage.status) && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={acting}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-200 px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50 disabled:opacity-60"
                >
                  <BanIcon className="h-4 w-4" />
                  Cancelar envios
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-8">
          {/* Envio */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <CampaignProgress stats={stats} status={status} />
          </section>

          {/* Funil */}
          <FunnelSection stats={stats} />

          {/* Quem não recebeu */}
          {finished && missing.toRetry + missing.permanent + missing.uncertain > 0 && (
            <section className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-sm text-amber-900">
                <p className="font-semibold">Quem não recebeu</p>
                {missing.retryable > 0 && (
                  <p className="text-xs leading-5">
                    {plural(missing.retryable, "envio falhou", "envios falharam")} sem a mensagem sair (WhatsApp
                    desconectado ou recusa): dá para tentar de novo.
                  </p>
                )}
                {missing.cancelled > 0 && (
                  <p className="text-xs leading-5">
                    {plural(missing.cancelled, "envio foi cancelado", "envios foram cancelados")} antes de sair.
                  </p>
                )}
                {missing.permanent > 0 && (
                  <p className="text-xs leading-5">
                    {plural(missing.permanent, "número não tem", "números não têm")} WhatsApp e{" "}
                    {missing.permanent === 1 ? "fica" : "ficam"} de fora.
                  </p>
                )}
                {missing.uncertain > 0 && (
                  <p className="text-xs leading-5">
                    {plural(missing.uncertain, "envio não pôde", "envios não puderam")} ser confirmado
                    {missing.uncertain === 1 ? "" : "s"} e pode{missing.uncertain === 1 ? "" : "m"} ter chegado.
                    Confira a conversa (filtro “Com falha”) antes de mandar de novo.
                  </p>
                )}
              </div>
              {missing.toRetry > 0 && (
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={acting}
                  className="inline-flex flex-shrink-0 items-center gap-2 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
                >
                  <RotateCcwIcon className="h-4 w-4" />
                  Tentar de novo ({missing.toRetry})
                </button>
              )}
            </section>
          )}

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Clientes */}
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-base font-semibold text-slate-900">Clientes</h2>
                <div className="relative w-full sm:w-60">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar nome ou telefone"
                    aria-label="Buscar cliente"
                    className="w-full rounded-full border border-slate-200 py-1.5 pl-9 pr-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                </div>
              </div>
              <div className="flex gap-1.5 overflow-x-auto px-5 pt-4">
                {RECIPIENT_FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    aria-pressed={filter === key}
                    className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition ${
                      filter === key
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                    <span className={filter === key ? "text-white/70" : "text-slate-400"}>{filterCounts[key]}</span>
                  </button>
                ))}
              </div>
              {visible.length === 0 ? (
                <p className="px-5 py-12 text-center text-sm text-slate-400">Ninguém por aqui.</p>
              ) : (
                <ul className="max-h-[36rem] divide-y divide-slate-100 overflow-y-auto px-5 py-2">
                  {visible.map((recipient) => (
                    <RecipientRow
                      key={recipient.id}
                      recipient={recipient}
                      onOpenConversation={
                        recipient.conversationId ? () => openConversation(recipient.conversationId!) : null
                      }
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* Mensagem e acompanhamento */}
            <aside className="space-y-5 lg:sticky lg:top-6">
              <WhatsappPreview
                title="Mensagem enviada"
                recipientName={previewName}
                text={previewMessageText(scheduledMessage.message, previewName)}
                time={new Date(scheduledMessage.scheduledAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              />
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <TargetIcon className="h-4 w-4 text-violet-600" />
                  Como a adesão é contada
                </p>
                <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
                  <li>
                    Respostas e adesões valem até <strong>{scheduledMessage.replyWindowDays} dias</strong> depois de
                    cada envio.
                  </li>
                  <li>
                    {conversionTag ? (
                      <>
                        Colocar a etiqueta <strong>“{conversionTag.name}”</strong> na conversa, ou o botão “Aderiu”.
                      </>
                    ) : (
                      <>A equipe marca o botão “Aderiu” na conversa do cliente.</>
                    )}
                  </li>
                </ul>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */

/** Funil com barras do tamanho de cada etapa (base: quem recebeu). */
const FunnelSection: React.FC<{ stats: CampaignStats }> = ({ stats }) => {
  const steps = [
    {
      key: "sent",
      label: "Enviadas",
      value: stats.sent,
      pct: ratePercent(stats.sent, stats.total),
      base: `de ${stats.total}`,
      bar: "bg-slate-400",
      text: "text-slate-900",
    },
    {
      key: "delivered",
      label: "Entregues",
      value: stats.delivered,
      pct: ratePercent(stats.delivered, stats.sent),
      base: "das enviadas",
      bar: "bg-sky-400",
      text: "text-slate-900",
    },
    {
      key: "read",
      label: "Lidas",
      value: stats.read,
      pct: ratePercent(stats.read, stats.sent),
      base: "das enviadas",
      bar: "bg-sky-500",
      text: "text-slate-900",
    },
    {
      key: "replied",
      label: "Responderam",
      value: stats.replied,
      pct: ratePercent(stats.replied, stats.sent),
      base: "das enviadas",
      bar: "bg-blue-600",
      text: "text-blue-700",
    },
    {
      key: "converted",
      label: "Aderiram",
      value: stats.converted,
      pct: ratePercent(stats.converted, stats.sent),
      base: "das enviadas",
      bar: "bg-green-500",
      text: "text-green-700",
    },
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Resultado</h2>
        {stats.revenue > 0 && (
          <p className="rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700">
            {formatCurrency(stats.revenue)} em adesões
          </p>
        )}
      </div>
      <ol className="mt-5 grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
        {steps.map((step, index) => (
          <li key={step.key} className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">
                {index + 1}
              </span>
              {step.label}
            </p>
            <p className={`mt-1.5 text-3xl font-semibold ${step.text}`}>{step.value}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${step.bar} transition-all duration-700`} style={{ width: `${step.pct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">{step.pct}%</span> {step.base}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
};

const Chip: React.FC<{ tone: string; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
    {children}
  </span>
);

const RecipientRow: React.FC<{
  recipient: ScheduledRecipient;
  onOpenConversation: (() => void) | null;
}> = ({ recipient, onOpenConversation }) => {
  const label = recipientLabel(recipient);
  const sent = recipient.status === "sent";

  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          recipient.convertedAt ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
        }`}
        aria-hidden="true"
      >
        {recipient.convertedAt ? <CheckIcon className="h-4 w-4" /> : initialsOf(label)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-sm font-medium text-slate-900">{label}</p>
          {!sent && <RecipientStatusBadge status={recipient.status} />}
        </div>
        <p className="truncate text-xs text-slate-500">
          {formatPhone(recipient.phone)}
          {recipient.sentAt ? ` · enviada ${shortDateTime(recipient.sentAt)}` : ""}
        </p>
        {sent && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {recipient.readAt ? (
              <Chip tone="bg-sky-50 text-sky-700">Lida</Chip>
            ) : recipient.deliveredAt ? (
              <Chip tone="bg-slate-100 text-slate-600">Entregue</Chip>
            ) : (
              <Chip tone="bg-slate-50 text-slate-500">Enviada</Chip>
            )}
            {recipient.repliedAt && (
              <Chip tone="bg-blue-50 text-blue-700">Respondeu {shortDateTime(recipient.repliedAt)}</Chip>
            )}
            {recipient.convertedAt && (
              <Chip tone="bg-green-50 text-green-700">
                Aderiu
                {recipient.conversionValue ? ` · ${formatCurrency(recipient.conversionValue)}` : ""}
                {recipient.convertedVia === "tag" ? " (etiqueta)" : ""}
              </Chip>
            )}
          </div>
        )}
        {recipient.error && (
          <p className={`mt-1.5 text-xs ${recipient.status === "failed" ? "text-red-600" : "text-amber-700"}`}>
            {recipient.error}
          </p>
        )}
      </div>
      {onOpenConversation && (
        <button
          type="button"
          onClick={onOpenConversation}
          className="flex-shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
          aria-label={`Abrir conversa com ${label}`}
          title="Abrir conversa"
        >
          <MessageCircleIcon className="h-4 w-4" />
        </button>
      )}
    </li>
  );
};
