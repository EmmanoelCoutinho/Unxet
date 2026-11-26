import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  EyeIcon,
  EyeOffIcon,
  ChevronRightIcon,
  PlusIcon,
  Settings2Icon,
  SparklesIcon,
} from "lucide-react";
import { useClinic } from "../contexts/ClinicContext";
import { Button } from "../components/ui/Button";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { AppointmentModal } from "../modules/agenda/components/AppointmentModal";
import { MonthView } from "../modules/agenda/components/MonthView";
import { useAgendaServices, useAppointments, useProfessionals, useTimeOff } from "../modules/agenda/hooks/useAgenda";
import type { Appointment, Professional } from "../modules/agenda/types";
import {
  STATUS_LABEL,
  WEEKDAY_SHORT,
  addDays,
  addMonths,
  formatMonthLabel,
  formatRangeLabel,
  formatTime,
  isActiveStatus,
  isOutsideHours,
  layoutDay,
  minutesOfDay,
  monthGrid,
  sameDay,
  startOfDay,
  startOfWeek,
  visibleHours,
} from "../modules/agenda/utils/calendar";

export const AGENDA_PATH = "/inbox/agenda";
const VIEW_STORAGE_KEY = "unxet:agenda:view";
const HOUR_HEIGHT = 56;
// Clique na grade arredonda para esse passo
const CLICK_STEP_MINUTES = 30;

type View = "day" | "week" | "month";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
];

const readStoredView = (): View => {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "day" || stored === "week" || stored === "month") return stored;
  } catch {
    // sem armazenamento: usa o padrão
  }
  return typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "week";
};

type ModalState =
  | { mode: "new"; start: Date | null; professionalId: string | null }
  | { mode: "edit"; appointment: Appointment }
  | null;

export const AgendaPage: React.FC = () => {
  const { clinicId, can } = useClinic();
  const canManage = can("agenda.manage");

  const [view, setView] = useState<View>(readStoredView);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  // Vazio = todos os profissionais
  const [selected, setSelected] = useState<string[]>([]);
  const [showCancelled, setShowCancelled] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // sem armazenamento: só não lembra a visão
    }
  }, [view]);

  // Linha do "agora" anda sozinha
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const days = useMemo(() => {
    if (view === "month") return monthGrid(anchor);
    const first = view === "week" ? startOfWeek(anchor) : anchor;
    return Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => addDays(first, i));
  }, [anchor, view]);
  // No mês a grade tem 35 ou 42 dias; a grade de horas usa só os da semana/dia
  const gridDays = view === "month" ? [] : days;
  const rangeStart = days[0];
  const rangeEnd = addDays(days[days.length - 1], 1);

  const { professionals, loading: loadingProfessionals } = useProfessionals(clinicId);
  const { services } = useAgendaServices(clinicId);
  const { appointments, loading: loadingAppointments } = useAppointments(clinicId, rangeStart, rangeEnd);
  const { timeOff } = useTimeOff(clinicId, rangeStart, rangeEnd);

  const professionalById = useMemo(() => new Map(professionals.map((p) => [p.id, p])), [professionals]);
  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const activeProfessionals = professionals.filter((p) => p.active);

  // Filtro guardado só com quem ainda existe
  const filter = selected.filter((id) => professionalById.has(id));
  const visibleProfessional = (id: string) => filter.length === 0 || filter.includes(id);
  const singleProfessional: Professional | null =
    filter.length === 1 ? professionalById.get(filter[0]) ?? null : activeProfessionals.length === 1 ? activeProfessionals[0] : null;

  const visibleAppointments = appointments.filter(
    (a) => visibleProfessional(a.professionalId) && (showCancelled || a.status !== "cancelled"),
  );
  const visibleTimeOff = singleProfessional ? timeOff.filter((t) => t.professionalId === singleProfessional.id) : [];

  const hoursForRange = (filter.length > 0
    ? activeProfessionals.filter((p) => filter.includes(p.id))
    : activeProfessionals
  ).flatMap((p) => p.hours);
  const { from: dayFrom, to: dayTo } = visibleHours(hoursForRange, visibleAppointments, gridDays);
  const gridHeight = ((dayTo - dayFrom) / 60) * HOUR_HEIGHT;
  const hourMarks = Array.from({ length: (dayTo - dayFrom) / 60 }, (_, i) => dayFrom + i * 60);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Começa a grade perto da hora atual
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const minute = minutesOfDay(new Date());
    if (minute > dayFrom && minute < dayTo) {
      el.scrollTop = Math.max(0, ((minute - dayFrom) / 60 - 1) * HOUR_HEIGHT);
    }
    // só na troca de período
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart.getTime()]);

  const move = (direction: -1 | 1) =>
    setAnchor((current) =>
      view === "month" ? addMonths(current, direction) : addDays(current, direction * (view === "week" ? 7 : 1)),
    );
  const periodName = view === "month" ? "mês" : view === "week" ? "semana" : "dia";

  const toggleProfessional = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const openNewAt = (day: Date, event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const minute = dayFrom + Math.floor(((y / HOUR_HEIGHT) * 60) / CLICK_STEP_MINUTES) * CLICK_STEP_MINUTES;
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minute / 60), minute % 60);
    setModal({ mode: "new", start, professionalId: singleProfessional?.id ?? null });
  };

  const counts = useMemo(() => {
    const active = appointments.filter((a) => isActiveStatus(a.status) && visibleProfessional(a.professionalId));
    return { total: active.length, ai: active.filter((a) => a.source === "ai").length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, filter.join(",")]);

  const ready = !loadingProfessionals;
  const empty = ready && activeProfessionals.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="border-b bg-white px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <PreTitleIcon icon={CalendarDaysIcon} />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Agenda</h1>
              <p className="mt-1 text-sm text-gray-500">
                {counts.total} {counts.total === 1 ? "horário marcado" : "horários marcados"} neste {periodName}
                {counts.ai > 0 ? ` · ${counts.ai} pela IA` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <Link
                to={`${AGENDA_PATH}/settings`}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Settings2Icon className="h-4 w-4" />
                <span className="hidden sm:inline">Profissionais e serviços</span>
              </Link>
            )}
            <Button
              type="button"
              disabled={empty}
              onClick={() => setModal({ mode: "new", start: null, professionalId: singleProfessional?.id ?? null })}
              className="rounded-full"
            >
              <span className="flex items-center gap-2">
                <PlusIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Novo agendamento</span>
                <span className="sm:hidden">Novo</span>
              </span>
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => move(-1)}
              className="rounded-full border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-50"
              aria-label={view === "month" ? "Mês anterior" : view === "week" ? "Semana anterior" : "Dia anterior"}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setAnchor(startOfDay(new Date()))}
              className="rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              className="rounded-full border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-50"
              aria-label={view === "month" ? "Próximo mês" : view === "week" ? "Próxima semana" : "Próximo dia"}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
          <span className="text-sm font-semibold text-slate-800">{view === "month" ? formatMonthLabel(anchor) : formatRangeLabel(days[0], days.length)}</span>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCancelled((value) => !value)}
              aria-pressed={showCancelled}
              title={showCancelled ? "Esconder os horários cancelados" : "Mostrar os horários cancelados"}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                showCancelled
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {showCancelled ? <EyeIcon className="h-3.5 w-3.5" /> : <EyeOffIcon className="h-3.5 w-3.5" />}
              Cancelados
            </button>
            <div className="flex rounded-full border border-slate-200 bg-white p-0.5" role="group" aria-label="Visão">
              {VIEW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setView(option.value)}
                  aria-pressed={view === option.value}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    view === option.value ? "bg-blue-600 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeProfessionals.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Profissionais">
            <button
              type="button"
              onClick={() => setSelected([])}
              aria-pressed={filter.length === 0}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                filter.length === 0
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              Todos
            </button>
            {activeProfessionals.map((p) => {
              const on = filter.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProfessional(p.id)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                    on ? "border-slate-300 bg-slate-100 text-slate-900" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {empty ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <CalendarDaysIcon className="mx-auto h-10 w-10 text-blue-500" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900">Monte a agenda da empresa</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Cadastre os profissionais, os horários de trabalho e os serviços com a duração de cada um. Depois é só
              marcar por aqui, ou deixar a IA marcar pelo WhatsApp.
            </p>
            {canManage ? (
              <Link
                to={`${AGENDA_PATH}/settings`}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                <Settings2Icon className="h-4 w-4" />
                Cadastrar profissionais
              </Link>
            ) : (
              <p className="mt-4 text-xs text-slate-500">Peça a um administrador para cadastrar os profissionais.</p>
            )}
          </div>
        </div>
      ) : view === "month" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <MonthView
            days={days}
            month={anchor.getMonth()}
            now={now}
            appointments={visibleAppointments}
            professionalById={professionalById}
            serviceById={serviceById}
            onOpenDay={(day) => {
              setAnchor(day);
              setView("day");
            }}
            onOpenAppointment={(appointment) => setModal({ mode: "edit", appointment })}
          />
          {loadingAppointments && <p className="py-3 text-center text-xs text-slate-400">Carregando agenda...</p>}
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <div className={view === "week" ? "min-w-[760px]" : ""}>
            {/* Cabeçalho dos dias */}
            <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-white">
              <div className="w-14 flex-shrink-0" />
              {days.map((day) => {
                const today = sameDay(day, now);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => {
                      setAnchor(day);
                      setView("day");
                    }}
                    className="flex-1 border-l border-slate-100 px-2 py-2 text-center transition hover:bg-slate-50"
                    title="Ver o dia"
                  >
                    <span className={`block text-xs font-medium ${today ? "text-blue-600" : "text-slate-500"}`}>
                      {WEEKDAY_SHORT[day.getDay()]}
                    </span>
                    <span
                      className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                        today ? "bg-blue-600 text-white" : "text-slate-800"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative flex bg-white" style={{ height: gridHeight }}>
              {/* Horas */}
              <div className="relative w-14 flex-shrink-0">
                {hourMarks.map((minute) => (
                  <span
                    key={minute}
                    className={`absolute right-2 text-[11px] text-slate-400 ${
                      minute > dayFrom ? "-translate-y-1/2" : "translate-y-0.5"
                    }`}
                    style={{ top: ((minute - dayFrom) / 60) * HOUR_HEIGHT }}
                  >
                    {`${String(minute / 60).padStart(2, "0")}:00`}
                  </span>
                ))}
              </div>

              {days.map((day) => {
                const dayAppointments = visibleAppointments.filter((a) => sameDay(new Date(a.startsAt), day));
                const placed = layoutDay(dayAppointments);
                const dayStart = day.getTime();
                const dayEnd = addDays(day, 1).getTime();
                const nowMinute = minutesOfDay(now);
                return (
                  <div
                    key={day.toISOString()}
                    className="relative flex-1 cursor-pointer border-l border-slate-100"
                    onClick={(event) => {
                      if (event.target === event.currentTarget) openNewAt(day, event);
                    }}
                    role="presentation"
                  >
                    {/* Linhas das horas e fora do expediente (com um profissional só) */}
                    {hourMarks.map((minute) => (
                      <React.Fragment key={minute}>
                        {singleProfessional &&
                          [0, 30].map((offset) =>
                            isOutsideHours(singleProfessional.hours, day.getDay(), minute + offset) ? (
                              <div
                                key={offset}
                                className="pointer-events-none absolute inset-x-0 bg-slate-100/70"
                                style={{
                                  top: ((minute + offset - dayFrom) / 60) * HOUR_HEIGHT,
                                  height: HOUR_HEIGHT / 2,
                                }}
                              />
                            ) : null,
                          )}
                        <div
                          className="pointer-events-none absolute inset-x-0 border-t border-slate-100"
                          style={{ top: ((minute - dayFrom) / 60) * HOUR_HEIGHT }}
                        />
                      </React.Fragment>
                    ))}

                    {visibleTimeOff
                      .filter((t) => new Date(t.startsAt).getTime() < dayEnd && new Date(t.endsAt).getTime() > dayStart)
                      .map((t) => {
                        const s = Math.max(new Date(t.startsAt).getTime(), dayStart);
                        const e = Math.min(new Date(t.endsAt).getTime(), dayEnd);
                        const top = Math.max(0, (((s - dayStart) / 60000 - dayFrom) / 60) * HOUR_HEIGHT);
                        const bottom = Math.min(gridHeight, (((e - dayStart) / 60000 - dayFrom) / 60) * HOUR_HEIGHT);
                        if (bottom <= top) return null;
                        return (
                          <div
                            key={t.id}
                            className="pointer-events-none absolute inset-x-0.5 rounded-md border border-dashed border-slate-300 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(148,163,184,0.18)_6px,rgba(148,163,184,0.18)_12px)] px-1.5 py-1 text-[11px] text-slate-500"
                            style={{ top, height: bottom - top }}
                          >
                            {t.reason || "Indisponível"}
                          </div>
                        );
                      })}

                    {sameDay(day, now) && nowMinute >= dayFrom && nowMinute <= dayTo && (
                      <div
                        className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                        style={{ top: ((nowMinute - dayFrom) / 60) * HOUR_HEIGHT }}
                      >
                        <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-red-500" />
                      </div>
                    )}

                    {placed.map(({ appointment, column, columns }) => {
                      const start = new Date(appointment.startsAt);
                      const end = new Date(appointment.endsAt);
                      const startMin = minutesOfDay(start);
                      const endMin = sameDay(start, end) ? minutesOfDay(end) : 24 * 60;
                      const top = ((startMin - dayFrom) / 60) * HOUR_HEIGHT;
                      const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2);
                      const professional = professionalById.get(appointment.professionalId);
                      const color = professional?.color ?? "#64748b";
                      const service = appointment.serviceId ? serviceById.get(appointment.serviceId) : null;
                      const faded = !isActiveStatus(appointment.status);
                      const compact = height < 40;
                      return (
                        <button
                          key={appointment.id}
                          type="button"
                          onClick={() => setModal({ mode: "edit", appointment })}
                          className={`absolute z-[5] overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm transition hover:z-[6] hover:shadow-md ${
                            faded ? "opacity-60" : ""
                          }`}
                          style={{
                            top,
                            height,
                            left: `calc(${(column / columns) * 100}% + 2px)`,
                            width: `calc(${100 / columns}% - 4px)`,
                            borderLeftColor: color,
                            backgroundColor: `${color}1f`,
                          }}
                          title={`${formatTime(appointment.startsAt)} ${appointment.contactName ?? ""} · ${
                            service?.name ?? "Atendimento"
                          } · ${professional?.name ?? ""} · ${STATUS_LABEL[appointment.status]}`}
                        >
                          <span
                            className={`flex items-center gap-1 font-semibold text-slate-900 ${
                              appointment.status === "cancelled" ? "line-through" : ""
                            }`}
                          >
                            {appointment.source === "ai" && <SparklesIcon className="h-3 w-3 flex-shrink-0 text-violet-600" />}
                            <span className="truncate">
                              {formatTime(appointment.startsAt)} {appointment.contactName || appointment.contactPhone || "Cliente"}
                            </span>
                          </span>
                          {!compact && (
                            <span className="block truncate text-slate-600">
                              {service?.name ?? "Atendimento"}
                              {filter.length !== 1 && professional ? ` · ${professional.name}` : ""}
                            </span>
                          )}
                          {!compact && appointment.status !== "scheduled" && (
                            <span className="block truncate text-slate-500">{STATUS_LABEL[appointment.status]}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          {loadingAppointments && <p className="py-3 text-center text-xs text-slate-400">Carregando agenda...</p>}
        </div>
      )}

      {modal && (
        <AppointmentModal
          key={modal.mode === "edit" ? modal.appointment.id : `new-${modal.start?.getTime() ?? "x"}`}
          clinicId={clinicId}
          professionals={professionals}
          services={services}
          appointment={modal.mode === "edit" ? modal.appointment : null}
          defaultStart={modal.mode === "new" ? modal.start : null}
          defaultProfessionalId={modal.mode === "new" ? modal.professionalId : null}
          canSeeReminder={canManage}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
};

export default AgendaPage;
