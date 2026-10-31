import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FlagIcon,
  MessageSquareIcon,
  PlusIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  BOT_MENU_MAX_OPTIONS,
  BOT_OPTION_LABEL_MAX_LENGTH,
  type DepartmentRow,
  type TagRow,
} from "../../types/bots";
import {
  FLOW_ACTIONS,
  getOptionWarning,
  type FlowAction,
  type FlowOption,
  type FlowStage,
} from "./flowModel";

const ACTION_ICONS: Record<Exclude<FlowAction, "">, typeof ArrowRightIcon> = {
  stage: ArrowRightIcon,
  human: UserIcon,
  message: MessageSquareIcon,
  end: FlagIcon,
};

const fieldLabel = "mb-1.5 block text-xs font-semibold text-slate-500";
const inputClass =
  "w-full rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-[3px] focus:ring-blue-500/20 disabled:bg-slate-50";

type Lookups = {
  stages: FlowStage[];
  departments: DepartmentRow[];
  tags: TagRow[];
};

const summaryOf = (o: FlowOption, lookups: Lookups) => {
  const warning = getOptionWarning(o);
  let text: string;
  if (warning && o.action) {
    text = warning;
  } else if (o.action === "stage") {
    const target = lookups.stages.find((s) => s.id === o.target);
    text = `Abre a etapa “${target?.name || "sem nome"}”`;
  } else if (o.action === "human") {
    const dept = lookups.departments.find((d) => d.id === o.departmentId);
    text = dept
      ? `Passa para atendente · ${dept.name}`
      : "Passa para qualquer atendente";
  } else if (o.action === "message") {
    text = o.reply.trim()
      ? "Responde e mostra os botões de novo"
      : "Mostra os botões de novo";
  } else if (o.action === "end") {
    text = "Encerra a conversa";
  } else {
    text = "Escolha o que acontece ao tocar";
  }
  const tag = o.tagId ? lookups.tags.find((t) => t.id === o.tagId) : null;
  if (tag) text += ` · etiqueta ${tag.name ?? ""}`;
  return { text, warning };
};

type RowProps = {
  option: FlowOption;
  index: number;
  count: number;
  open: boolean;
  tagOpen: boolean;
  disabled: boolean;
  currentStageId: string;
  lookups: Lookups;
  onToggle: () => void;
  onChange: (patch: Partial<FlowOption>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onCreateStage: () => void;
  onOpenStage: (stageId: string) => void;
  onOpenTag: () => void;
};

const OptionRow = ({
  option: o,
  index,
  count,
  open,
  tagOpen,
  disabled,
  currentStageId,
  lookups,
  onToggle,
  onChange,
  onMove,
  onRemove,
  onCreateStage,
  onOpenStage,
  onOpenTag,
}: RowProps) => {
  const { text, warning } = summaryOf(o, lookups);
  const labelLength = o.label.trim().length;
  const tooLong = labelLength > BOT_OPTION_LABEL_MAX_LENGTH;
  const target = lookups.stages.find((s) => s.id === o.target);
  const help =
    FLOW_ACTIONS.find((a) => a.key === o.action)?.help ??
    "Escolha o que acontece quando o cliente tocar.";
  const ids = `opt-${o.id}`;

  let fields: ReactNode = null;
  if (o.action === "stage") {
    fields = (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-target`} className={fieldLabel + " mb-0"}>
          Qual etapa?
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id={`${ids}-target`}
            value={o.target}
            disabled={disabled}
            onChange={(e) => onChange({ target: e.target.value })}
            className={inputClass + " h-10 min-w-[200px] flex-1"}
          >
            <option value="">Escolha uma etapa…</option>
            {lookups.stages
              .filter((s) => s.id !== currentStageId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || "(sem nome)"}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={onCreateStage}
            disabled={disabled}
            className="h-10 px-2 text-[13px] font-semibold text-blue-700 hover:text-blue-900 disabled:opacity-40"
          >
            + Nova etapa
          </button>
        </div>
        {target ? (
          <button
            type="button"
            onClick={() => onOpenStage(target.id)}
            className="self-start text-[13px] text-blue-700 hover:text-blue-900"
          >
            Editar a etapa “{target.name || "sem nome"}” →
          </button>
        ) : null}
      </div>
    );
  } else if (o.action === "human") {
    fields = (
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor={`${ids}-dept`} className={fieldLabel}>
            Setor
          </label>
          <select
            id={`${ids}-dept`}
            value={o.departmentId}
            disabled={disabled}
            onChange={(e) => onChange({ departmentId: e.target.value })}
            className={inputClass + " h-10"}
          >
            <option value="">Qualquer atendente disponível</option>
            {lookups.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-reply`} className={fieldLabel}>
            Aviso antes de transferir · opcional
          </label>
          <textarea
            id={`${ids}-reply`}
            rows={2}
            value={o.reply}
            disabled={disabled}
            onChange={(e) => onChange({ reply: e.target.value })}
            placeholder="Ex.: Certo! Já vou te passar para alguém da equipe."
            className={inputClass + " resize-y py-2"}
          />
        </div>
      </div>
    );
  } else if (o.action === "message") {
    fields = (
      <div>
        <label htmlFor={`${ids}-reply`} className={fieldLabel}>
          {o.tagId ? "Resposta · opcional" : "Resposta"}
        </label>
        <textarea
          id={`${ids}-reply`}
          rows={3}
          value={o.reply}
          disabled={disabled}
          onChange={(e) => onChange({ reply: e.target.value })}
          placeholder="Ex.: Atendemos de segunda a sexta, das 8h às 18h."
          className={inputClass + " resize-y py-2"}
        />
      </div>
    );
  } else if (o.action === "end") {
    fields = (
      <div>
        <label htmlFor={`${ids}-reply`} className={fieldLabel}>
          Despedida · opcional
        </label>
        <textarea
          id={`${ids}-reply`}
          rows={2}
          value={o.reply}
          disabled={disabled}
          onChange={(e) => onChange({ reply: e.target.value })}
          placeholder="Ex.: Obrigado pelo contato! Até logo."
          className={inputClass + " resize-y py-2"}
        />
      </div>
    );
  }

  return (
    <div
      className={[
        index > 0 ? "border-t border-slate-100" : "",
        open ? "bg-slate-50" : "bg-white",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left text-slate-900"
      >
        <span className="w-5 flex-none text-center text-[13px] font-semibold text-slate-400">
          {index + 1}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">
            {o.label.trim() || "Novo botão"}
          </span>
          <span
            className={[
              "truncate text-xs",
              warning ? "text-orange-700" : "text-slate-500",
            ].join(" ")}
          >
            {text}
          </span>
        </span>
        {warning ? (
          <span
            title="Falta completar"
            className="h-2 w-2 flex-none rounded-full bg-orange-600"
          />
        ) : null}
        <ChevronDownIcon
          className={[
            "h-[18px] w-[18px] flex-none text-slate-400 transition",
            open ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>

      {open ? (
        <div className="flex flex-col gap-4 pb-4 pl-[46px] pr-3.5">
          <div>
            <label htmlFor={`${ids}-label`} className={fieldLabel}>
              Texto do botão
            </label>
            <div className="relative">
              <input
                id={`${ids}-label`}
                value={o.label}
                disabled={disabled}
                onChange={(e) => onChange({ label: e.target.value })}
                placeholder="Ex.: Agendar horário"
                className={inputClass + " h-10 pr-14"}
              />
              <span
                className={[
                  "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs",
                  tooLong ? "font-semibold text-orange-700" : "text-slate-500",
                ].join(" ")}
              >
                {labelLength}/{BOT_OPTION_LABEL_MAX_LENGTH}
              </span>
            </div>
            {tooLong ? (
              <div className="mt-1 text-xs text-orange-700">
                No WhatsApp oficial aparecem só os primeiros{" "}
                {BOT_OPTION_LABEL_MAX_LENGTH} caracteres.
              </div>
            ) : null}
          </div>

          <div>
            <div className={fieldLabel}>Ao tocar</div>
            <div className="flex flex-wrap gap-1.5">
              {FLOW_ACTIONS.map((a) => {
                const Icon = ACTION_ICONS[a.key];
                const on = a.key === o.action;
                return (
                  <button
                    key={a.key}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    onClick={() => onChange({ action: a.key })}
                    className={[
                      "flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition disabled:opacity-60",
                      on
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {a.short}
                  </button>
                );
              })}
            </div>
            <div className="mt-1.5 text-xs text-slate-500">{help}</div>
          </div>

          {fields}

          {o.tagId || tagOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor={`${ids}-tag`}
                className="text-xs font-semibold text-slate-500"
              >
                Etiqueta
              </label>
              <select
                id={`${ids}-tag`}
                value={o.tagId}
                disabled={disabled}
                onChange={(e) => onChange({ tagId: e.target.value })}
                className={inputClass + " h-9 w-auto px-2 text-[13px]"}
              >
                <option value="">Nenhuma</option>
                {lookups.tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name ?? "(sem nome)"}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenTag}
              disabled={disabled}
              className="self-start text-[13px] text-blue-700 hover:text-blue-900 disabled:opacity-40"
            >
              + Marcar o cliente com uma etiqueta
            </button>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-0.5">
              <button
                type="button"
                aria-label="Mover para cima"
                title="Mover para cima"
                disabled={disabled || index === 0}
                onClick={() => onMove(-1)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-white disabled:opacity-35"
              >
                <ChevronUpIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Mover para baixo"
                title="Mover para baixo"
                disabled={disabled || index === count - 1}
                onClick={() => onMove(1)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-white disabled:opacity-35"
              >
                <ChevronDownIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Remover botão"
                title="Remover botão"
                disabled={disabled}
                onClick={onRemove}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-red-600 disabled:opacity-35"
              >
                <Trash2Icon className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-900 hover:bg-slate-50"
            >
              Pronto
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const OptionsCard = ({
  options,
  openOptionId,
  tagOpenIds,
  disabled,
  currentStageId,
  lookups,
  onToggle,
  onChange,
  onMove,
  onRemove,
  onAdd,
  onCreateStage,
  onOpenStage,
  onOpenTag,
}: {
  options: FlowOption[];
  openOptionId: string | null;
  tagOpenIds: Set<string>;
  disabled: boolean;
  currentStageId: string;
  lookups: Lookups;
  onToggle: (optionId: string) => void;
  onChange: (optionId: string, patch: Partial<FlowOption>) => void;
  onMove: (optionId: string, dir: -1 | 1) => void;
  onRemove: (optionId: string) => void;
  onAdd: () => void;
  onCreateStage: (optionId: string) => void;
  onOpenStage: (stageId: string) => void;
  onOpenTag: (optionId: string) => void;
}) => {
  const canAdd = options.length < BOT_MENU_MAX_OPTIONS;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-bold text-slate-900">Botões</div>
          <div className="mt-0.5 text-xs text-slate-500">
            O que o cliente pode tocar depois da mensagem
          </div>
        </div>
        <span className="whitespace-nowrap text-xs text-slate-500">
          {options.length}/{BOT_MENU_MAX_OPTIONS}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-100">
        {options.map((o, i) => (
          <OptionRow
            key={o.id}
            option={o}
            index={i}
            count={options.length}
            open={openOptionId === o.id}
            tagOpen={tagOpenIds.has(o.id)}
            disabled={disabled}
            currentStageId={currentStageId}
            lookups={lookups}
            onToggle={() => onToggle(o.id)}
            onChange={(patch) => onChange(o.id, patch)}
            onMove={(dir) => onMove(o.id, dir)}
            onRemove={() => onRemove(o.id)}
            onCreateStage={() => onCreateStage(o.id)}
            onOpenStage={onOpenStage}
            onOpenTag={() => onOpenTag(o.id)}
          />
        ))}

        {canAdd ? (
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            className={[
              "flex w-full items-center gap-3 bg-white px-3.5 py-3 text-left text-sm font-semibold text-blue-700 hover:bg-slate-50 disabled:opacity-40",
              options.length ? "border-t border-slate-100" : "",
            ].join(" ")}
          >
            <span className="flex w-5 flex-none justify-center">
              <PlusIcon className="h-4 w-4" />
            </span>
            Adicionar botão
          </button>
        ) : (
          <div className="border-t border-slate-100 px-3.5 py-3 text-xs text-slate-500">
            Limite de {BOT_MENU_MAX_OPTIONS} botões do WhatsApp. Para mais
            opções, crie outra etapa.
          </div>
        )}
      </div>

      {options.length === 0 ? (
        <div className="text-xs text-slate-500">
          Sem botões, o bot só envia a mensagem e encerra.
        </div>
      ) : null}
    </div>
  );
};
