import { describe, expect, it } from "vitest";
import { formatHourRange, summarizeHourlyCounts } from "./peakHour";

// Contagens por hora com os valores informados e zero nas demais
const hourly = (values: Record<number, number>) =>
  Array.from({ length: 24 }, (_, hour) => values[hour] ?? 0);

describe("summarizeHourlyCounts", () => {
  it("retorna null quando não há mensagens", () => {
    const result = summarizeHourlyCounts([]);
    expect(result.peakHour).toBeNull();
    expect(result.peakMessages).toBe(0);
    expect(result.peakSharePct).toBeNull();
    expect(result.byHour).toHaveLength(24);
  });

  it("identifica a hora com mais mensagens", () => {
    const result = summarizeHourlyCounts(hourly({ 9: 1, 14: 3, 20: 1 }));
    expect(result.peakHour).toBe(14);
    expect(result.peakMessages).toBe(3);
    expect(result.peakSharePct).toBe(60);
    expect(result.byHour[9].messages).toBe(1);
  });

  it("desempata pela hora mais cedo", () => {
    const result = summarizeHourlyCounts(hourly({ 16: 1, 10: 1 }));
    expect(result.peakHour).toBe(10);
    expect(result.peakSharePct).toBe(50);
  });

  it("ignora valores inválidos e listas incompletas", () => {
    const result = summarizeHourlyCounts([
      2,
      Number.NaN,
      -5,
      null as unknown as number,
    ]);
    expect(result.peakHour).toBe(0);
    expect(result.peakMessages).toBe(2);
    expect(result.byHour).toHaveLength(24);
    expect(result.byHour[2].messages).toBe(0);
  });
});

describe("formatHourRange", () => {
  it("formata a faixa horária", () => {
    expect(formatHourRange(9)).toBe("09h–10h");
    expect(formatHourRange(23)).toBe("23h–00h");
    expect(formatHourRange(null)).toBe("-");
  });
});
