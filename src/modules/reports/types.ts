export type ReportType = "full" | "summary" | "team" | "sla" | "satisfaction";

export type ReportFilters = {
  clinicId: string;
  // Dias escolhidos (AAAA-MM-DD), como aparecem para a pessoa
  startDay: string;
  endDay: string;
  // Intervalo enviado ao banco: início do 1º dia até o início do dia seguinte ao último
  start: string;
  end: string;
  channels: string[];
  departmentId?: string;
  assignedUserId?: string;
};

// Rótulos dos filtros para o cabeçalho do PDF e do CSV
export type ReportFilterLabels = {
  channels: string;
  department: string;
  attendant: string;
};

export type PeriodKpis = {
  leads: number;
  closed: number;
  autoClosed: number;
  contactsServed: number;
  newContacts: number;
  inboundMessages: number;
  outboundMessages: number;
  botMessages: number;
  firstResponseCount: number;
  p50FirstResponseSec: number | null;
  p90FirstResponseSec: number | null;
  withinSlaPct: number | null;
  unansweredLeads: number;
  p50ResolutionSec: number | null;
  surveysSent: number;
  surveysAnswered: number;
  averageScore: number | null;
  csatPct: number | null;
};

export type TeamRow = {
  userId: string;
  name: string;
  role: string;
  lastSeenAt: string | null;
  conversations: number;
  closed: number;
  outboundMessages: number;
  p50FirstResponseSec: number | null;
  withinSlaPct: number | null;
  p50ResolutionSec: number | null;
  surveysAnswered: number;
  averageScore: number | null;
};

export type SlaGroupRow = {
  label: string;
  count: number;
  p50Sec: number | null;
  p90Sec: number | null;
  withinSlaPct: number | null;
};

export type SlowConversation = {
  conversationId: string;
  contact: string;
  channel: string;
  department: string;
  assignedTo: string;
  firstInboundAt: string;
  // null = ainda sem resposta humana
  seconds: number | null;
};

export type LowScore = {
  answeredAt: string;
  score: number;
  comment: string | null;
  contact: string;
  agent: string;
  department: string;
};

export type OperationalReport = {
  slaThresholdSec: number;
  timezone: string;
  summary: {
    current: PeriodKpis;
    previous: PeriodKpis;
    previousStart: string;
    previousEnd: string;
    activeNow: number;
  };
  daily: Array<{ day: string; leads: number; closed: number }>;
  leadsByChannel: Array<{ channel: string; leads: number }>;
  leadsByDepartment: Array<{ department: string; leads: number }>;
  team: TeamRow[];
  sla: {
    byChannel: SlaGroupRow[];
    byDepartment: SlaGroupRow[];
    buckets: Array<{ label: string; count: number }>;
    // weekday: 1 = segunda ... 7 = domingo
    heatmap: Array<{ weekday: number; hour: number; messages: number }>;
    slowest: SlowConversation[];
  };
  satisfaction: {
    distribution: Array<{ score: number; count: number }>;
    byStatus: Record<string, number>;
    byDepartment: Array<{ label: string; answered: number; averageScore: number | null }>;
    lowScores: LowScore[];
  };
};

export type ReportExport = {
  id: string;
  code: string;
  generated_by_name: string | null;
  report_type: ReportType;
  format: "pdf" | "csv";
  period_start: string;
  period_end: string;
  filters: Record<string, unknown>;
  data_hash: string;
  created_at: string;
};

// Painel (tempo real)
export type LiveTeamRow = {
  userId: string;
  name: string;
  role: string;
  lastSeenAt: string | null;
  online: boolean;
  active: number;
  waiting: number;
  slaBreached: number;
  oldestWaitingAt: string | null;
  closedToday: number;
};

export type OperationalNow = {
  generatedAt: string;
  slaThresholdSec: number;
  now: {
    active: number;
    open: number;
    pending: number;
    inBot: number;
    unassigned: number;
    waiting: number;
    slaBreached: number;
    oldestWaitingAt: string | null;
    teamTotal: number;
    teamOnline: number;
  };
  today: PeriodKpis;
  // Ontem, da meia-noite até este mesmo horário (comparação justa com "hoje até agora")
  yesterdaySoFar: PeriodKpis;
  inboundByHourToday: number[];
  team: LiveTeamRow[];
};

// O que o PDF/CSV precisa além dos números
export type ExportContext = {
  type: ReportType;
  companyName: string;
  filters: ReportFilters;
  filterLabels: ReportFilterLabels;
  generatedByName: string;
  generatedAt: Date;
  code: string;
  dataHash: string;
};
