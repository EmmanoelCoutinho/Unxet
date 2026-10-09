export type HourlyVolume = { hour: number; messages: number };

export type PeakHourSummary = {
  // Hora (0-23) com mais mensagens recebidas; null quando não há dados
  peakHour: number | null;
  peakMessages: number;
  // Percentual do volume total concentrado na hora de pico
  peakSharePct: number | null;
  byHour: HourlyVolume[];
};

/**
 * Distribui as mensagens pelas 24 horas do dia (fuso local do navegador)
 * e identifica a hora de maior volume. Em caso de empate, vence a mais cedo.
 */
export const computePeakHour = (timestamps: string[]): PeakHourSummary => {
  const counts = new Array<number>(24).fill(0);

  for (const timestamp of timestamps) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) continue;
    counts[date.getHours()] += 1;
  }

  const total = counts.reduce((sum, value) => sum + value, 0);
  const peakMessages = Math.max(...counts);
  const peakHour = total > 0 ? counts.indexOf(peakMessages) : null;

  return {
    peakHour,
    peakMessages: total > 0 ? peakMessages : 0,
    peakSharePct:
      total > 0 ? Math.round((peakMessages / total) * 10000) / 100 : null,
    byHour: counts.map((messages, hour) => ({ hour, messages })),
  };
};

const pad = (value: number) => String(value).padStart(2, "0");

export const formatHourRange = (hour: number | null) =>
  hour === null ? "-" : `${pad(hour)}h–${pad((hour + 1) % 24)}h`;
