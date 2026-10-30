import React from "react";
import { AlarmClockIcon, HourglassIcon, MegaphoneIcon, MessageCircleIcon } from "lucide-react";
import type { Deal } from "../types/leads";
import { ContactAvatar } from "./ContactAvatar";
import {
  daysSince,
  formatCompactCurrency,
  formatDue,
  initials,
  isOverdue,
  isStalled,
  nextOpenTask,
} from "../utils/board";
import { formatPhone } from "../../scheduledMessages/utils/schedule";

type TagInfo = { id: string; name: string; color: string | null };

export const contactLabel = (contact: Deal["contact"]) => {
  const name = contact.name?.trim() ?? "";
  return /\p{L}/u.test(name) ? name : formatPhone(contact.phone) || "Cliente";
};

export const DealCard: React.FC<{
  deal: Deal;
  ownerName: string | null;
  tags: TagInfo[];
  onOpen: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  dragging: boolean;
}> = ({ deal, ownerName, tags, onOpen, onDragStart, onDragEnd, dragging }) => {
  const task = nextOpenTask(deal.tasks);
  const overdue = task ? isOverdue(task.dueAt) : false;
  const stalled = isStalled(deal);
  const days = daysSince(deal.stageEnteredAt);
  const dealTags = tags.filter((t) => deal.tagIds.includes(t.id));

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      data-deal-id={deal.id}
      className={`group cursor-grab rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-blue-200 hover:shadow active:cursor-grabbing ${
        dragging ? "opacity-40" : ""
      } ${stalled ? "border-amber-200" : "border-slate-200"}`}
    >
      <div className="flex items-start gap-2.5">
        <ContactAvatar contact={deal.contact} label={contactLabel(deal.contact)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-sm font-semibold leading-5 text-slate-900 [overflow-wrap:anywhere]">
              {deal.title}
            </p>
            {deal.value !== null && (
              <span className="flex-shrink-0 text-xs font-semibold leading-5 text-green-700">
                {formatCompactCurrency(deal.value)}
              </span>
            )}
          </div>

          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">
            {deal.source === "campaign" ? (
              <MegaphoneIcon className="h-3 w-3 flex-shrink-0 text-violet-500" aria-label="Veio de campanha" />
            ) : deal.source === "conversation" ? (
              <MessageCircleIcon className="h-3 w-3 flex-shrink-0 text-slate-400" aria-label="Veio de conversa" />
            ) : null}
            <span className="truncate">{contactLabel(deal.contact)}</span>
          </p>
        </div>
      </div>

      {dealTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {dealTags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
            >
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: tag.color ?? "#94a3b8" }}
              />
              {tag.name}
            </span>
          ))}
          {dealTags.length > 3 && (
            <span className="text-[11px] text-slate-400">+{dealTags.length - 3}</span>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {task && (
            <span
              className={`inline-flex items-center gap-1 truncate ${
                overdue ? "font-semibold text-red-600" : "text-slate-500"
              }`}
              title={task.title}
            >
              <AlarmClockIcon className="h-3 w-3 flex-shrink-0" />
              {formatDue(task.dueAt)}
            </span>
          )}
          {deal.status === "open" && (
            <span
              className={`inline-flex items-center gap-1 ${
                stalled ? "font-semibold text-amber-700" : "text-slate-400"
              }`}
              title="Tempo nesta etapa"
            >
              <HourglassIcon className="h-3 w-3" />
              {days === 0 ? "hoje" : `${days}d`}
            </span>
          )}
        </div>
        <span
          className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
            ownerName ? "bg-blue-100 text-blue-700" : "border border-dashed border-slate-300 text-slate-400"
          }`}
          title={ownerName ? `Responsável: ${ownerName}` : "Sem responsável"}
        >
          {ownerName ? initials(ownerName) : "–"}
        </span>
      </div>
    </div>
  );
};
