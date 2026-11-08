import React from "react";
import { CheckIcon, CircleAlertIcon, ClockIcon, Trash2Icon } from "lucide-react";
import type { MetaTemplate, MetaTemplateStatus } from "../types/scheduledMessages";
import { TEMPLATE_CATEGORY_LABEL, TEMPLATE_STATUS } from "../utils/templates";
import { formatScheduleDateTime } from "../utils/schedule";

export const TemplateStatusBadge: React.FC<{ status: MetaTemplateStatus }> = ({ status }) => {
  const info = TEMPLATE_STATUS[status];
  const Icon = status === "approved" ? CheckIcon : status === "pending" || status === "submitted" ? ClockIcon : CircleAlertIcon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${info.tone}`}>
      <Icon className="h-3 w-3" />
      {info.label}
    </span>
  );
};

/**
 * Um modelo da Meta. Com `onSelect`, vira opção clicável (só os aprovados);
 * com `onDelete`, mostra a lixeira.
 */
export const TemplateCard: React.FC<{
  template: MetaTemplate;
  selected?: boolean;
  onSelect?: () => void;
  onDelete?: () => void;
}> = ({ template, selected = false, onSelect, onDelete }) => {
  const usable = TEMPLATE_STATUS[template.status].usable;
  const selectable = Boolean(onSelect) && usable;
  const pending = template.status === "pending" || template.status === "submitted";

  const content = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {onSelect && (
            <span
              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"
              }`}
              aria-hidden="true"
            >
              {selected && <CheckIcon className="h-3 w-3" />}
            </span>
          )}
          <span className="truncate text-sm font-semibold text-slate-900">{template.name}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{TEMPLATE_CATEGORY_LABEL[template.category]}</span>
          <TemplateStatusBadge status={template.status} />
        </span>
      </div>
      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{template.body}</p>
      {template.buttons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {template.buttons.map((label) => (
            <span key={label} className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-sky-700">
              {label}
            </span>
          ))}
        </div>
      )}
      {template.status === "rejected" && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          {template.rejectionReason ?? "A Meta recusou o modelo."} Crie outro modelo com o texto ajustado.
        </p>
      )}
      {pending && (
        <p className="mt-2 text-xs text-amber-700">
          Aguardando a Meta. Assim que for aprovado, ele pode ser usado nas campanhas.
        </p>
      )}
      {template.status === "paused" && (
        <p className="mt-2 text-xs text-orange-700">
          A Meta pausou o modelo por reclamações dos clientes. Use outro modelo por enquanto.
        </p>
      )}
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={selectable ? onSelect : undefined}
        disabled={!selectable}
        aria-pressed={selected}
        className={`w-full rounded-xl border p-4 text-left transition disabled:cursor-not-allowed ${
          selected
            ? "border-blue-500 bg-blue-50/60 ring-4 ring-blue-100"
            : selectable
              ? "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
              : "border-slate-200 bg-slate-50/60 opacity-80"
        }`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {content}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-400">Criado em {formatScheduleDateTime(template.createdAt)}</span>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600"
          >
            <Trash2Icon className="h-3.5 w-3.5" />
            Apagar
          </button>
        )}
      </div>
    </div>
  );
};
