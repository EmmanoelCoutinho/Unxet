import { supabase } from "../lib/supabaseClient";
import { computePeakHour, type PeakHourSummary } from "../lib/peakHour";

export type AnalyticsFilters = {
  clinicId: string;
  start: string; // ISO
  end: string; // ISO
  channels: string[];
  departmentId?: string;
  assignedUserId?: string;
};

type ConversationRow = {
  id: string;
  channel: string | null;
  department_id: string | null;
  assigned_user_id: string | null;
  status: string | null;
  created_at: string;
  last_message_at?: string | null;
  contact_id?: string | null;
};

type MessageRow = {
  conversation_id: string;
  direction: string | null;
  created_at: string;
  text?: string | null;
};

type ConversationEventRow = {
  conversation_id: string;
  event_type: string;
  metadata: { seconds?: number | string } | null;
  created_at: string;
};

export type SlaByChannel = {
  channel: string;
  p50Sec: number;
  p90Sec: number;
  withinSlaPct: number;
};

export type AnalyticsResponse = {
  kpis: {
    leads: number;
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
  funnelByChannel: Array<{ channel: string; converted: number; lost: number }>;
};

type DepartmentRow = { id: string; name: string };
type ClinicUserRow = { user_id: string; name: string | null };
type ContactRow = { id: string; name: string | null; phone: string | null };

/**
 * Helpers
 */
const chunkArray = <T>(arr: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size)
    chunks.push(arr.slice(i, i + size));
  return chunks;
};

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const toError = (err: any, fallback: string) => {
  const msg =
    err?.message ||
    err?.error_description ||
    err?.hint ||
    err?.details ||
    fallback;
  return new Error(typeof msg === "string" ? msg : fallback);
};

/**
 * Aplica filtros opcionais com segurança.
 */
const applyConversationOptionalFilters = (
  query: any,
  filters: AnalyticsFilters,
) => {
  let next = query;

  if (filters.channels?.length) next = next.in("channel", filters.channels);
  if (filters.departmentId)
    next = next.eq("department_id", filters.departmentId);
  if (filters.assignedUserId)
    next = next.eq("assigned_user_id", filters.assignedUserId);

  return next;
};

const fetchMessagesByConversationIds = async (
  conversationIds: string[],
  selectColumns: string,
  options?: { start?: string; end?: string; orderAsc?: boolean },
): Promise<MessageRow[]> => {
  if (!conversationIds.length) return [];

  const batches = chunkArray(conversationIds, 500);
  const all: MessageRow[] = [];

  for (const ids of batches) {
    let q = supabase
      .from("messages")
      .select(selectColumns)
      .in("conversation_id", ids);

    if (options?.start) q = q.gte("created_at", options.start);
    if (options?.end) q = q.lt("created_at", options.end);

    if (options?.orderAsc === true)
      q = q.order("created_at", { ascending: true });
    if (options?.orderAsc === false)
      q = q.order("created_at", { ascending: false });

    const { data, error } = await q;
    if (error) throw toError(error, "Falha ao buscar mensagens.");

    all.push(...((data ?? []) as unknown as MessageRow[]));
  }

  return all;
};

const fetchEventsByConversationIds = async (
  conversationIds: string[],
  selectColumns: string,
  options?: { start?: string; end?: string },
): Promise<ConversationEventRow[]> => {
  if (!conversationIds.length) return [];

  const batches = chunkArray(conversationIds, 500);
  const all: ConversationEventRow[] = [];

  for (const ids of batches) {
    let q = supabase
      .from("conversation_events")
      .select(selectColumns)
      .in("conversation_id", ids);

    if (options?.start) q = q.gte("created_at", options.start);
    if (options?.end) q = q.lt("created_at", options.end);

    const { data, error } = await q;
    if (error) throw toError(error, "Falha ao buscar eventos.");

    all.push(...((data ?? []) as unknown as ConversationEventRow[]));
  }

  return all;
};

export const fetchInboxAnalytics = async (
  filters: AnalyticsFilters,
): Promise<AnalyticsResponse> => {
  // 1) Conversations
  const baseConversationsQuery = supabase
    .from("conversations")
    .select("id,channel,department_id,assigned_user_id,status,created_at")
    .eq("clinic_id", filters.clinicId)
    .gte("created_at", filters.start)
    .lt("created_at", filters.end);

  const { data: conversationsData, error: convError } =
    await applyConversationOptionalFilters(baseConversationsQuery, filters);

  if (convError) throw toError(convError, "Falha ao buscar conversas.");

  const conversations: ConversationRow[] = (conversationsData ??
    []) as unknown as ConversationRow[];
  const conversationIds = conversations.map((c) => c.id);

  // 2) Departments map
  const { data: departmentsData, error: depErr } = await supabase
    .from("departments")
    .select("id,name")
    .eq("clinic_id", filters.clinicId);

  if (depErr) throw toError(depErr, "Falha ao buscar departamentos.");

  const departmentsMap = new Map(
    ((departmentsData ?? []) as DepartmentRow[]).map((d) => [d.id, d.name]),
  );

  // 3) Messages in period (counts)
  const messages = await fetchMessagesByConversationIds(
    conversationIds,
    "conversation_id,direction,created_at",
    { start: filters.start, end: filters.end, orderAsc: false },
  );

  // 4) Events in period (SLA + funil)
  const events = await fetchEventsByConversationIds(
    conversationIds,
    "conversation_id,event_type,metadata,created_at",
    { start: filters.start, end: filters.end },
  );

  // Aggregations: leads by channel/department/day
  const leadsByChannelMap = new Map<string, number>();
  const leadsByDepartmentMap = new Map<string, number>();
  const dailyLeadsMap = new Map<string, number>();

  for (const conversation of conversations) {
    const channel = conversation.channel ?? "unknown";
    const department = conversation.department_id
      ? (departmentsMap.get(conversation.department_id) ?? "Sem departamento")
      : "Sem departamento";
    const day = conversation.created_at.slice(0, 10);

    leadsByChannelMap.set(channel, (leadsByChannelMap.get(channel) ?? 0) + 1);
    leadsByDepartmentMap.set(
      department,
      (leadsByDepartmentMap.get(department) ?? 0) + 1,
    );
    dailyLeadsMap.set(day, (dailyLeadsMap.get(day) ?? 0) + 1);
  }

  const inboundMessages = messages.filter(
    (m) => m.direction === "inbound",
  ).length;
  const outboundMessages = messages.filter(
    (m) => m.direction === "outbound",
  ).length;

  const activeConversations = conversations.filter(
    (c) => c.status === "open" || c.status === "pending",
  ).length;

  // SLA: prefer events; fallback messages
  const conversationMap = new Map(conversations.map((c) => [c.id, c]));
  const slaEvents = events.filter((e) => e.event_type === "sla.first_response");

  const responseSecondsByConversation = new Map<
    string,
    { channel: string; seconds: number }
  >();

  if (slaEvents.length > 0) {
    for (const e of slaEvents) {
      const conv = conversationMap.get(e.conversation_id);
      if (!conv) continue;

      const seconds = Number(e.metadata?.seconds);
      if (Number.isNaN(seconds) || seconds < 0) continue;

      responseSecondsByConversation.set(e.conversation_id, {
        channel: conv.channel ?? "unknown",
        seconds,
      });
    }
  } else if (conversationIds.length > 0) {
    // fallback: first inbound/outbound (sem filtro de período)
    const allMessages = await fetchMessagesByConversationIds(
      conversationIds,
      "conversation_id,direction,created_at",
      { orderAsc: true },
    );

    const firstInboundMap = new Map<string, string>();
    const firstOutboundMap = new Map<string, string>();

    for (const m of allMessages) {
      if (
        m.direction === "inbound" &&
        !firstInboundMap.has(m.conversation_id)
      ) {
        firstInboundMap.set(m.conversation_id, m.created_at);
      }
      if (
        m.direction === "outbound" &&
        !firstOutboundMap.has(m.conversation_id)
      ) {
        firstOutboundMap.set(m.conversation_id, m.created_at);
      }
    }

    for (const conv of conversations) {
      const inboundAt = firstInboundMap.get(conv.id);
      const outboundAt = firstOutboundMap.get(conv.id);
      if (!inboundAt || !outboundAt) continue;

      const seconds =
        (new Date(outboundAt).getTime() - new Date(inboundAt).getTime()) / 1000;
      if (Number.isNaN(seconds) || seconds < 0) continue;

      responseSecondsByConversation.set(conv.id, {
        channel: conv.channel ?? "unknown",
        seconds,
      });
    }
  }

  const slaByChannelMap = new Map<string, number[]>();
  responseSecondsByConversation.forEach(({ channel, seconds }) => {
    const values = slaByChannelMap.get(channel) ?? [];
    values.push(seconds);
    slaByChannelMap.set(channel, values);
  });

  const slaByChannel: SlaByChannel[] = Array.from(
    slaByChannelMap.entries(),
  ).map(([channel, values]) => ({
    channel,
    p50Sec: round2(percentile(values, 0.5) ?? 0),
    p90Sec: round2(percentile(values, 0.9) ?? 0),
    withinSlaPct: round2(
      (values.filter((v) => v <= 120).length / values.length) * 100,
    ),
  }));

  const allSlaValues = Array.from(responseSecondsByConversation.values()).map(
    (x) => x.seconds,
  );

  // Funil básico
  const funnelByChannelMap = new Map<
    string,
    { converted: number; lost: number }
  >();
  for (const c of conversations) {
    const channel = c.channel ?? "unknown";
    if (!funnelByChannelMap.has(channel))
      funnelByChannelMap.set(channel, { converted: 0, lost: 0 });
  }

  for (const e of events) {
    if (e.event_type !== "lead.converted" && e.event_type !== "lead.lost")
      continue;

    const conv = conversationMap.get(e.conversation_id);
    const channel = conv?.channel ?? "unknown";

    const current = funnelByChannelMap.get(channel) ?? {
      converted: 0,
      lost: 0,
    };
    if (e.event_type === "lead.converted") current.converted += 1;
    if (e.event_type === "lead.lost") current.lost += 1;

    funnelByChannelMap.set(channel, current);
  }

  // Ranking de atendentes (conversas atribuídas criadas no período)
  const leadsByUserMap = new Map<string, number>();
  for (const c of conversations) {
    if (!c.assigned_user_id) continue;
    leadsByUserMap.set(
      c.assigned_user_id,
      (leadsByUserMap.get(c.assigned_user_id) ?? 0) + 1,
    );
  }

  const userNamesMap = new Map<string, string>();
  const assignedUserIds = Array.from(leadsByUserMap.keys());
  if (assignedUserIds.length) {
    const { data: usersData, error: usersErr } = await supabase
      .from("clinic_users")
      .select("user_id,name")
      .eq("clinic_id", filters.clinicId)
      .in("user_id", assignedUserIds);
    if (usersErr) throw toError(usersErr, "Falha ao buscar atendentes.");
    for (const row of (usersData ?? []) as ClinicUserRow[]) {
      userNamesMap.set(row.user_id, row.name ?? "Atendente");
    }
  }

  return {
    kpis: {
      leads: conversations.length,
      activeConversations,
      inboundMessages,
      outboundMessages,
      p50FirstResponseSec: percentile(allSlaValues, 0.5),
      p90FirstResponseSec: percentile(allSlaValues, 0.9),
      withinSlaPct: allSlaValues.length
        ? round2(
            (allSlaValues.filter((v) => v <= 120).length /
              allSlaValues.length) *
              100,
          )
        : null,
    },
    leadsByChannel: Array.from(leadsByChannelMap.entries())
      .map(([channel, leads]) => ({ channel, leads }))
      .sort((a, b) => b.leads - a.leads),
    leadsByDepartment: Array.from(leadsByDepartmentMap.entries())
      .map(([department, leads]) => ({ department, leads }))
      .sort((a, b) => b.leads - a.leads),
    leadsByUserId: Array.from(leadsByUserMap.entries())
      .map(([userId, leads]) => ({
        userId,
        userName: userNamesMap.get(userId) ?? "Atendente",
        leads,
      }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 10),
    dailyLeads: Array.from(dailyLeadsMap.entries())
      .map(([day, leads]) => ({ day, leads }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    slaByChannel,
    peakHour: computePeakHour(
      messages
        .filter((m) => m.direction === "inbound")
        .map((m) => m.created_at),
    ),
    funnelByChannel: Array.from(funnelByChannelMap.entries()).map(
      ([channel, v]) => ({
        channel,
        converted: v.converted,
        lost: v.lost,
      }),
    ),
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

/**
 * Backlog sem joins (pra não depender de relacionamento do Supabase).
 */
export const fetchBacklog = async (
  filters: AnalyticsFilters,
): Promise<BacklogItem[]> => {
  const baseConversationsQuery = supabase
    .from("conversations")
    .select(
      "id,channel,department_id,assigned_user_id,status,last_message_at,contact_id",
    )
    .eq("clinic_id", filters.clinicId)
    .in("status", ["open", "pending"])
    .not("last_message_at", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(500);

  const { data, error } = await applyConversationOptionalFilters(
    baseConversationsQuery,
    filters,
  );
  if (error) throw toError(error, "Falha ao buscar backlog (conversas).");

  const conversations = (data ?? []) as unknown as ConversationRow[];
  if (!conversations.length) return [];

  const conversationIds = conversations.map((c) => c.id);

  // last message por conversa (desc)
  const messages = await fetchMessagesByConversationIds(
    conversationIds,
    "conversation_id,direction,created_at,text",
    { orderAsc: false },
  );

  const lastMessageByConversation = new Map<string, MessageRow>();
  for (const m of messages) {
    if (!lastMessageByConversation.has(m.conversation_id)) {
      lastMessageByConversation.set(m.conversation_id, m);
    }
  }

  // buscar departamentos, users e contatos por IDs (sem relacionamento)
  const departmentIds = Array.from(
    new Set(
      conversations.map((c) => c.department_id).filter(Boolean) as string[],
    ),
  );
  const userIds = Array.from(
    new Set(
      conversations.map((c) => c.assigned_user_id).filter(Boolean) as string[],
    ),
  );
  const contactIds = Array.from(
    new Set(conversations.map((c) => c.contact_id).filter(Boolean) as string[]),
  );

  const [depsRes, usersRes, contactsRes] = await Promise.all([
    departmentIds.length
      ? supabase.from("departments").select("id,name").in("id", departmentIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase
          .from("clinic_users")
          .select("user_id,name")
          .in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    contactIds.length
      ? supabase.from("contacts").select("id,name,phone").in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (depsRes.error)
    throw toError(depsRes.error, "Falha ao buscar departamentos (backlog).");
  if (usersRes.error)
    throw toError(usersRes.error, "Falha ao buscar atendentes (backlog).");
  if (contactsRes.error)
    throw toError(contactsRes.error, "Falha ao buscar contatos (backlog).");

  const depsMap = new Map(
    ((depsRes.data ?? []) as DepartmentRow[]).map((d) => [d.id, d.name]),
  );
  const usersMap = new Map(
    ((usersRes.data ?? []) as ClinicUserRow[]).map((u) => [u.user_id, u.name]),
  );
  const contactsMap = new Map(
    ((contactsRes.data ?? []) as ContactRow[]).map((c) => [c.id, c]),
  );

  const now = Date.now();

  return conversations
    .map((c) => {
      const lastMessage = lastMessageByConversation.get(c.id);
      if (!lastMessage || lastMessage.direction !== "inbound") return null;

      const minutesWaiting =
        (now - new Date(lastMessage.created_at).getTime()) / 1000 / 60;

      const contact = c.contact_id ? contactsMap.get(c.contact_id) : null;

      return {
        conversationId: c.id,
        contact: contact?.name ?? contact?.phone ?? "Contato sem nome",
        channel: c.channel ?? "unknown",
        department: c.department_id
          ? (depsMap.get(c.department_id) ?? "Sem departamento")
          : "Sem departamento",
        assignedTo: c.assigned_user_id
          ? (usersMap.get(c.assigned_user_id) ?? "Não atribuído")
          : "Não atribuído",
        lastMessageAt: lastMessage.created_at,
        lastMessageText: lastMessage.text?.trim() || "Mensagem recebida",
        minutesWaiting: round2(minutesWaiting),
      };
    })
    .filter((x): x is BacklogItem => Boolean(x))
    .sort((a, b) => b.minutesWaiting - a.minutesWaiting);
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
