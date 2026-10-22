import { formatDayShort } from "./format";

export type SeriesPoint = { label: string; leads: number; closed: number };

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * Períodos longos viram semanas (mais de 45 dias) ou meses (mais de 180),
 * para o gráfico continuar legível no PDF e na tela.
 */
export const groupDailySeries = (
  daily: Array<{ day: string; leads: number; closed: number }>,
): SeriesPoint[] => {
  if (daily.length <= 45) {
    return daily.map((row) => ({
      label: formatDayShort(row.day),
      leads: row.leads,
      closed: row.closed,
    }));
  }

  const byMonth = daily.length > 180;
  const groups = new Map<string, SeriesPoint>();

  daily.forEach((row, index) => {
    const key = byMonth ? row.day.slice(0, 7) : String(Math.floor(index / 7));
    const label = byMonth
      ? `${MONTHS[Number(row.day.slice(5, 7)) - 1]}/${row.day.slice(2, 4)}`
      : formatDayShort(row.day);
    const current = groups.get(key) ?? { label, leads: 0, closed: 0 };
    current.leads += row.leads;
    current.closed += row.closed;
    groups.set(key, current);
  });

  return Array.from(groups.values());
};
