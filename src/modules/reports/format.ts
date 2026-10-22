import type { ReportType } from "./types";

export const BRAND = {
  blue: "#0066FF",
  blueDark: "#0047B3",
  blueSoft: "#E8F0FF",
  green: "#00D374",
  greenSoft: "#E3FAEF",
  ink: "#0F172A",
  muted: "#64748B",
  line: "#E2E8F0",
  surface: "#F8FAFC",
  red: "#EF4444",
  amber: "#F59E0B",
} as const;

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  full: "Relatório Completo",
  summary: "Resumo Executivo",
  team: "Desempenho da Equipe",
  sla: "Atendimento e SLA",
  satisfaction: "Satisfação (CSAT)",
};

export const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  unknown: "Outro",
};

export const channelLabel = (channel: string) =>
  CHANNEL_LABEL[channel] ?? channel;

export const WEEKDAY_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const nf = new Intl.NumberFormat("pt-BR");
const nf1 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const formatInt = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : nf.format(Math.round(value));

export const formatPct = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : `${nf1.format(value)}%`;

export const formatScore = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : nf1.format(value);

/** 45s, 3 min 20s, 2h 15 min, 3d 4h */
export const formatDuration = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return "-";
  }
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const min = Math.floor(s / 60);
    const rest = s % 60;
    return rest ? `${min} min ${rest}s` : `${min} min`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const min = Math.floor((s % 3600) / 60);
    return min ? `${h}h ${min} min` : `${h}h`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
};

/** AAAA-MM-DD -> DD/MM/AAAA (sem passar por Date, que mudaria o dia pelo fuso) */
export const formatDay = (yyyyMmDd: string) => {
  const [y, m, d] = (yyyyMmDd ?? "").slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "-";
};

export const formatDayShort = (yyyyMmDd: string) => {
  const [, m, d] = (yyyyMmDd ?? "").slice(0, 10).split("-");
  return m && d ? `${d}/${m}` : "-";
};

export const formatDateTime = (value: string | Date | null | undefined) => {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** 14/10/2026 às 15:42 */
export const formatDateTimeLong = (value: string | Date) => {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  const day = date.toLocaleDateString("pt-BR");
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${day} às ${time}`;
};

/** Soma dias a um AAAA-MM-DD sem passar pelo fuso (meio-dia UTC não vira o dia) */
export const addDaysToDay = (yyyyMmDd: string, days: number) => {
  const date = new Date(`${yyyyMmDd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const dayDiff = (startDay: string, endDay: string) =>
  Math.round(
    (new Date(`${endDay}T12:00:00Z`).getTime() -
      new Date(`${startDay}T12:00:00Z`).getTime()) /
      86400000,
  );

/** Período anterior com a mesma quantidade de dias, terminando na véspera do início */
export const previousRange = (startDay: string, endDay: string) => {
  const length = dayDiff(startDay, endDay) + 1;
  return {
    startDay: addDaysToDay(startDay, -length),
    endDay: addDaysToDay(startDay, -1),
  };
};

export const formatPeriod =(startDay: string, endDay: string) =>
  startDay === endDay
    ? formatDay(startDay)
    : `${formatDay(startDay)} a ${formatDay(endDay)}`;

export type Trend = {
  // Variação em % sobre o período anterior (null quando não dá para comparar)
  pct: number | null;
  direction: "up" | "down" | "flat";
  // Se a variação é boa para a operação (subir 1ª resposta é ruim)
  good: boolean | null;
};

export const compareValues = (
  current: number | null,
  previous: number | null,
  higherIsBetter = true,
): Trend => {
  if (current === null || previous === null) {
    return { pct: null, direction: "flat", good: null };
  }
  if (previous === 0) {
    if (current === 0) return { pct: 0, direction: "flat", good: null };
    return { pct: null, direction: "up", good: higherIsBetter };
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.5) return { pct: 0, direction: "flat", good: null };
  const direction = pct > 0 ? "up" : "down";
  return {
    pct,
    direction,
    good: direction === "up" ? higherIsBetter : !higherIsBetter,
  };
};

export const formatTrend = (trend: Trend) => {
  if (trend.pct === null) return trend.direction === "up" ? "novo" : "-";
  if (trend.direction === "flat") return "estável";
  const sign = trend.pct > 0 ? "+" : "";
  return `${sign}${nf1.format(trend.pct)}%`;
};

/** "Clínica São José Ltda." -> "Clinica-Sao-Jose-Ltda" */
export const slugifyName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "Empresa";

/**
 * Unxet_Desempenho-da-Equipe_Empresa-X_2026-10-01_a_2026-10-14.pdf
 * O código de verificação no fim deixa cada arquivo único.
 */
export const buildExportFileName = (params: {
  type: ReportType;
  companyName: string;
  startDay: string;
  endDay: string;
  code: string;
  extension: "pdf" | "csv";
}) => {
  const period =
    params.startDay === params.endDay
      ? params.startDay
      : `${params.startDay}_a_${params.endDay}`;
  return [
    "Unxet",
    slugifyName(REPORT_TYPE_LABEL[params.type]),
    slugifyName(params.companyName),
    period,
    params.code,
  ].join("_") + `.${params.extension}`;
};

/** SHA-256 em hexadecimal dos números do relatório (vai para o rodapé e o histórico). */
export const sha256Hex = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};
