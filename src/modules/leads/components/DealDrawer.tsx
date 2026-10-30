import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClockIcon,
  CalendarClockIcon,
  CheckIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  StickyNoteIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import { useOpenConversation } from "../../floatingChats/useOpenConversation";
import { useQrWhatsappNumbers } from "../../scheduledMessages/hooks/useScheduledMessages";
import {
  defaultScheduleDate,
  formatPhone,
  formatScheduleDateTime,
  MESSAGE_STATUS_LABEL,
  parseMoneyInput,
  toDateInputValue,
  toTimeInputValue,
} from "../../scheduledMessages/utils/schedule";
import { findLatestConversation } from "../api/leads";
import {
  useDeal,
  useDealEvents,
  useDealMessages,
  useDealTasks,
  useLeadActions,
} from "../hooks/useLeads";
import type { Deal, LossReason, Pipeline, PipelineStage, TaskType } from "../types/leads";
import { daysSince, formatDue, isOverdue, localDateTimeToIso, nextOpenTask } from "../utils/board";
import { TASK_TYPE_LABEL, describeDealEvent } from "../utils/events";
import { contactLabel } from "./DealCard";
import { ContactAvatar } from "./ContactAvatar";
import { FIELD_CLASS, LABEL_CLASS } from "./LeadModal";
import type { OwnerOption } from "./NewDealModal";

type Tab = "summary" | "tasks" | "messages" | "history";
type TagInfo = { id: string; name: string; color: string | null };

// 2500 -> "2.500,00" (o campo aceita de volta pelo parseMoneyInput)
const moneyInputValue = (value: number | null) =>
  value === null
    ? ""
    : value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

const SOURCE_LABEL: Record<Deal["source"], string> = {
  manual: "Criada no funil",
  conversation: "Criada pela conversa",
  campaign: "Veio de uma campanha",
};

export const DealDrawer: React.FC<{
  dealId: string;
  pipelines: Pipeline[];
  lossReasons: LossReason[];
  tags: TagInfo[];
  ownerOptions: OwnerOption[];
  userNames: Record<string, string>;
  currentUserId: string | null;
  isAdmin: boolean;
  clinicId: string | null;
  onClose: () => void;
  // Mover pela tela principal (ela pede o motivo quando é perda)
  onMove: (deal: Deal, stage: PipelineStage) => void;
}> = (props) => {
  const { deal, loading } = useDeal(props.dealId);
  const { onClose } = props;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/30"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Negociação"
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl"
      >
        {loading || !deal ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">
            {loading ? "Carregando..." : "Negociação não encontrada ou sem acesso."}
            {!loading && (
              <button type="button" onClick={onClose} className="ml-2 font-medium text-blue-600 hover:underline">
                Fechar
              </button>
            )}
          </div>
        ) : (
          <DealDetails
            key={deal.id}
            {...props}
            deal={deal}
            pipeline={props.pipelines.find((p) => p.id === deal.pipelineId) ?? null}
          />
        )}
      </aside>
    </div>
  );
};

/* -------------------------------------------------------------------------- */

const DealDetails: React.FC<{
  deal: Deal;
  pipeline: Pipeline | null;
  lossReasons: LossReason[];
  tags: TagInfo[];
  ownerOptions: OwnerOption[];
  userNames: Record<string, string>;
  currentUserId: string | null;
  isAdmin: boolean;
  clinicId: string | null;
  onClose: () => void;
  onMove: (deal: Deal, stage: PipelineStage) => void;
}> = ({
  deal,
  pipeline,
  lossReasons,
  tags,
  ownerOptions,
  userNames,
  currentUserId,
  isAdmin,
  clinicId,
  onClose,
  onMove,
}) => {
  const confirm = useConfirm();
  const openConversation = useOpenConversation();
  const actions = useLeadActions();
  const [tab, setTab] = useState<Tab>("summary");
  // Abrir uma aba já com o formulário aberto (ex.: "Criar tarefa" no resumo)
  const [openForm, setOpenForm] = useState<"task" | "message" | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(deal.title);

  useEffect(() => setTitle(deal.title), [deal.title]);

  const messages = useDealMessages(deal.id);
  const openTasks = deal.tasks.filter((t) => !t.doneAt);
  const hasOverdue = openTasks.some((t) => isOverdue(t.dueAt));
  const isOpen = deal.status === "open";
  const closingStages = pipeline?.stages.filter((s) => s.kind !== "open") ?? [];

  const owners = useMemo(() => {
    if (!deal.ownerUserId || ownerOptions.some((o) => o.id === deal.ownerUserId)) return ownerOptions;
    return [...ownerOptions, { id: deal.ownerUserId, label: userNames[deal.ownerUserId] ?? "Atendente" }];
  }, [ownerOptions, deal.ownerUserId, userNames]);

  const saveTitle = async () => {
    setEditingTitle(false);
    if (!title.trim() || title.trim() === deal.title) {
      setTitle(deal.title);
      return;
    }
    try {
      await actions.updateDeal({ id: deal.id, patch: { title } });
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar.");
    }
  };

  const openChat = async () => {
    try {
      const conversationId = deal.sourceConversationId ?? (await findLatestConversation(deal.contact.id));
      if (!conversationId) {
        toast.info("Este cliente ainda não tem conversa. Use a aba Mensagens para falar com ele.");
        return;
      }
      openConversation(conversationId);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível abrir a conversa.");
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Excluir negociação?",
      description: "O cartão, as tarefas e o histórico serão apagados. As conversas com o cliente continuam.",
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await actions.deleteDeal(deal.id);
      toast.success("Negociação excluída.");
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível excluir.");
    }
  };

  const goTo = (next: Tab, form: "task" | "message" | null = null) => {
    setTab(next);
    setOpenForm(form);
  };

  const TABS: { key: Tab; label: string; count?: number; alert?: boolean }[] = [
    { key: "summary", label: "Resumo" },
    { key: "tasks", label: "Tarefas", count: openTasks.length, alert: hasOverdue },
    { key: "messages", label: "Mensagens", count: messages.length },
    { key: "history", label: "Histórico" },
  ];

  return (
    <>
      {/* Cabeçalho */}
      <header className="border-b border-slate-100 px-5 pb-0 pt-4">
        <div className="flex items-start gap-3">
          <ContactAvatar contact={deal.contact} label={contactLabel(deal.contact)} size="md" />
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <input
                autoFocus
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={saveTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                  if (event.key === "Escape") {
                    setTitle(deal.title);
                    setEditingTitle(false);
                  }
                }}
                className={`${FIELD_CLASS} py-1.5 text-base font-semibold`}
                aria-label="Título da negociação"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                className="group flex max-w-full items-center gap-2 text-left"
                title="Editar título"
              >
                <h2 className="truncate text-lg font-semibold text-slate-900">{deal.title}</h2>
                <PencilIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 opacity-0 transition group-hover:opacity-100" />
              </button>
            )}
            <p className="truncate text-sm text-slate-500">
              {/* O nome só aparece aqui quando é diferente do título */}
              {contactLabel(deal.contact) !== deal.title ? `${contactLabel(deal.contact)} · ` : ""}
              {deal.contact.phone ? formatPhone(deal.contact.phone) : "Sem telefone"}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={openChat}
              className="rounded-full p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-600"
              aria-label="Abrir conversa"
              title="Abrir conversa"
            >
              <MessageCircleIcon className="h-5 w-5" />
            </button>
            {isAdmin && <HeaderMenu onDelete={remove} />}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              aria-label="Fechar"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Etapa: barra de progresso clicável */}
        {pipeline && <StageBar deal={deal} pipeline={pipeline} onMove={onMove} />}

        {/* Abas */}
        <nav className="-mb-px mt-4 flex gap-1" aria-label="Seções da negociação">
          {TABS.map(({ key, label, count, alert }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => goTo(key)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-500 hover:border-slate-200 hover:text-slate-800"
                }`}
              >
                {label}
                {count !== undefined && count > 0 && (
                  <span
                    className={`min-w-[18px] rounded-full px-1.5 text-center text-[11px] font-semibold ${
                      alert ? "bg-red-100 text-red-700" : active ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-5">
        {tab === "summary" && (
          <SummaryTab
            deal={deal}
            lossReasons={lossReasons}
            tags={tags}
            owners={owners}
            userNames={userNames}
            onGoTo={goTo}
          />
        )}
        {tab === "tasks" && (
          <TasksTab
            deal={deal}
            ownerOptions={owners}
            userNames={userNames}
            formOpen={openForm === "task"}
            setFormOpen={(open) => setOpenForm(open ? "task" : null)}
          />
        )}
        {tab === "messages" && (
          <MessagesTab
            deal={deal}
            clinicId={clinicId}
            messages={messages}
            formOpen={openForm === "message"}
            setFormOpen={(open) => setOpenForm(open ? "message" : null)}
          />
        )}
        {tab === "history" && <HistoryTab deal={deal} userNames={userNames} currentUserId={currentUserId} />}
      </div>

      {/* Encerrar a negociação */}
      {isOpen && closingStages.length > 0 && (
        <footer className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-white px-5 py-3">
          {closingStages
            .slice()
            // Perdida à esquerda, ganha (ação principal) à direita
            .sort((a, b) => (a.kind === "lost" ? 0 : 1) - (b.kind === "lost" ? 0 : 1))
            .map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onMove(deal, s)}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  s.kind === "won"
                    ? "bg-green-600 text-white hover:bg-green-700"
                    : "border border-red-200 text-red-600 hover:border-red-300 hover:bg-red-50"
                }`}
              >
                {s.kind === "won" ? <CheckIcon className="h-4 w-4" /> : <XIcon className="h-4 w-4" />}
                {s.kind === "won" ? "Marcar como ganha" : "Marcar como perdida"}
              </button>
            ))}
        </footer>
      )}
    </>
  );
};

/* ------------------------------ Etapas ----------------------------------- */

/**
 * Etapas em andamento como uma barra: o que já passou fica preenchido, a
 * atual em destaque. Clicar move. Ganho/Perdido ficam nos botões do rodapé.
 */
const StageBar: React.FC<{
  deal: Deal;
  pipeline: Pipeline;
  onMove: (deal: Deal, stage: PipelineStage) => void;
}> = ({ deal, pipeline, onMove }) => {
  const open = pipeline.stages.filter((s) => s.kind === "open");
  const currentIndex = open.findIndex((s) => s.id === deal.stageId);
  const closed = deal.status !== "open";
  const days = daysSince(deal.stageEnteredAt);

  return (
    <div className="mt-4">
      <div className="flex gap-1" role="group" aria-label="Etapa da negociação">
        {open.map((stage, index) => {
          const current = index === currentIndex;
          const passed = !closed && index < currentIndex;
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => !current && onMove(deal, stage)}
              aria-pressed={current}
              title={current ? `Etapa atual: ${stage.name}` : `Mover para ${stage.name}`}
              className={`group min-w-0 flex-1 rounded-md px-2 py-1.5 text-center text-xs font-semibold transition ${
                current
                  ? "text-white shadow-sm"
                  : passed
                    ? "text-slate-700 hover:brightness-95"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
              }`}
              style={
                current
                  ? { backgroundColor: stage.color }
                  : passed
                    ? { backgroundColor: `${stage.color}33` }
                    : undefined
              }
            >
              <span className="block truncate">{stage.name}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {closed
          ? "Negociação encerrada. Para reabrir, escolha uma etapa acima."
          : `Nesta etapa há ${days === 0 ? "menos de 1 dia" : `${days} ${days === 1 ? "dia" : "dias"}`}.`}
      </p>
    </div>
  );
};

const HeaderMenu: React.FC<{ onDelete: () => void }> = ({ onDelete }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Mais ações"
        className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
      >
        <MoreHorizontalIcon className="h-5 w-5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
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
            Excluir negociação
          </button>
        </div>
      )}
    </div>
  );
};

/* ------------------------------- Resumo ---------------------------------- */

const Section: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  action,
  children,
}) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {action}
    </div>
    <div className="mt-3">{children}</div>
  </section>
);

const SummaryTab: React.FC<{
  deal: Deal;
  lossReasons: LossReason[];
  tags: TagInfo[];
  owners: OwnerOption[];
  userNames: Record<string, string>;
  onGoTo: (tab: Tab, form?: "task" | "message" | null) => void;
}> = ({ deal, lossReasons, tags, owners, userNames, onGoTo }) => {
  const actions = useLeadActions();
  const [value, setValue] = useState(moneyInputValue(deal.value));
  const [editingTags, setEditingTags] = useState(false);
  const task = nextOpenTask(deal.tasks);
  const lostReason = lossReasons.find((r) => r.id === deal.lostReasonId);
  const dealTags = tags.filter((t) => deal.tagIds.includes(t.id));

  useEffect(() => setValue(moneyInputValue(deal.value)), [deal.value]);

  const save = async (patch: Parameters<typeof actions.updateDeal>[0]["patch"], ok?: string) => {
    try {
      await actions.updateDeal({ id: deal.id, patch });
      if (ok) toast.success(ok);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar.");
    }
  };

  const saveValue = async () => {
    const parsed = parseMoneyInput(value);
    if (parsed !== null && Number.isNaN(parsed)) {
      toast.error("Valor inválido. Ex.: 150 ou 1.500,00");
      return;
    }
    if (parsed === deal.value) return;
    await save({ value: parsed }, "Valor salvo.");
  };

  const toggleTag = async (tagId: string) => {
    const next = deal.tagIds.includes(tagId) ? deal.tagIds.filter((id) => id !== tagId) : [...deal.tagIds, tagId];
    try {
      await actions.setTags({ dealId: deal.id, current: deal.tagIds, next });
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar as etiquetas.");
    }
  };

  return (
    <div className="space-y-4">
      {deal.status !== "open" && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            deal.status === "won" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <p className="font-semibold">
            {deal.status === "won" ? "Negociação ganha" : "Negociação perdida"} em{" "}
            {shortDateTime(deal.closedAt ?? deal.updatedAt)}
          </p>
          {deal.status === "lost" && (lostReason || deal.lostNote) && (
            <p className="mt-0.5 text-xs">
              {lostReason?.name}
              {lostReason && deal.lostNote ? " · " : ""}
              {deal.lostNote}
            </p>
          )}
        </div>
      )}

      {/* Próximo passo */}
      <Section title="Próximo passo">
        {task ? (
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => actions.toggleTask({ taskId: task.id, done: true })}
              className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-slate-300 text-transparent transition hover:border-green-500 hover:text-green-500"
              aria-label={`Concluir: ${task.title}`}
            >
              <CheckIcon className="h-3 w-3" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800 [overflow-wrap:anywhere]">{task.title}</p>
              <p
                className={`mt-0.5 flex items-center gap-1 text-xs ${
                  isOverdue(task.dueAt) ? "font-semibold text-red-600" : "text-slate-500"
                }`}
              >
                <AlarmClockIcon className="h-3 w-3" />
                {formatDue(task.dueAt)}
                {isOverdue(task.dueAt) ? " · atrasada" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onGoTo("tasks")}
              className="flex-shrink-0 text-xs font-medium text-blue-600 hover:underline"
            >
              Ver tarefas
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">Nenhuma tarefa pendente.</p>
            <button
              type="button"
              onClick={() => onGoTo("tasks", "task")}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Criar tarefa
            </button>
          </div>
        )}
      </Section>

      {/* Dados */}
      <Section title="Detalhes">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="drawer-value" className={LABEL_CLASS}>
              Valor
            </label>
            <input
              id="drawer-value"
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onBlur={saveValue}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
              placeholder="R$ 0,00"
              className={`${FIELD_CLASS} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="drawer-owner" className={LABEL_CLASS}>
              Responsável
            </label>
            <select
              id="drawer-owner"
              value={deal.ownerUserId ?? ""}
              onChange={(event) => save({ ownerUserId: event.target.value || null }, "Responsável atualizado.")}
              className={`${FIELD_CLASS} mt-1`}
            >
              {owners.map((option) => (
                <option key={option.id ?? "none"} value={option.id ?? ""}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className={LABEL_CLASS}>Etiquetas</p>
              <button
                type="button"
                onClick={() => setEditingTags((v) => !v)}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                {editingTags ? "Pronto" : "Editar"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(editingTags ? tags : dealTags).map((tag) => {
                const active = deal.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    disabled={!editingTags}
                    onClick={() => toggleTag(tag.id)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:cursor-default ${
                      active ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color ?? "#94a3b8" }} />
                    {tag.name}
                    {editingTags && active && <CheckIcon className="h-3 w-3" />}
                  </button>
                );
              })}
              {!editingTags && dealTags.length === 0 && <p className="text-xs text-slate-400">Nenhuma etiqueta.</p>}
            </div>
          </div>
        )}
      </Section>

      <p className="flex items-center gap-1.5 px-1 text-xs text-slate-400">
        {deal.source === "campaign" && <MegaphoneIcon className="h-3.5 w-3.5 text-violet-500" />}
        {SOURCE_LABEL[deal.source]} em {shortDateTime(deal.createdAt)}
        {deal.createdBy && userNames[deal.createdBy] ? ` por ${userNames[deal.createdBy]}` : ""}
      </p>
    </div>
  );
};

/* ------------------------------- Tarefas --------------------------------- */

const AddButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
  >
    <PlusIcon className="h-4 w-4" />
    {children}
  </button>
);

const TasksTab: React.FC<{
  deal: Deal;
  ownerOptions: OwnerOption[];
  userNames: Record<string, string>;
  formOpen: boolean;
  setFormOpen: (open: boolean) => void;
}> = ({ deal, ownerOptions, userNames, formOpen, setFormOpen }) => {
  const { data: tasks = [], isLoading } = useDealTasks(deal.id);
  const actions = useLeadActions();
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }, []);
  const [title, setTitle] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("call");
  const [date, setDate] = useState(toDateInputValue(tomorrow));
  const [time, setTime] = useState(toTimeInputValue(tomorrow));
  const [assigned, setAssigned] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const open = tasks.filter((t) => !t.doneAt);
  const done = tasks.filter((t) => t.doneAt);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      toast.error("Descreva a tarefa.");
      return;
    }
    const dueAt = localDateTimeToIso(date, time);
    if (!dueAt) {
      toast.error("Informe data e hora.");
      return;
    }
    try {
      await actions.addTask({ dealId: deal.id, title, taskType, dueAt, assignedUserId: assigned });
      setTitle("");
      setFormOpen(false);
      toast.success("Tarefa criada. O lembrete chega no horário.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível criar a tarefa.");
    }
  };

  return (
    <div className="space-y-3">
      {formOpen ? (
        <form onSubmit={add} className="space-y-3 rounded-2xl border border-blue-200 bg-white p-4 ring-4 ring-blue-50">
          <input
            type="text"
            autoFocus
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="O que precisa ser feito? Ex.: Ligar para confirmar a proposta"
            className={FIELD_CLASS}
            aria-label="Nova tarefa"
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={taskType} onChange={(event) => setTaskType(event.target.value as TaskType)} className={FIELD_CLASS} aria-label="Tipo">
              {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((key) => (
                <option key={key} value={key}>
                  {TASK_TYPE_LABEL[key]}
                </option>
              ))}
            </select>
            <select
              value={assigned ?? ""}
              onChange={(event) => setAssigned(event.target.value || null)}
              className={FIELD_CLASS}
              aria-label="Quem recebe o lembrete"
            >
              <option value="">Lembrete: responsável</option>
              {ownerOptions
                .filter((o) => o.id)
                .map((o) => (
                  <option key={o.id} value={o.id as string}>
                    Lembrete: {o.label}
                  </option>
                ))}
            </select>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={FIELD_CLASS} aria-label="Data" />
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={FIELD_CLASS} aria-label="Hora" />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button type="submit" className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">
              Salvar tarefa
            </button>
          </div>
        </form>
      ) : (
        <AddButton onClick={() => setFormOpen(true)}>Nova tarefa</AddButton>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white">
        {isLoading ? (
          <p className="p-4 text-sm text-slate-400">Carregando...</p>
        ) : open.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">Nenhuma tarefa pendente.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {open.map((task) => {
              const overdue = isOverdue(task.dueAt);
              return (
                <li key={task.id} className="group flex items-start gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => actions.toggleTask({ taskId: task.id, done: true })}
                    className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-slate-300 text-transparent transition hover:border-green-500 hover:text-green-500"
                    aria-label={`Concluir: ${task.title}`}
                  >
                    <CheckIcon className="h-3 w-3" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800 [overflow-wrap:anywhere]">{task.title}</p>
                    <p className={`mt-0.5 flex items-center gap-1 text-xs ${overdue ? "font-semibold text-red-600" : "text-slate-500"}`}>
                      <AlarmClockIcon className="h-3 w-3" />
                      {TASK_TYPE_LABEL[task.taskType]} · {formatDue(task.dueAt)}
                      {overdue ? " · atrasada" : ""}
                      {task.assignedUserId ? ` · ${userNames[task.assignedUserId] ?? "Atendente"}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => actions.removeTask(task.id)}
                    className="rounded-full p-1.5 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                    aria-label={`Excluir tarefa: ${task.title}`}
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {done.length > 0 && (
        <div className="px-1">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="text-xs font-medium text-slate-500 hover:text-slate-800">
            {showDone ? "Esconder" : "Ver"} concluídas ({done.length})
          </button>
          {showDone && (
            <ul className="mt-2 space-y-1.5">
              {done.map((task) => (
                <li key={task.id} className="flex items-center gap-2 text-xs text-slate-400">
                  <button
                    type="button"
                    onClick={() => actions.toggleTask({ taskId: task.id, done: false })}
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white"
                    aria-label={`Reabrir: ${task.title}`}
                  >
                    <CheckIcon className="h-2.5 w-2.5" />
                  </button>
                  <span className="line-through">{task.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------ Mensagens -------------------------------- */

const MessagesTab: React.FC<{
  deal: Deal;
  clinicId: string | null;
  messages: ReturnType<typeof useDealMessages>;
  formOpen: boolean;
  setFormOpen: (open: boolean) => void;
}> = ({ deal, clinicId, messages, formOpen, setFormOpen }) => {
  const actions = useLeadActions();
  const { numbers } = useQrWhatsappNumbers(clinicId);
  const initial = useMemo(() => defaultScheduleDate(), []);
  const [text, setText] = useState("");
  const [sendNow, setSendNow] = useState(false);
  const [date, setDate] = useState(toDateInputValue(initial));
  const [time, setTime] = useState(toTimeInputValue(initial));
  const [connectionId, setConnectionId] = useState<string | null>(null);

  useEffect(() => {
    if (numbers.length === 0 || connectionId) return;
    setConnectionId((numbers.find((n) => n.connected) ?? numbers[0]).id);
  }, [numbers, connectionId]);

  if (!deal.contact.phone) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Este cliente não tem telefone de WhatsApp na carteira. Fale com ele pela conversa.
      </p>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) {
      toast.error("Escreva a mensagem.");
      return;
    }
    let scheduledAt: string | null = null;
    if (!sendNow) {
      scheduledAt = localDateTimeToIso(date, time);
      if (!scheduledAt || new Date(scheduledAt).getTime() < Date.now() + 60000) {
        toast.error("Escolha uma data e hora no futuro.");
        return;
      }
    }
    try {
      await actions.scheduleMessage({
        dealId: deal.id,
        message: text,
        scheduledAt,
        sendNow,
        channelConnectionId: numbers.length > 0 ? connectionId : null,
      });
      setText("");
      setFormOpen(false);
      toast.success(sendNow ? "Mensagem a caminho (sai em até 1 minuto)." : "Mensagem agendada.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível agendar.");
    }
  };

  return (
    <div className="space-y-3">
      {formOpen ? (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-blue-200 bg-white p-4 ring-4 ring-blue-50">
          <textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Ex.: Oi {nome}! Passando para saber se ficou alguma dúvida sobre a proposta."
            className={`${FIELD_CLASS} resize-none`}
            aria-label="Mensagem"
          />
          <p className="text-xs text-slate-500">
            Sai pelo WhatsApp só para {contactLabel(deal.contact)}. Use{" "}
            <code className="rounded bg-slate-100 px-1">{"{nome}"}</code> para o nome do cliente.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                [false, "Agendar", CalendarClockIcon],
                [true, "Enviar agora", SendIcon],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={label}
                type="button"
                onClick={() => setSendNow(v)}
                aria-pressed={sendNow === v}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                  sendNow === v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          {!sendNow && (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={date}
                min={toDateInputValue(new Date())}
                onChange={(event) => setDate(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Data do envio"
              />
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={FIELD_CLASS} aria-label="Hora do envio" />
            </div>
          )}
          {numbers.length > 1 && (
            <select
              value={connectionId ?? ""}
              onChange={(event) => setConnectionId(event.target.value || null)}
              className={FIELD_CLASS}
              aria-label="Número de saída"
            >
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.connected ? n.label : `${n.label} (desconectado)`}
                </option>
              ))}
            </select>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={actions.scheduling}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {actions.scheduling ? "Salvando..." : sendNow ? "Enviar" : "Agendar"}
            </button>
          </div>
        </form>
      ) : (
        <AddButton onClick={() => setFormOpen(true)}>Agendar mensagem</AddButton>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white">
        {messages.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">Nenhuma mensagem agendada para este cliente.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {messages.map((m) => (
              <li key={m.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1 text-slate-500">
                    <CalendarClockIcon className="h-3.5 w-3.5" />
                    {formatScheduleDateTime(m.scheduledAt)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                    {MESSAGE_STATUS_LABEL[m.status]}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-slate-700">{m.message}</p>
                {m.recipientError && <p className="mt-1 text-xs text-red-600">{m.recipientError}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

/* ------------------------------ Histórico -------------------------------- */

const HistoryTab: React.FC<{
  deal: Deal;
  userNames: Record<string, string>;
  currentUserId: string | null;
}> = ({ deal, userNames, currentUserId }) => {
  const { data: events = [], isLoading } = useDealEvents(deal.id);
  const actions = useLeadActions();
  const [note, setNote] = useState("");

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!note.trim() || !currentUserId) return;
    try {
      await actions.addNote({ dealId: deal.id, userId: currentUserId, note });
      setNote("");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar a nota.");
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="rounded-2xl border border-slate-200 bg-white p-3">
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Escreva uma nota (só a equipe vê)"
          className="w-full resize-none border-0 bg-transparent p-1 text-sm text-slate-800 outline-none placeholder:text-slate-400"
          aria-label="Nova nota"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!note.trim()}
            className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
          >
            Salvar nota
          </button>
        </div>
      </form>

      <ol className="relative space-y-4 border-l border-slate-200 pl-5">
        {isLoading && <li className="text-sm text-slate-400">Carregando...</li>}
        {events.map((event) => {
          const who = event.userId ? userNames[event.userId] ?? "Atendente" : "Sistema";
          const isNote = event.type === "note";
          return (
            <li key={event.id} className="relative">
              <span
                className={`absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-slate-50 ${
                  isNote ? "bg-amber-100 text-amber-700" : "bg-slate-200"
                }`}
                aria-hidden="true"
              >
                {isNote && <StickyNoteIcon className="h-2.5 w-2.5" />}
              </span>
              {isNote ? (
                <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2">
                  <p className="whitespace-pre-wrap text-sm text-slate-800 [overflow-wrap:anywhere]">{event.note}</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-800">{describeDealEvent(event, userNames)}</p>
                  {event.note && (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-500 [overflow-wrap:anywhere]">“{event.note}”</p>
                  )}
                </>
              )}
              <p className="mt-1 text-xs text-slate-400">
                {who} · {shortDateTime(event.createdAt)}
                {isNote && event.userId === currentUserId && (
                  <button
                    type="button"
                    onClick={() => actions.removeNote(event.id)}
                    className="ml-2 font-medium text-slate-400 hover:text-red-600"
                  >
                    apagar
                  </button>
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
