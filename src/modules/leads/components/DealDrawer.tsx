import React, { useEffect, useMemo, useState } from "react";
import {
  AlarmClockIcon,
  CalendarClockIcon,
  CheckIcon,
  MessageCircleIcon,
  PencilIcon,
  SendIcon,
  StickyNoteIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "../../../components/ui/Button";
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
import { daysSince, formatDue, isOverdue, localDateTimeToIso } from "../utils/board";
import { TASK_TYPE_LABEL, describeDealEvent } from "../utils/events";
import { contactLabel } from "./DealCard";
import { FIELD_CLASS, LABEL_CLASS } from "./LeadModal";
import type { OwnerOption } from "./NewDealModal";

type Tab = "activity" | "tasks" | "message";
type TagInfo = { id: string; name: string; color: string | null };

// 2500 -> "2.500,00" (o campo aceita de volta pelo parseMoneyInput)
const moneyInputValue = (value: number | null) =>
  value === null
    ? ""
    : value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

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
}> = ({
  dealId,
  pipelines,
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
  const { deal, loading } = useDeal(dealId);
  const [tab, setTab] = useState<Tab>("tasks");

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
            deal={deal}
            pipeline={pipelines.find((p) => p.id === deal.pipelineId) ?? null}
            lossReasons={lossReasons}
            tags={tags}
            ownerOptions={ownerOptions}
            userNames={userNames}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            clinicId={clinicId}
            tab={tab}
            setTab={setTab}
            onClose={onClose}
            onMove={onMove}
          />
        )}
      </aside>
    </div>
  );
};

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
  tab: Tab;
  setTab: (tab: Tab) => void;
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
  tab,
  setTab,
  onClose,
  onMove,
}) => {
  const confirm = useConfirm();
  const openConversation = useOpenConversation();
  const actions = useLeadActions();
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(deal.title);
  const [value, setValue] = useState(moneyInputValue(deal.value));

  useEffect(() => {
    setTitle(deal.title);
    setValue(moneyInputValue(deal.value));
  }, [deal.id, deal.title, deal.value]);

  const stage = pipeline?.stages.find((s) => s.id === deal.stageId) ?? null;
  const lostReason = lossReasons.find((r) => r.id === deal.lostReasonId);

  // Responsável atual que não está nas opções (ex.: atendente vendo cartão de
  // outro após o admin passar para ele) continua aparecendo
  const owners = useMemo(() => {
    if (!deal.ownerUserId || ownerOptions.some((o) => o.id === deal.ownerUserId)) return ownerOptions;
    return [...ownerOptions, { id: deal.ownerUserId, label: userNames[deal.ownerUserId] ?? "Atendente" }];
  }, [ownerOptions, deal.ownerUserId, userNames]);

  const save = async (patch: Parameters<typeof actions.updateDeal>[0]["patch"], ok?: string) => {
    try {
      await actions.updateDeal({ id: deal.id, patch });
      if (ok) toast.success(ok);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar.");
    }
  };

  const saveTitle = async () => {
    setEditingTitle(false);
    if (!title.trim() || title.trim() === deal.title) {
      setTitle(deal.title);
      return;
    }
    await save({ title });
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
    const next = deal.tagIds.includes(tagId)
      ? deal.tagIds.filter((id) => id !== tagId)
      : [...deal.tagIds, tagId];
    try {
      await actions.setTags({ dealId: deal.id, current: deal.tagIds, next });
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar as etiquetas.");
    }
  };

  const openChat = async () => {
    try {
      const conversationId = deal.sourceConversationId ?? (await findLatestConversation(deal.contact.id));
      if (!conversationId) {
        toast.info("Este cliente ainda não tem conversa. Use a aba Mensagem para falar com ele.");
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

  return (
    <>
      {/* Cabeçalho */}
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
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
                className={`${FIELD_CLASS} text-base font-semibold`}
                aria-label="Título da negociação"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                className="group flex max-w-full items-center gap-2 text-left"
              >
                <h2 className="text-lg font-semibold text-slate-900 [overflow-wrap:anywhere]">{deal.title}</h2>
                <PencilIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 group-hover:text-slate-500" />
              </button>
            )}
            <p className="mt-0.5 truncate text-sm text-slate-500">
              {contactLabel(deal.contact)}
              {deal.contact.phone ? ` · ${formatPhone(deal.contact.phone)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border p-2 text-slate-500 hover:text-slate-700"
            aria-label="Fechar"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={openChat} className="border border-slate-200">
            <span className="flex items-center gap-1.5">
              <MessageCircleIcon className="h-4 w-4" />
              Abrir conversa
            </span>
          </Button>
          {stage?.kind === "open" && pipeline && (
            <>
              {pipeline.stages
                .filter((s) => s.kind !== "open")
                .map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onMove(deal, s)}
                    className={`border ${s.kind === "won" ? "border-green-200 text-green-700" : "border-red-200 text-red-600"}`}
                  >
                    {s.kind === "won" ? "Ganhou" : "Perdeu"}
                  </Button>
                ))}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Etapas */}
        {pipeline && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Etapa · {pipeline.name}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pipeline.stages.map((s) => {
                const current = s.id === deal.stageId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={current}
                    onClick={() => onMove(deal, s)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      current ? "border-transparent text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                    style={current ? { backgroundColor: s.color } : undefined}
                  >
                    {!current && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />}
                    {s.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {deal.status === "open"
                ? `Nesta etapa há ${daysSince(deal.stageEnteredAt) === 0 ? "menos de 1 dia" : `${daysSince(deal.stageEnteredAt)} dia(s)`}.`
                : deal.status === "won"
                  ? `Ganha em ${shortDateTime(deal.closedAt ?? deal.updatedAt)}.`
                  : `Perdida em ${shortDateTime(deal.closedAt ?? deal.updatedAt)}${lostReason ? `: ${lostReason.name}` : ""}${deal.lostNote ? ` (${deal.lostNote})` : ""}.`}
            </p>
          </div>
        )}

        {/* Dados */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <p className={LABEL_CLASS}>Etiquetas</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const active = deal.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      active ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color ?? "#94a3b8" }} />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Abas */}
        <div className="mt-6 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
          {(
            [
              ["tasks", "Tarefas"],
              ["message", "Mensagem"],
              ["activity", "Histórico"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-lg px-2 py-1.5 transition ${
                tab === key ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === "tasks" && (
            <TasksTab deal={deal} ownerOptions={owners} userNames={userNames} />
          )}
          {tab === "message" && <MessageTab deal={deal} clinicId={clinicId} />}
          {tab === "activity" && (
            <ActivityTab deal={deal} userNames={userNames} currentUserId={currentUserId} />
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
        <span>
          Criada em {shortDateTime(deal.createdAt)}
          {deal.createdBy && userNames[deal.createdBy] ? ` por ${userNames[deal.createdBy]}` : ""}
        </span>
        {isAdmin && (
          <button
            type="button"
            onClick={remove}
            className="inline-flex items-center gap-1 font-medium text-red-600 hover:underline"
          >
            <Trash2Icon className="h-3.5 w-3.5" />
            Excluir
          </button>
        )}
      </div>
    </>
  );
};

/* ------------------------------- Tarefas -------------------------------- */

const TasksTab: React.FC<{
  deal: Deal;
  ownerOptions: OwnerOption[];
  userNames: Record<string, string>;
}> = ({ deal, ownerOptions, userNames }) => {
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
      toast.success("Tarefa criada. O lembrete chega no horário.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível criar a tarefa.");
    }
  };

  return (
    <div>
      <form onSubmit={add} className="space-y-2 rounded-xl border border-slate-200 p-3">
        <input
          type="text"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ex.: Ligar para confirmar a proposta"
          className={FIELD_CLASS}
          aria-label="Nova tarefa"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select
            value={taskType}
            onChange={(event) => setTaskType(event.target.value as TaskType)}
            className={FIELD_CLASS}
            aria-label="Tipo"
          >
            {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((key) => (
              <option key={key} value={key}>
                {TASK_TYPE_LABEL[key]}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={FIELD_CLASS}
            aria-label="Data"
          />
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={FIELD_CLASS}
            aria-label="Hora"
          />
          <select
            value={assigned ?? ""}
            onChange={(event) => setAssigned(event.target.value || null)}
            className={FIELD_CLASS}
            aria-label="Quem recebe o lembrete"
          >
            <option value="">Responsável da negociação</option>
            {ownerOptions
              .filter((o) => o.id)
              .map((o) => (
                <option key={o.id} value={o.id as string}>
                  {o.label}
                </option>
              ))}
          </select>
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" className="rounded-full">
            Adicionar tarefa
          </Button>
        </div>
      </form>

      <ul className="mt-3 divide-y divide-slate-100">
        {isLoading && <li className="py-3 text-sm text-slate-400">Carregando...</li>}
        {!isLoading && open.length === 0 && (
          <li className="py-3 text-sm text-slate-400">Nenhuma tarefa pendente.</li>
        )}
        {open.map((task) => {
          const overdue = isOverdue(task.dueAt);
          return (
            <li key={task.id} className="flex items-start gap-3 py-2.5">
              <button
                type="button"
                onClick={() => actions.toggleTask({ taskId: task.id, done: true })}
                className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-slate-300 text-transparent hover:border-green-500 hover:text-green-500"
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
                className="rounded p-1 text-slate-300 hover:text-red-600"
                aria-label={`Excluir tarefa: ${task.title}`}
              >
                <Trash2Icon className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>

      {done.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="text-xs font-medium text-slate-500 hover:text-slate-800"
          >
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

/* ------------------------- Mensagem agendada ---------------------------- */

const MessageTab: React.FC<{ deal: Deal; clinicId: string | null }> = ({ deal, clinicId }) => {
  const actions = useLeadActions();
  const messages = useDealMessages(deal.id);
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
      toast.success(sendNow ? "Mensagem a caminho (sai em até 1 minuto)." : "Mensagem agendada.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível agendar.");
    }
  };

  if (!deal.contact.phone) {
    return (
      <p className="text-sm text-slate-500">
        Este cliente não tem telefone de WhatsApp na carteira. Fale com ele pela conversa.
      </p>
    );
  }

  return (
    <div>
      <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 p-3">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="Ex.: Oi {nome}! Passando para saber se ficou alguma dúvida sobre a proposta."
          className={`${FIELD_CLASS} resize-none`}
          aria-label="Mensagem"
        />
        <p className="text-xs text-slate-500">
          Sai pelo WhatsApp (QR Code), só para {contactLabel(deal.contact)}. Use{" "}
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
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className={FIELD_CLASS}
              aria-label="Hora do envio"
            />
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
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={actions.scheduling} className="rounded-full">
            {actions.scheduling ? "Salvando..." : sendNow ? "Enviar" : "Agendar mensagem"}
          </Button>
        </div>
      </form>

      <ul className="mt-3 divide-y divide-slate-100">
        {messages.length === 0 && (
          <li className="py-3 text-sm text-slate-400">Nenhuma mensagem agendada por este cartão.</li>
        )}
        {messages.map((m) => (
          <li key={m.id} className="py-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-500">{formatScheduleDateTime(m.scheduledAt)}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                {MESSAGE_STATUS_LABEL[m.status]}
              </span>
            </div>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-slate-700">{m.message}</p>
            {m.recipientError && <p className="mt-1 text-xs text-red-600">{m.recipientError}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
};

/* ------------------------------ Histórico ------------------------------- */

const ActivityTab: React.FC<{
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
    <div>
      <form onSubmit={add} className="flex items-start gap-2">
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Escreva uma nota (só a equipe vê)"
          className={`${FIELD_CLASS} resize-none`}
          aria-label="Nova nota"
        />
        <Button type="submit" size="sm" disabled={!note.trim()} className="rounded-full">
          Salvar
        </Button>
      </form>

      <ol className="mt-4 space-y-3">
        {isLoading && <li className="text-sm text-slate-400">Carregando...</li>}
        {events.map((event) => {
          const who = event.userId ? userNames[event.userId] ?? "Atendente" : "Sistema";
          const isNote = event.type === "note";
          return (
            <li key={event.id} className="flex gap-3">
              <span
                className={`mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
                  isNote ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {isNote ? <StickyNoteIcon className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800">
                  {isNote ? (
                    <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{event.note}</span>
                  ) : (
                    describeDealEvent(event, userNames)
                  )}
                </p>
                {!isNote && event.note && (
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-500 [overflow-wrap:anywhere]">“{event.note}”</p>
                )}
                <p className="mt-0.5 text-xs text-slate-400">
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
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
