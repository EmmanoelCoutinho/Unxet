import { describe, expect, it } from "vitest";
import { computePeakHour, formatHourRange } from "./peakHour";

// Datas sem sufixo de fuso são interpretadas no horário local,
// o mesmo usado por computePeakHour
const at = (hour: number, minute = 0) =>
  new Date(2026, 9, 8, hour, minute).toISOString();

describe("computePeakHour", () => {
  it("retorna null quando não há mensagens", () => {
    const result = computePeakHour([]);
    expect(result.peakHour).toBeNull();
    expect(result.peakMessages).toBe(0);
    expect(result.peakSharePct).toBeNull();
    expect(result.byHour).toHaveLength(24);
  });

  it("identifica a hora com mais mensagens", () => {
    const result = computePeakHour([
      at(9, 5),
      at(14, 0),
      at(14, 30),
      at(14, 59),
      at(20, 10),
    ]);
    expect(result.peakHour).toBe(14);
    expect(result.peakMessages).toBe(3);
    expect(result.peakSharePct).toBe(60);
    expect(result.byHour[9].messages).toBe(1);
  });

  it("desempata pela hora mais cedo e ignora datas inválidas", () => {
    const result = computePeakHour([at(16), at(10), "invalid"]);
    expect(result.peakHour).toBe(10);
    expect(result.peakSharePct).toBe(50);
  });
});

describe("formatHourRange", () => {
  it("formata a faixa horária", () => {
    expect(formatHourRange(9)).toBe("09h–10h");
    expect(formatHourRange(23)).toBe("23h–00h");
    expect(formatHourRange(null)).toBe("-");
  });
});
