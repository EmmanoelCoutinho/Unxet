// Regras de repetição das mensagens agendadas para um cliente. O cálculo é o
// mesmo de recurring_next_run (migration 20261027000000), no fuso do navegador:
// aqui serve para a prévia "Próximos envios" enquanto a pessoa preenche.

export type Frequency = "once" | "daily" | "weekly" | "monthly";

export type RecurrenceDraft = {
  frequency: Frequency;
  // 0 = domingo ... 6 = sábado
  weekdays: number[];
  monthDay: number;
  // "HH:MM"
  sendTime: string;
  // "AAAA-MM-DD"
  startsOn: string;
  endsOn: string | null;
  maxRuns: number | null;
};

export const WEEKDAYS = [
  { value: 0, short: "Dom", long: "domingo" },
  { value: 1, short: "Seg", long: "segunda" },
  { value: 2, short: "Ter", long: "terça" },
  { value: 3, short: "Qua", long: "quarta" },
  { value: 4, short: "Qui", long: "quinta" },
  { value: 5, short: "Sex", long: "sexta" },
  { value: 6, short: "Sáb", long: "sábado" },
] as const;

const parseDate = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

const at = (day: Date, time: string) => {
  const [h, min] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, min || 0, 0, 0);
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const lastDayOfMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/** Próximo envio depois de `after` (null = não há mais). */
export const nextRun = (rule: RecurrenceDraft, after: Date): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.startsOn) || !/^\d{2}:\d{2}$/.test(rule.sendTime)) return null;
  const starts = parseDate(rule.startsOn);
  const ends = rule.endsOn && /^\d{4}-\d{2}-\d{2}$/.test(rule.endsOn) ? parseDate(rule.endsOn) : null;

  if (rule.frequency === "once") {
    const candidate = at(starts, rule.sendTime);
    return candidate > after ? candidate : null;
  }

  const firstDay = new Date(Math.max(starts.getTime(), startOfDay(after).getTime()));

  if (rule.frequency === "daily" || rule.frequency === "weekly") {
    for (let i = 0; i <= 14; i++) {
      const day = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + i);
      if (ends && day > ends) return null;
      if (rule.frequency === "daily" || rule.weekdays.includes(day.getDay())) {
        const candidate = at(day, rule.sendTime);
        if (candidate > after) return candidate;
      }
    }
    return null;
  }

  // monthly: dia 31 em mês mais curto sai no último dia
  let year = firstDay.getFullYear();
  let month = firstDay.getMonth();
  for (let i = 0; i <= 24; i++) {
    const day = new Date(year, month, Math.min(rule.monthDay, lastDayOfMonth(year, month)));
    if (ends && day > ends) return null;
    if (day >= starts) {
      const candidate = at(day, rule.sendTime);
      if (candidate > after) return candidate;
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return null;
};

/** Os próximos envios a partir de agora (respeita o limite de envios). */
export const upcomingRuns = (rule: RecurrenceDraft, from: Date, count = 3): Date[] => {
  const limit = rule.frequency === "once" ? 1 : Math.min(count, rule.maxRuns ?? count);
  const runs: Date[] = [];
  let after = from;
  while (runs.length < limit) {
    const next = nextRun(rule, after);
    if (!next) break;
    runs.push(next);
    after = next;
  }
  return runs;
};

const joinPt = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;

const shortDate = (value: string) => parseDate(value).toLocaleDateString("pt-BR");

/** "Toda segunda e sexta às 10:00 · até 31/12/2026" */
export const describeRecurrence = (rule: RecurrenceDraft) => {
  let base: string;
  switch (rule.frequency) {
    case "once":
      return `Uma vez, em ${shortDate(rule.startsOn)} às ${rule.sendTime}`;
    case "daily":
      base = `Todo dia às ${rule.sendTime}`;
      break;
    case "weekly": {
      const days = [...rule.weekdays].sort((a, b) => a - b);
      if (days.length === 7) base = `Todo dia às ${rule.sendTime}`;
      else if (days.join() === "1,2,3,4,5") base = `De segunda a sexta às ${rule.sendTime}`;
      else {
        const names = days.map((d) => WEEKDAYS[d].long);
        // "Todo sábado" / "Toda segunda"
        const article = days.length === 1 && (days[0] === 0 || days[0] === 6) ? "Todo" : "Toda";
        base = `${article} ${joinPt(names)} às ${rule.sendTime}`;
      }
      break;
    }
    case "monthly":
      base = `Todo dia ${rule.monthDay} do mês às ${rule.sendTime}`;
      break;
  }
  if (rule.maxRuns) return `${base} · ${rule.maxRuns} ${rule.maxRuns === 1 ? "envio" : "envios"}`;
  if (rule.endsOn) return `${base} · até ${shortDate(rule.endsOn)}`;
  return base;
};
