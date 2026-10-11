import { supabase } from "../lib/supabaseClient";
import { summarizeHourlyCounts, type PeakHourSummary } from "../lib/peakHour";

export type AnalyticsFilters = {
  clinicId: string;
  start: string; // ISO
  end: string; // ISO
  channels: string[];
  departmentId?: string;
  assignedUserId?: string;
};

export type SlaByChannel = {
  channel: string;
  p50Sec: number;
  p90Sec: number;
  withinSlaPct: number;
};

export type AnalyticsResponse = {
  // Meta de 1ª resposta usada no "dentro do SLA" (configuração da clínica ou 2 min)
  slaThresholdSec: number;
  kpis: {
    // Conversas criadas no período
    leads: number;
    // Conversas abertas ou pendentes agora (não depende do período)
    activeConversations: number;
    inboundMessages: number;
    outboundMessages: number;
    p50FirstResponseSec: number | null;
    p90FirstResponseSec: number | null;
    withinSlaPct: number | null;
  };
  leadsByChannel: Array<{ channel: string; leads: number }>;
  leadsByDepartment: Array<{ department: string; leads: number }>;
  // Ranking de atendentes por conversas atribuídas no período
  leadsByUserId: Array<{ userId: string; userName: string; leads: number }>;
  dailyLeads: Array<{ day: string; leads: number }>;
  slaByChannel: SlaByChannel[];
  // Distribuição das mensagens recebidas por hora do dia
  peakHour: PeakHourSummary;
};

type ClinicUserRow = { user_id: string; name: string | null };

type AnalyticsRpcResult = Omit<AnalyticsResponse, "peakHour"> & {
  inboundByHour: number[] | null;
};

type BacklogRpcRow = {
  conversation_id: string;
  contact: string;
  channel: string;
  department: string;
  assigned_to: string;
  last_message_at: string;
  last_message_text: string | null;
  total_count: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const toNumberOrNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toError = (err: any, fallback: string) => {
  const msg =
    err?.message ||
    err?.error_description ||
    err?.hint ||
    err?.details ||
    fallback;
  return new Error(typeof msg === "string" ? msg : fallback);
};

// Dias e horas do painel seguem o fuso de quem está olhando
const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

const rpcFilters = (filters: AnalyticsFilters) => ({
  p_clinic_id: filters.clinicId,
  p_channels: filters.channels?.length ? filters.channels : null,
  p_department_id: filters.departmentId ?? null,
  p_assigned_user_id: filters.assignedUserId ?? null,
});

/**
 * Indicadores do período. A agregação roda no banco (RPC inbox_analytics):
 * a API devolve no máximo 1000 linhas por consulta, então somar no navegador
 * truncava os números.
 */
export const fetchInboxAnalytics = async (
  filters: AnalyticsFilters,
): Promise<AnalyticsResponse> => {
  const timeZone = browserTimeZone();

  const { data, error } = await supabase.rpc("inbox_analytics", {
    ...rpcFilters(filters),
    p_start: filters.start,
    p_end: filters.end,
    ...(timeZone ? { p_timezone: timeZone } : {}),
  });

  if (error) throw toError(error, "Falha ao carregar os indicadores.");

  const result = (data ?? {}) as Partial<AnalyticsRpcResult>;
  const kpis = (result.kpis ?? {}) as Partial<AnalyticsResponse["kpis"]>;

  return {
    slaThresholdSec: Number(result.slaThresholdSec ?? 120),
    kpis: {
      leads: Number(kpis.leads ?? 0),
      activeConversations: Number(kpis.activeConversations ?? 0),
      inboundMessages: Number(kpis.inboundMessages ?? 0),
      outboundMessages: Number(kpis.outboundMessages ?? 0),
      p50FirstResponseSec: toNumberOrNull(kpis.p50FirstResponseSec),
      p90FirstResponseSec: toNumberOrNull(kpis.p90FirstResponseSec),
      withinSlaPct: toNumberOrNull(kpis.withinSlaPct),
    },
    leadsByChannel: result.leadsByChannel ?? [],
    leadsByDepartment: result.leadsByDepartment ?? [],
    leadsByUserId: result.leadsByUserId ?? [],
    dailyLeads: result.dailyLeads ?? [],
    slaByChannel: (result.slaByChannel ?? []).map((row) => ({
      channel: row.channel,
      p50Sec: Number(row.p50Sec ?? 0),
      p90Sec: Number(row.p90Sec ?? 0),
      withinSlaPct: Number(row.withinSlaPct ?? 0),
    })),
    peakHour: summarizeHourlyCounts(result.inboundByHour ?? []),
  };
};

export type BacklogItem = {
  conversationId: string;
  contact: string;
  channel: string;
  department: string;
  assignedTo: string;
  lastMessageAt: string;
  lastMessageText: string;
  minutesWaiting: number;
};

export type BacklogResult = {
  items: BacklogItem[];
  // Total de conversas aguardando resposta (a lista traz no máximo 500)
  total: number;
};

/**
 * Conversas ativas cuja última mensagem é do cliente, da que espera há mais
 * tempo para a mais recente. Não depende do período selecionado.
 */
export const fetchBacklog = async (
  filters: AnalyticsFilters,
): Promise<BacklogResult> => {
  const { data, error } = await supabase.rpc(
    "inbox_backlog",
    rpcFilters(filters),
  );

  if (error) throw toError(error, "Falha ao buscar o backlog.");

  const rows = (data ?? []) as BacklogRpcRow[];
  const now = Date.now();

  return {
    total: Number(rows[0]?.total_count ?? 0),
    items: rows.map((row) => ({
      conversationId: row.conversation_id,
      contact: row.contact,
      channel: row.channel ?? "unknown",
      department: row.department,
      assignedTo: row.assigned_to,
      lastMessageAt: row.last_message_at,
      lastMessageText: row.last_message_text?.trim() || "Mensagem recebida",
      minutesWaiting: round2(
        (now - new Date(row.last_message_at).getTime()) / 1000 / 60,
      ),
    })),
  };
};

/**
 * Pesquisa de satisfação (CSAT 1 a 5)
 */
export type SatisfactionSummary = {
  sent: number;
  answered: number;
  responseRatePct: number | null;
  averageScore: number | null;
  // percentual de notas 4 e 5
  csatPct: number | null;
  distribution: Array<{ score: number; count: number }>;
  byAgent: Array<{
    userId: string;
    name: string;
    answered: number;
    averageScore: number;
  }>;
};

type SatisfactionSurveyRow = {
  status: string;
  score: number | null;
  agent_user_id: string | null;
};

export const fetchSatisfactionSummary = async (
  filters: AnalyticsFilters,
): Promise<SatisfactionSummary> => {
  let query = supabase
    .from("satisfaction_surveys")
    .select("status,score,agent_user_id")
    .eq("clinic_id", filters.clinicId)
    .gte("sent_at", filters.start)
    .lt("sent_at", filters.end)
    .neq("status", "failed");

  if (filters.channels?.length) query = query.in("channel", filters.channels);
  if (filters.departmentId) query = query.eq("department_id", filters.departmentId);
  if (filters.assignedUserId)
    query = query.eq("agent_user_id", filters.assignedUserId);

  const { data, error } = await query;
  if (error) throw toError(error, "Falha ao buscar pesquisas de satisfação.");

  const rows = (data ?? []) as SatisfactionSurveyRow[];
  const answeredRows = rows.filter(
    (row) => row.status === "answered" && typeof row.score === "number",
  );
  const scores = answeredRows.map((row) => row.score as number);

  const distribution = [1, 2, 3, 4, 5].map((score) => ({
    score,
    count: scores.filter((value) => value === score).length,
  }));

  const agentScores = new Map<string, number[]>();
  for (const row of answeredRows) {
    if (!row.agent_user_id) continue;
    const list = agentScores.get(row.agent_user_id) ?? [];
    list.push(row.score as number);
    agentScores.set(row.agent_user_id, list);
  }

  const agentIds = Array.from(agentScores.keys());
  const namesMap = new Map<string, string>();
  if (agentIds.length) {
    const { data: usersData } = await supabase
      .from("clinic_users")
      .select("user_id,name")
      .in("user_id", agentIds);
    for (const row of (usersData ?? []) as ClinicUserRow[]) {
      namesMap.set(row.user_id, row.name ?? "Atendente");
    }
  }

  const average = (values: number[]) =>
    values.length
      ? round2(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null;

  return {
    sent: rows.length,
    answered: answeredRows.length,
    responseRatePct: rows.length
      ? round2((answeredRows.length / rows.length) * 100)
      : null,
    averageScore: average(scores),
    csatPct: scores.length
      ? round2((scores.filter((score) => score >= 4).length / scores.length) * 100)
      : null,
    distribution,
    byAgent: agentIds
      .map((userId) => {
        const list = agentScores.get(userId) ?? [];
        return {
          userId,
          name: namesMap.get(userId) ?? "Atendente",
          answered: list.length,
          averageScore: average(list) ?? 0,
        };
      })
      .sort((a, b) => b.averageScore - a.averageScore || b.answered - a.answered),
  };
};
