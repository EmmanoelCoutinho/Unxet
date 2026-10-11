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
 * Monta o resumo a partir das contagens por hora (índice 0 = 0h … 23 = 23h),
 * já calculadas pelo banco no fuso de quem está olhando o painel.
 * Em caso de empate, vence a hora mais cedo.
 */
export const summarizeHourlyCounts = (
  hourlyCounts: number[],
): PeakHourSummary => {
  const counts = Array.from({ length: 24 }, (_, hour) => {
    const value = Number(hourlyCounts[hour] ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  });

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
