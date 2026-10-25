import React, { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useOpenConversation } from "../modules/floatingChats/useOpenConversation";
import {
  ArrowLeftIcon,
  BanIcon,
  CheckIcon,
  KanbanSquareIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  RotateCcwIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../contexts/ClinicContext";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useConfirm } from "../components/ui/ConfirmDialog";
import {
  MessageStatusBadge,
  RecipientStatusBadge,
} from "../modules/scheduledMessages/components/StatusBadge";
import {
  CampaignFunnel,
  CampaignProgress,
} from "../modules/scheduledMessages/components/CampaignInsights";
import {
  useCampaignTags,
  useQrWhatsappNumbers,
  useScheduledMessage,
  useScheduledMessageActions,
} from "../modules/scheduledMessages/hooks/useScheduledMessages";
import type {
  ScheduledMessage,
  ScheduledRecipient,
} from "../modules/scheduledMessages/types/scheduledMessages";
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
  isEditable,
  recipientLabel,
  retrySummary,
} from "../modules/scheduledMessages/utils/schedule";
import { CAMPAIGNS_PATH } from "../modules/scheduledMessages/paths";
import { useLeadActions } from "../modules/leads/hooks/useLeads";
import { CampaignWizard } from "../modules/scheduledMessages/components/CampaignWizard";

const SectionTitle: React.FC<{
  icon: React.ElementType<{ className?: string }>;
  children: React.ReactNode;
}> = ({ icon: Icon, children }) => (
  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
    <Icon className="h-4 w-4 text-blue-500" />
    {children}
  </h2>
);

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export const ScheduledMessageEditorPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const scheduledMessageId = id ?? null;

  const { scheduledMessage, loading, error } =
    useScheduledMessage(scheduledMessageId);

  if (scheduledMessageId && loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (scheduledMessageId && !scheduledMessage) {
    return (
      <div className="h-full bg-slate-50 px-4 py-6 sm:px-8">
        <Card className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Campanha não encontrada
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {error ?? "Ela pode ter sido excluída ou pertencer a outra pessoa."}
          </p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate(CAMPAIGNS_PATH)}
            className="mt-4"
          >
            Voltar para a lista
          </Button>
        </Card>
      </div>
    );
  }

  if (scheduledMessage && !isEditable(effectiveStatus(scheduledMessage))) {
    return <CampaignResult scheduledMessage={scheduledMessage} />;
  }

  // key: o formulário é montado uma vez por campanha (as atualizações
  // periódicas da consulta não apagam o que a pessoa está digitando)
  return (
    <CampaignWizard
      key={scheduledMessage?.id ?? "new"}
      existing={scheduledMessage}
    />
  );
};

const PageShell: React.FC<{
  title: string;
  subtitle: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, badge, children }) => {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b bg-white px-4 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(CAMPAIGNS_PATH)}
            className="rounded-full border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
            aria-label="Voltar para a lista"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-xl font-semibold text-gray-900">{title}</h1>
              {badge}
            </div>
            <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {children}
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Resultado (já começou a ser enviada, foi finalizada ou cancelada)          */
/* -------------------------------------------------------------------------- */

type RecipientFilter = "all" | "replied" | "converted" | "unread" | "failed";

const RECIPIENT_FILTERS: {
  key: RecipientFilter;
  label: string;
  match: (r: ScheduledRecipient) => boolean;
}[] = [
  { key: "all", label: "Todos", match: () => true },
  { key: "replied", label: "Responderam", match: (r) => Boolean(r.repliedAt) },
  { key: "converted", label: "Aderiram", match: (r) => Boolean(r.convertedAt) },
  {
    key: "unread",
    label: "Não leram",
    match: (r) => r.status === "sent" && !r.readAt,
  },
  {
    key: "failed",
    label: "Com falha",
    match: (r) => r.status === "failed",
  },
];

const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

const Pill: React.FC<{ tone: string; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
  >
    {children}
  </span>
);

const CampaignResult: React.FC<{
  scheduledMessage: ScheduledMessage;
}> = ({ scheduledMessage }) => {
  const openConversation = useOpenConversation();
  const confirm = useConfirm();
  const { cancel, retry, acting } = useScheduledMessageActions();
  const stats = useMemo(
    () => campaignStats(scheduledMessage.recipients),
    [scheduledMessage.recipients],
  );
  const missing = useMemo(
    () => retrySummary(scheduledMessage.recipients),
    [scheduledMessage.recipients],
  );
  const { clinicId } = useClinic();
  const { numbers } = useQrWhatsappNumbers(clinicId);
  const { tags } = useCampaignTags(clinicId);
  const [filter, setFilter] = useState<RecipientFilter>("all");
  const status = effectiveStatus(scheduledMessage);

  const numberLabel =
    numbers.length > 1
      ? numbers.find((n) => n.id === scheduledMessage.channelConnectionId)
          ?.label
      : undefined;
  const conversionTag = tags.find((t) => t.id === scheduledMessage.conversionTagId);

  const visible = useMemo(() => {
    const match = RECIPIENT_FILTERS.find((f) => f.key === filter)?.match;
    return match ? scheduledMessage.recipients.filter(match) : scheduledMessage.recipients;
  }, [scheduledMessage.recipients, filter]);

  const handleCancel = async () => {
    const ok = await confirm({
      title: "Cancelar campanha?",
      description:
        "Os envios que ainda não saíram serão cancelados. Os que já foram enviados não são afetados.",
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
          A mesma mensagem volta para a fila de envio, no mesmo ritmo seguro
          (leva cerca de {formatDuration(estimateSendDurationMs(missing.toRetry))}).
          Antes, confira se o WhatsApp está conectado.
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
      toast.success(
        `${plural(count, "cliente voltou", "clientes voltaram")} para a fila de envio.`,
      );
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível tentar de novo.");
    }
  };

  const leadActions = useLeadActions();
  const navigate = useNavigate();
  const handleToFunnel = async () => {
    try {
      const count = await leadActions.campaignToDeals({
        campaignId: scheduledMessage.id,
        onlyReplied: true,
      });
      if (count === 0) {
        toast.info("Quem respondeu já está no funil.");
        return;
      }
      toast.success(
        `${plural(count, "negociação criada", "negociações criadas")} em “Novo lead”.`,
      );
      navigate("/inbox/leads");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível levar ao funil.");
    }
  };

  const finished = status !== "processing" && status !== "scheduled";
  const showMissing =
    finished && missing.toRetry + missing.permanent + missing.uncertain > 0;

  return (
    <PageShell
      title={campaignTitle(scheduledMessage)}
      subtitle={`Envio a partir de ${formatScheduleDateTime(scheduledMessage.scheduledAt)}`}
      badge={<MessageStatusBadge status={status} />}
    >
      <Card className="rounded-2xl border border-slate-200 p-5 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon={MegaphoneIcon}>Resultado</SectionTitle>
          {isCancellable(scheduledMessage.status) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={acting}
              className="border border-amber-200"
            >
              <span className="flex items-center gap-2 text-amber-700">
                <BanIcon className="h-4 w-4" />
                Cancelar envios restantes
              </span>
            </Button>
          )}
        </div>
        <div className="mt-4">
          <CampaignProgress stats={stats} status={status} />
        </div>
        {showMissing && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 text-xs leading-5 text-amber-900">
              <p className="text-sm font-semibold">Quem não recebeu</p>
              {missing.retryable > 0 && (
                <p>
                  {plural(missing.retryable, "envio falhou", "envios falharam")} sem
                  a mensagem sair (WhatsApp desconectado ou recusa): dá para
                  tentar de novo.
                </p>
              )}
              {missing.cancelled > 0 && (
                <p>
                  {plural(missing.cancelled, "envio foi cancelado", "envios foram cancelados")}{" "}
                  antes de sair.
                </p>
              )}
              {missing.permanent > 0 && (
                <p>
                  {plural(missing.permanent, "número não tem", "números não têm")}{" "}
                  WhatsApp e {missing.permanent === 1 ? "fica" : "ficam"} de fora.
                </p>
              )}
              {missing.uncertain > 0 && (
                <p>
                  {plural(missing.uncertain, "envio não pôde", "envios não puderam")}{" "}
                  ser confirmado{missing.uncertain === 1 ? "" : "s"} e pode
                  {missing.uncertain === 1 ? "" : "m"} ter chegado. Para não
                  mandar em dobro, confira a conversa (filtro “Com falha”) e,
                  se precisar, responda pelo atendimento.
                </p>
              )}
            </div>
            {missing.toRetry > 0 && (
              <Button
                type="button"
                onClick={handleRetry}
                disabled={acting}
                className="flex-shrink-0 rounded-full"
              >
                <span className="flex items-center gap-2">
                  <RotateCcwIcon className="h-4 w-4" />
                  Tentar de novo ({missing.toRetry})
                </span>
              </Button>
            )}
          </div>
        )}
        <div className="mt-5">
          <CampaignFunnel stats={stats} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Respostas e adesões contam até {scheduledMessage.replyWindowDays} dias
          depois de cada envio.{" "}
          {conversionTag
            ? `Colocar a etiqueta “${conversionTag.name}” na conversa marca a adesão.`
            : "A adesão é marcada pelo botão “Aderiu” na conversa."}
        </p>
        {stats.replied > 0 && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-blue-900">
              <span className="block text-sm font-semibold">Acompanhar no funil de vendas</span>
              Cria uma negociação para cada cliente que respondeu (quem já tem
              negociação aberta fica de fora). Quando a adesão for marcada, a
              negociação vai sozinha para “Ganho”.
            </p>
            <Button
              type="button"
              variant="ghost"
              onClick={handleToFunnel}
              disabled={leadActions.movingFromCampaign}
              className="flex-shrink-0 rounded-full border border-blue-200 bg-white"
            >
              <span className="flex items-center gap-2 text-blue-700">
                <KanbanSquareIcon className="h-4 w-4" />
                Levar ao funil ({stats.replied})
              </span>
            </Button>
          </div>
        )}
      </Card>

      <Card className="rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle icon={UsersIcon}>Clientes</SectionTitle>
          <span className="text-xs text-slate-500">
            {visible.length} de {stats.total}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {RECIPIENT_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                filter === key
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Ninguém neste filtro.
          </p>
        ) : (
          <ul className="mt-3 max-h-[32rem] divide-y divide-slate-100 overflow-y-auto pr-1">
            {visible.map((recipient) => (
              <li key={recipient.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {recipientLabel(recipient)}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {formatPhone(recipient.phone)}
                      {recipient.sentAt ? ` · ${shortDateTime(recipient.sentAt)}` : ""}
                    </p>
                  </div>
                  <RecipientStatusBadge status={recipient.status} />
                </div>
                {recipient.status === "sent" && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {recipient.readAt ? (
                      <Pill tone="bg-sky-50 text-sky-700">Lida</Pill>
                    ) : recipient.deliveredAt ? (
                      <Pill tone="bg-slate-100 text-slate-600">Entregue</Pill>
                    ) : null}
                    {recipient.repliedAt && (
                      <Pill tone="bg-blue-50 text-blue-700">
                        Respondeu {shortDateTime(recipient.repliedAt)}
                      </Pill>
                    )}
                    {recipient.convertedAt && (
                      <Pill tone="bg-green-50 text-green-700">
                        <CheckIcon className="h-3 w-3" />
                        Aderiu
                        {recipient.conversionValue
                          ? ` · ${formatCurrency(recipient.conversionValue)}`
                          : ""}
                        {recipient.convertedVia === "tag" ? " (etiqueta)" : ""}
                      </Pill>
                    )}
                  </div>
                )}
                {recipient.error && (
                  <p
                    className={`mt-1.5 text-xs ${
                      recipient.status === "failed"
                        ? "text-red-600"
                        : "text-amber-700"
                    }`}
                  >
                    {recipient.error}
                  </p>
                )}
                {recipient.conversationId && (
                  <button
                    type="button"
                    onClick={() => openConversation(recipient.conversationId!)}
                    className="mt-1.5 text-xs font-medium text-blue-600 hover:underline"
                  >
                    Abrir conversa
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="rounded-2xl border border-slate-200 p-5">
        <SectionTitle icon={MessageSquareTextIcon}>Mensagem</SectionTitle>
        <p className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-800">
          {scheduledMessage.message}
        </p>
        {numberLabel && (
          <p className="mt-3 text-xs text-slate-500">
            Enviada pelo número{" "}
            <span className="font-medium text-slate-700">{numberLabel}</span>
          </p>
        )}
      </Card>
    </PageShell>
  );
};
