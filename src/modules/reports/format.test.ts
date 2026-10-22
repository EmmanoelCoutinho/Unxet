import { describe, expect, it } from "vitest";
import {
  buildExportFileName,
  compareValues,
  formatDuration,
  formatTrend,
  previousRange,
  sha256Hex,
  slugifyName,
} from "./format";
import { escapeCsvCell } from "./csv";
import { groupDailySeries } from "./series";

describe("formatDuration", () => {
  it("formata segundos, minutos, horas e dias", () => {
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(200)).toBe("3 min 20s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(8100)).toBe("2h 15 min");
    expect(formatDuration(90000)).toBe("1d 1h");
  });
});

describe("compareValues", () => {
  it("marca como boa a queda de um indicador onde menos é melhor", () => {
    const trend = compareValues(60, 120, false);
    expect(trend.direction).toBe("down");
    expect(trend.good).toBe(true);
    expect(formatTrend(trend)).toBe("-50,0%");
  });

  it("não calcula porcentagem a partir de zero", () => {
    const trend = compareValues(10, 0);
    expect(trend.pct).toBeNull();
    expect(formatTrend(trend)).toBe("novo");
  });

  it("trata variação mínima como estável", () => {
    expect(formatTrend(compareValues(1000, 1002))).toBe("estável");
  });
});

describe("previousRange", () => {
  it("usa a mesma quantidade de dias terminando na véspera", () => {
    expect(previousRange("2026-10-01", "2026-10-14")).toEqual({
      startDay: "2026-09-17",
      endDay: "2026-09-30",
    });
    expect(previousRange("2026-03-01", "2026-03-01")).toEqual({
      startDay: "2026-02-28",
      endDay: "2026-02-28",
    });
  });
});

describe("nome do arquivo", () => {
  it("tira acentos e símbolos do nome da empresa", () => {
    expect(slugifyName("Clínica São José Ltda.")).toBe("Clinica-Sao-Jose-Ltda");
    expect(slugifyName("***")).toBe("Empresa");
  });

  it("monta Unxet_tipo_empresa_período_código", () => {
    expect(
      buildExportFileName({
        type: "team",
        companyName: "Ótica Visão & Cia",
        startDay: "2026-10-01",
        endDay: "2026-10-14",
        code: "UNX-AB12-CD34",
        extension: "pdf",
      }),
    ).toBe("Unxet_Desempenho-da-Equipe_Otica-Visao-Cia_2026-10-01_a_2026-10-14_UNX-AB12-CD34.pdf");
  });
});

describe("escapeCsvCell", () => {
  it("protege contra fórmulas e escapa separador e aspas", () => {
    expect(escapeCsvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(escapeCsvCell("-12,5")).toBe("-12,5");
    expect(escapeCsvCell('ótimo; "nota" 5')).toBe('"ótimo; ""nota"" 5"');
    expect(escapeCsvCell(null)).toBe("");
  });
});

describe("groupDailySeries", () => {
  const days = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 1 + i));
      return { day: date.toISOString().slice(0, 10), leads: 1, closed: 1 };
    });

  it("mantém dias em períodos curtos", () => {
    expect(groupDailySeries(days(30))).toHaveLength(30);
  });

  it("agrupa por semana e por mês sem perder totais", () => {
    const weekly = groupDailySeries(days(60));
    expect(weekly).toHaveLength(9);
    expect(weekly.reduce((sum, row) => sum + row.leads, 0)).toBe(60);

    const monthly = groupDailySeries(days(365));
    expect(monthly).toHaveLength(12);
    expect(monthly[0].label).toBe("jan/26");
  });
});

describe("sha256Hex", () => {
  it("gera o hash hexadecimal", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
