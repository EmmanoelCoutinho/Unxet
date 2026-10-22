import { supabase } from "../../lib/supabaseClient";
import type {
  OperationalNow,
  OperationalReport,
  PeriodKpis,
  ReportExport,
  ReportFilters,
  ReportType,
} from "./types";

const toError = (err: any, fallback: string) => {
  const msg = err?.message || err?.details || err?.hint || fallback;
  return new Error(typeof msg === "string" ? msg : fallback);
};

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const numOrNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeKpis = (raw: any): PeriodKpis => ({
  leads: num(raw?.leads),
  closed: num(raw?.closed),
  autoClosed: num(raw?.autoClosed),
  contactsServed: num(raw?.contactsServed),
  newContacts: num(raw?.newContacts),
  inboundMessages: num(raw?.inboundMessages),
  outboundMessages: num(raw?.outboundMessages),
  botMessages: num(raw?.botMessages),
  firstResponseCount: num(raw?.firstResponseCount),
  p50FirstResponseSec: numOrNull(raw?.p50FirstResponseSec),
  p90FirstResponseSec: numOrNull(raw?.p90FirstResponseSec),
  withinSlaPct: numOrNull(raw?.withinSlaPct),
  unansweredLeads: num(raw?.unansweredLeads),
  p50ResolutionSec: numOrNull(raw?.p50ResolutionSec),
  surveysSent: num(raw?.surveysSent),
  surveysAnswered: num(raw?.surveysAnswered),
  averageScore: numOrNull(raw?.averageScore),
  csatPct: numOrNull(raw?.csatPct),
});

/** Todos os números dos relatórios do período (RPC operational_report, só admin). */
export const fetchOperationalReport = async (
  filters: ReportFilters,
): Promise<OperationalReport> => {
  const timeZone = browserTimeZone();
  const { data, error } = await supabase.rpc("operational_report", {
    p_clinic_id: filters.clinicId,
    p_start: filters.start,
    p_end: filters.end,
    p_channels: filters.channels.length ? filters.channels : null,
    p_department_id: filters.departmentId ?? null,
    p_assigned_user_id: filters.assignedUserId ?? null,
    ...(timeZone ? { p_timezone: timeZone } : {}),
  });

  if (error) throw toError(error, "Falha ao carregar o relatório.");

  const raw = (data ?? {}) as any;
  return {
    slaThresholdSec: num(raw.slaThresholdSec) || 120,
    timezone: raw.timezone ?? "America/Sao_Paulo",
    summary: {
      current: normalizeKpis(raw.summary?.current),
      previous: normalizeKpis(raw.summary?.previous),
      previousStart: raw.summary?.previousStart,
      previousEnd: raw.summary?.previousEnd,
      activeNow: num(raw.summary?.activeNow),
    },
    daily: (raw.daily ?? []).map((row: any) => ({
      day: String(row.day),
      leads: num(row.leads),
      closed: num(row.closed),
    })),
    leadsByChannel: (raw.leadsByChannel ?? []).map((row: any) => ({
      channel: row.channel ?? "unknown",
      leads: num(row.leads),
    })),
    leadsByDepartment: (raw.leadsByDepartment ?? []).map((row: any) => ({
      department: row.department,
      leads: num(row.leads),
    })),
    team: (raw.team ?? []).map((row: any) => ({
      userId: row.userId,
      name: row.name,
      role: row.role,
      lastSeenAt: row.lastSeenAt ?? null,
      conversations: num(row.conversations),
      closed: num(row.closed),
      outboundMessages: num(row.outboundMessages),
      p50FirstResponseSec: numOrNull(row.p50FirstResponseSec),
      withinSlaPct: numOrNull(row.withinSlaPct),
      p50ResolutionSec: numOrNull(row.p50ResolutionSec),
      surveysAnswered: num(row.surveysAnswered),
      averageScore: numOrNull(row.averageScore),
    })),
    sla: {
      byChannel: (raw.sla?.byChannel ?? []).map(normalizeSlaRow),
      byDepartment: (raw.sla?.byDepartment ?? []).map(normalizeSlaRow),
      buckets: (raw.sla?.buckets ?? []).map((row: any) => ({
        label: row.label,
        count: num(row.count),
      })),
      heatmap: (raw.sla?.heatmap ?? []).map((row: any) => ({
        weekday: num(row.weekday),
        hour: num(row.hour),
        messages: num(row.messages),
      })),
      slowest: (raw.sla?.slowest ?? []).map((row: any) => ({
        conversationId: row.conversationId,
        contact: row.contact,
        channel: row.channel ?? "unknown",
        department: row.department,
        assignedTo: row.assignedTo,
        firstInboundAt: row.firstInboundAt,
        seconds: numOrNull(row.seconds),
      })),
    },
    satisfaction: {
      distribution: (raw.satisfaction?.distribution ?? []).map((row: any) => ({
        score: num(row.score),
        count: num(row.count),
      })),
      byStatus: raw.satisfaction?.byStatus ?? {},
      byDepartment: (raw.satisfaction?.byDepartment ?? []).map((row: any) => ({
        label: row.label,
        answered: num(row.answered),
        averageScore: numOrNull(row.averageScore),
      })),
      lowScores: (raw.satisfaction?.lowScores ?? []).map((row: any) => ({
        answeredAt: row.answeredAt,
        score: num(row.score),
        comment: row.comment ?? null,
        contact: row.contact,
        agent: row.agent,
        department: row.department,
      })),
    },
  };
};

/** Painel: situação agora e números de hoje (RPC operational_now, só admin). */
export const fetchOperationalNow = async (params: {
  clinicId: string;
  channels: string[];
  departmentId?: string;
}): Promise<OperationalNow> => {
  const timeZone = browserTimeZone();
  const { data, error } = await supabase.rpc("operational_now", {
    p_clinic_id: params.clinicId,
    p_channels: params.channels.length ? params.channels : null,
    p_department_id: params.departmentId ?? null,
    ...(timeZone ? { p_timezone: timeZone } : {}),
  });

  if (error) throw toError(error, "Falha ao carregar o painel.");

  const raw = (data ?? {}) as any;
  const now = raw.now ?? {};
  return {
    generatedAt: raw.generatedAt ?? new Date().toISOString(),
    slaThresholdSec: num(raw.slaThresholdSec) || 120,
    now: {
      active: num(now.active),
      open: num(now.open),
      pending: num(now.pending),
      inBot: num(now.inBot),
      unassigned: num(now.unassigned),
      waiting: num(now.waiting),
      slaBreached: num(now.slaBreached),
      oldestWaitingAt: now.oldestWaitingAt ?? null,
      teamTotal: num(now.teamTotal),
      teamOnline: num(now.teamOnline),
    },
    today: normalizeKpis(raw.today),
    yesterdaySoFar: normalizeKpis(raw.yesterdaySoFar),
    inboundByHourToday: Array.from({ length: 24 }, (_, hour) =>
      num(raw.inboundByHourToday?.[hour]),
    ),
    team: (raw.team ?? []).map((row: any) => ({
      userId: row.userId,
      name: row.name,
      role: row.role,
      lastSeenAt: row.lastSeenAt ?? null,
      online: row.online === true,
      active: num(row.active),
      waiting: num(row.waiting),
      slaBreached: num(row.slaBreached),
      oldestWaitingAt: row.oldestWaitingAt ?? null,
      closedToday: num(row.closedToday),
    })),
  };
};

function normalizeSlaRow(row: any) {
  return {
    label: String(row.label ?? "-"),
    count: num(row.count),
    p50Sec: numOrNull(row.p50Sec),
    p90Sec: numOrNull(row.p90Sec),
    withinSlaPct: numOrNull(row.withinSlaPct),
  };
}

/** Registra a exportação e devolve o código de verificação impresso no arquivo. */
export const registerReportExport = async (params: {
  filters: ReportFilters;
  type: ReportType;
  format: "pdf" | "csv";
  filterSummary: Record<string, unknown>;
  dataHash: string;
}) => {
  const { data, error } = await supabase.rpc("register_report_export", {
    p_clinic_id: params.filters.clinicId,
    p_report_type: params.type,
    p_format: params.format,
    p_period_start: params.filters.start,
    p_period_end: params.filters.end,
    p_filters: params.filterSummary,
    p_data_hash: params.dataHash,
  });

  if (error) throw toError(error, "Falha ao registrar a exportação.");
  const result = (data ?? {}) as {
    code: string;
    createdAt: string;
    generatedByName: string | null;
  };
  return result;
};

export const listReportExports = async (clinicId: string, limit = 15) => {
  const { data, error } = await supabase.rpc("list_report_exports", {
    p_clinic_id: clinicId,
    p_limit: limit,
  });
  if (error) throw toError(error, "Falha ao carregar o histórico.");
  return (data ?? []) as ReportExport[];
};

export const verifyReportExport = async (clinicId: string, code: string) => {
  const { data, error } = await supabase.rpc("verify_report_export", {
    p_clinic_id: clinicId,
    p_code: code,
  });
  if (error) throw toError(error, "Falha ao verificar o código.");
  const rows = (data ?? []) as ReportExport[];
  return rows[0] ?? null;
};
