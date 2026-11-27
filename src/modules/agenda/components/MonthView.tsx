import React from "react";
import { SparklesIcon } from "lucide-react";
import type { AgendaService, Appointment, Professional } from "../types";
import { WEEKDAY_SHORT, formatTime, isActiveStatus, sameDay } from "../utils/calendar";

// Horários que cabem em cada dia antes do "+N"
const MAX_PER_DAY = 3;
// Segunda primeiro
const HEADER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Mês inteiro: cada dia mostra os primeiros horários (hora, cliente e cor do
 * profissional) e quantos faltam. Clicar no dia abre a visão do dia.
 */
export const MonthView: React.FC<{
  days: Date[];
  month: number;
  now: Date;
  appointments: Appointment[];
  professionalById: Map<string, Professional>;
  serviceById: Map<string, AgendaService>;
  onOpenDay: (day: Date) => void;
  onOpenAppointment: (appointment: Appointment) => void;
}> = ({ days, month, now, appointments, professionalById, serviceById, onOpenDay, onOpenAppointment }) => {
  const weeks = days.length / 7;

  return (
    <div className="flex min-h-[560px] flex-1 flex-col bg-white">
      <div className="grid grid-cols-7 border-b border-slate-200">
        {HEADER.map((weekday) => (
          <span key={weekday} className="py-2 text-center text-xs font-medium text-slate-500">
            {WEEKDAY_SHORT[weekday]}
          </span>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(96px, 1fr))` }}>
        {days.map((day) => {
          const list = appointments
            .filter((a) => sameDay(new Date(a.startsAt), day))
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          const active = list.filter((a) => isActiveStatus(a.status)).length;
          const outside = day.getMonth() !== month;
          const today = sameDay(day, now);
          const shown = list.slice(0, MAX_PER_DAY);
          const hidden = list.length - shown.length;
          return (
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={0}
              onClick={() => onOpenDay(day)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenDay(day);
                }
              }}
              aria-label={`${day.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}: ${active} ${
                active === 1 ? "horário" : "horários"
              }`}
              className={`flex min-w-0 cursor-pointer flex-col gap-0.5 border-b border-r border-slate-100 p-1 text-left transition hover:bg-slate-50 sm:p-1.5 ${
                outside ? "bg-slate-50/60" : ""
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center self-end rounded-full text-xs font-semibold ${
                  today ? "bg-blue-600 text-white" : outside ? "text-slate-400" : "text-slate-700"
                }`}
              >
                {day.getDate()}
              </span>
              {shown.map((appointment) => {
                const professional = professionalById.get(appointment.professionalId);
                const service = appointment.serviceId ? serviceById.get(appointment.serviceId) : null;
                const color = professional?.color ?? "#64748b";
                const faded = !isActiveStatus(appointment.status);
                return (
                  <button
                    key={appointment.id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenAppointment(appointment);
                    }}
                    title={`${formatTime(appointment.startsAt)} ${appointment.contactName ?? ""} · ${
                      service?.name ?? "Atendimento"
                    } · ${professional?.name ?? ""}`}
                    className={`flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight text-slate-700 hover:bg-slate-100 ${
                      faded ? "opacity-50" : ""
                    }`}
                  >
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="hidden flex-shrink-0 font-medium sm:inline">{formatTime(appointment.startsAt)}</span>
                    <span className={`truncate ${appointment.status === "cancelled" ? "line-through" : ""}`}>
                      {appointment.contactName || appointment.contactPhone || "Cliente"}
                    </span>
                    {appointment.source === "ai" && (
                      <SparklesIcon className="hidden h-3 w-3 flex-shrink-0 text-violet-600 sm:inline" />
                    )}
                  </button>
                );
              })}
              {hidden > 0 && (
                <span className="px-1 text-[11px] font-medium text-blue-600">+{hidden} mais</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
