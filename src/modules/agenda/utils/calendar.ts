import type { Appointment, AppointmentStatus, WorkingHour } from "../types";

// Datas da tela da Agenda, no horário do aparelho (as empresas estão no
// Brasil; o servidor usa o fuso da empresa para os horários livres e lembretes)

export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const WEEKDAY_LONG = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

export const PROFESSIONAL_COLORS = [
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#db2777",
  "#0891b2",
  "#ca8a04",
  "#dc2626",
];

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Marcado",
  confirmed: "Confirmado",
  completed: "Atendido",
  no_show: "Faltou",
  cancelled: "Cancelado",
};

export const isActiveStatus = (status: AppointmentStatus) =>
  status === "scheduled" || status === "confirmed";

const pad = (n: number) => String(n).padStart(2, "0");

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());

/** Segunda-feira da semana da data (semana de segunda a domingo). */
export const startOfWeek = (date: Date) => {
  const day = startOfDay(date);
  const diff = (day.getDay() + 6) % 7;
  return addDays(day, -diff);
};

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "2026-11-28" (data local) */
export const toDateInput = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** "14:30" (hora local) */
export const toTimeInput = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Data e hora dos campos do formulário para o instante (horário do aparelho). */
export const fromInputs = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if (!y || !m || !d || Number.isNaN(h) || Number.isNaN(mi)) return null;
  const result = new Date(y, m - 1, d, h, mi);
  return Number.isNaN(result.getTime()) ? null : result;
};

export const minutesOfDay = (date: Date) => date.getHours() * 60 + date.getMinutes();

export const timeToMinutes = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const minutesToTime = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export const formatTime = (iso: string) => toTimeInput(new Date(iso));

export const formatDayLabel = (date: Date) =>
  `${WEEKDAY_LONG[date.getDay()]}, ${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}`;

export const formatRangeLabel = (start: Date, days: number) => {
  if (days === 1) return formatDayLabel(start);
  const end = addDays(start, days - 1);
  const sameMonth = start.getMonth() === end.getMonth();
  const startText = start.toLocaleDateString("pt-BR", sameMonth ? { day: "2-digit" } : { day: "2-digit", month: "short" });
  const endText = end.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  return `${startText} a ${endText}`;
};

export const formatDuration = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${pad(m)}` : `${h}h`;
};

/**
 * Faixa de horas mostrada na grade: do primeiro expediente ao último (com
 * folga de 1h), sem cortar agendamentos fora do expediente. Padrão 8h às 19h.
 */
export const visibleHours = (hours: WorkingHour[], appointments: Appointment[], days: Date[]) => {
  let start = 8 * 60;
  let end = 19 * 60;
  if (hours.length > 0) {
    start = Math.min(...hours.map((h) => timeToMinutes(h.start)));
    end = Math.max(...hours.map((h) => timeToMinutes(h.end)));
  }
  for (const appt of appointments) {
    const s = new Date(appt.startsAt);
    const e = new Date(appt.endsAt);
    if (!days.some((d) => sameDay(d, s))) continue;
    start = Math.min(start, minutesOfDay(s));
    end = Math.max(end, sameDay(s, e) ? minutesOfDay(e) : 24 * 60);
  }
  const from = Math.max(0, Math.floor(start / 60) * 60);
  const to = Math.min(24 * 60, Math.ceil(end / 60) * 60);
  return { from, to: Math.max(to, from + 60) };
};

export type PlacedAppointment = { appointment: Appointment; column: number; columns: number };

/**
 * Lado a lado quando os horários se cruzam no mesmo dia (profissionais
 * diferentes ao mesmo tempo). Cada grupo que se sobrepõe divide a largura.
 */
export const layoutDay = (appointments: Appointment[]): PlacedAppointment[] => {
  const sorted = [...appointments].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || b.endsAt.localeCompare(a.endsAt),
  );
  const placed: PlacedAppointment[] = [];
  let group: { item: PlacedAppointment; end: number }[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    const columns = Math.max(1, ...group.map((g) => g.item.column + 1));
    group.forEach((g) => (g.item.columns = columns));
    group = [];
  };

  for (const appointment of sorted) {
    const start = new Date(appointment.startsAt).getTime();
    const end = new Date(appointment.endsAt).getTime();
    if (start >= groupEnd) {
      flush();
      groupEnd = -Infinity;
    }
    const used = new Set(group.filter((g) => g.end > start).map((g) => g.item.column));
    let column = 0;
    while (used.has(column)) column++;
    const item = { appointment, column, columns: 1 };
    placed.push(item);
    group.push({ item, end });
    groupEnd = Math.max(groupEnd, end);
  }
  flush();
  return placed;
};

/** Hora livre? (não cai dentro do expediente do dia) */
export const isOutsideHours = (hours: WorkingHour[], weekday: number, minute: number) => {
  const today = hours.filter((h) => h.weekday === weekday);
  return !today.some((h) => minute >= timeToMinutes(h.start) && minute < timeToMinutes(h.end));
};

/** Faixas do mesmo dia sem sobreposição e com fim depois do início. Devolve o erro ou null. */
export const validateHours = (hours: WorkingHour[]) => {
  for (let weekday = 0; weekday < 7; weekday++) {
    const list = hours
      .filter((h) => h.weekday === weekday)
      .map((h) => ({ start: timeToMinutes(h.start), end: timeToMinutes(h.end) }))
      .sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length; i++) {
      if (list[i].end <= list[i].start) {
        return `${WEEKDAY_LONG[weekday]}: o fim precisa ser depois do início.`;
      }
      if (i > 0 && list[i].start < list[i - 1].end) {
        return `${WEEKDAY_LONG[weekday]}: os horários se sobrepõem.`;
      }
    }
  }
  return null;
};

/** Expediente comum: segunda a sexta, 8h às 12h e 13h às 18h. */
export const defaultHours = (): WorkingHour[] =>
  [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, start: "08:00", end: "12:00" },
    { weekday, start: "13:00", end: "18:00" },
  ]);
