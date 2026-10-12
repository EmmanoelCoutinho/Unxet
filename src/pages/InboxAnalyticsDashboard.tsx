import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useClinic } from "../contexts/ClinicContext";
import { supabase } from "../lib/supabaseClient";
import {
  fetchBacklog,
  fetchInboxAnalytics,
  fetchSatisfactionSummary,
  type AnalyticsFilters,
  type AnalyticsResponse,
  type BacklogResult,
  type SatisfactionSummary,
} from "../services/inboxAnalytics";
import { formatHourRange, type PeakHourSummary } from "../lib/peakHour";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { MessageCircleIcon } from "lucide-react";

const CHANNEL_OPTIONS = ["whatsapp", "instagram", "messenger"];
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  unknown: "Outro",
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "#22c55e",
  instagram: "#ec4899",
  messenger: "#3b82f6",
  unknown: "#94a3b8",
};

// Data local (toISOString usaria UTC e viraria o dia às 21h no Brasil)
const dateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Aceita só AAAA-MM-DD válido; vazio ou texto solto na URL caem no padrão
const parseDateParam = (value: string | null, fallback: string) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  return Number.isNaN(new Date(`${value}T00:00:00`).getTime())
    ? fallback
    : value;
};

// Período sempre em ordem: se vier invertido, troca as pontas
const resolveDateRange = (
  start: string | null,
  end: string | null,
  defaults: { start: string; end: string },
) => {
  const safeStart = parseDateParam(start, defaults.start);
  const safeEnd = parseDateParam(end, defaults.end);
  return safeStart <= safeEnd
    ? { start: safeStart, end: safeEnd }
    : { start: safeEnd, end: safeStart };
};

const EMPTY_BACKLOG: BacklogResult = {
  items: [],
  total: 0,
  slaBreachedTotal: 0,
};

const defaultDateRange = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);

  return {
    start: dateInputValue(start),
    end: dateInputValue(end),
  };
};

const formatSeconds = (seconds: number | null) => {
  if (seconds === null || Number.isNaN(seconds)) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

// "2 min", "1h 30 min": para metas e textos corridos
const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes} min` : `${hours}h`;
};

const KpiSkeleton = () => (
  <div className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
);

const Pill = ({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full px-2 py-1 text-xs transition-colors ${
      active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
    }`}
  >
    {label}
  </button>
);

const SectionHeader = ({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) => (
  <div className="mb-3 flex items-start justify-between gap-3">
    <div>
      <h2 className="text-lg font-semibold text-slate-700">{title}</h2>
      {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
    </div>
    {right}
  </div>
);

const HorizontalBars = ({
  rows,
  labelKey,
  valueKey,
  color,
}: {
  rows: Array<Record<string, string | number>>;
  labelKey: string;
  valueKey: string;
  color?: string;
}) => {
  const max = Math.max(1, ...rows.map((row) => Number(row[valueKey] || 0)));

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">Sem dados no período.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const label = String(row[labelKey] || "-");
        const value = Number(row[valueKey] || 0);
        const width = Math.max(6, (value / max) * 100);

        return (
          <div key={`${label}-${index}`} className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="truncate">{label}</span>
              <span className="font-medium text-slate-800">{value}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${width}%`,
                  backgroundColor: color ?? "#2563eb",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const formatDayBR = (yyyyMmDd: string) => {
  if (!yyyyMmDd || yyyyMmDd.length < 10) return "-";
  const [y, m, d] = yyyyMmDd.slice(0, 10).split("-");
  if (!y || !m || !d) return yyyyMmDd;
  return `${d}/${m}/${y}`;
};

const DailyLeadsChart = ({
  rows,
}: {
  rows: Array<{ day: string; leads: number }>;
}) => {
  const max = Math.max(1, ...rows.map((row) => row.leads));

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">Sem dados no período.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.day} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs text-slate-600">
            {formatDayBR(row.day)}
          </span>
          <div className="h-2 flex-1 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-cyan-500 transition-all duration-500"
              style={{ width: `${Math.max(4, (row.leads / max) * 100)}%` }}
            />
          </div>
          <span className="w-8 text-right text-xs font-medium text-slate-700">
            {row.leads}
          </span>
        </div>
      ))}
    </div>
  );
};

const PeakHourChart = ({ summary }: { summary: PeakHourSummary }) => {
  if (summary.peakHour === null) {
    return <p className="text-sm text-slate-500">Sem dados no período.</p>;
  }

  const max = Math.max(1, summary.peakMessages);

  return (
    <div>
      <div className="flex h-40 items-end gap-0.5 sm:gap-1">
        {summary.byHour.map((item) => {
          const isPeak = item.hour === summary.peakHour;
          return (
            <div
              key={item.hour}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${formatHourRange(item.hour)}: ${item.messages} mensagens`}
            >
              <div
                className={`w-full rounded-t transition-all duration-500 ${
                  isPeak ? "bg-orange-500" : "bg-blue-200"
                }`}
                style={{
                  height: `${item.messages > 0 ? Math.max(3, (item.messages / max) * 100) : 0}%`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-0.5 border-t border-slate-200 pt-1 sm:gap-1">
        {summary.byHour.map((item) => (
          <span
            key={item.hour}
            className="flex-1 text-center text-[10px] text-slate-500"
          >
            {item.hour % 3 === 0 ? `${item.hour}h` : ""}
          </span>
        ))}
      </div>
    </div>
  );
};

const KpiCard = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) => (
  <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
    <div className="flex items-start justify-between gap-2">
      <p className="text-xs text-slate-500 sm:text-sm">{label}</p>
    </div>
    <p className="mt-auto pt-3 text-center text-2xl font-semibold text-slate-900 sm:text-3xl">
      {value}
    </p>
  </article>
);

export const InboxAnalyticsDashboard: React.FC = () => {
  const { clinicId } = useClinic();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const defaults = useMemo(() => defaultDateRange(), []);

  const [draftStart, setDraftStart] = useState(
    searchParams.get("start") ?? defaults.start,
  );
  const [draftEnd, setDraftEnd] = useState(
    searchParams.get("end") ?? defaults.end,
  );
  const [draftChannels, setDraftChannels] = useState<string[]>(
    searchParams.getAll("channel"),
  );
  const [draftDepartmentId, setDraftDepartmentId] = useState(
    searchParams.get("department_id") ?? "",
  );
  const [draftAssignedUserId, setDraftAssignedUserId] = useState(
    searchParams.get("assigned_user_id") ?? "",
  );

  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [backlog, setBacklog] = useState<BacklogResult>(EMPTY_BACKLOG);
  const [satisfaction, setSatisfaction] = useState<SatisfactionSummary | null>(
    null,
  );

  const [departments, setDepartments] = useState<
    Array<{ id: string; name: string; is_active?: boolean }>
  >([]);
  
  // Atualizado: Definição do estado incluindo name e email para tratamento seguro
  const [users, setUsers] = useState<Array<{ user_id: string; name: string; email?: string }>>(
    [],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const filters = useMemo<AnalyticsFilters | null>(() => {
    if (!clinicId) return null;

    const range = resolveDateRange(
      searchParams.get("start"),
      searchParams.get("end"),
      defaults,
    );
    // Fim exclusivo: início do dia seguinte ao último dia selecionado
    const endExclusive = new Date(`${range.end}T00:00:00`);
    endExclusive.setDate(endExclusive.getDate() + 1);

    const departmentId = searchParams.get("department_id") || undefined;
    const assignedUserId = searchParams.get("assigned_user_id") || undefined;

    return {
      clinicId,
      start: new Date(`${range.start}T00:00:00`).toISOString(),
      end: endExclusive.toISOString(),
      channels: searchParams.getAll("channel"),
      departmentId,
      assignedUserId,
    };
  }, [clinicId, searchParams, defaults.end, defaults.start]);

  useEffect(() => {
    const range = resolveDateRange(
      searchParams.get("start"),
      searchParams.get("end"),
      defaults,
    );

    setDraftStart(range.start);
    setDraftEnd(range.end);
    setDraftChannels(searchParams.getAll("channel"));
    setDraftDepartmentId(searchParams.get("department_id") ?? "");
    setDraftAssignedUserId(searchParams.get("assigned_user_id") ?? "");
  }, [defaults.end, defaults.start, searchParams]);

  useEffect(() => {
    if (!clinicId) return;

    Promise.all([
      supabase
        .from("departments")
        // Inativos continuam no filtro (têm histórico), mas identificados
        .select("id,name,is_active")
        .eq("clinic_id", clinicId)
        .order("is_active", { ascending: false })
        .order("name"),
      supabase
        .from("clinic_users")
        .select("user_id,name,email") // Atualizado: Buscando também o e-mail preventivamente
        .eq("clinic_id", clinicId)
        .order("name"),
    ]).then(([depRes, usersRes]) => {
      if (!depRes.error) setDepartments(depRes.data ?? []);
      if (!usersRes.error) setUsers(usersRes.data ?? []);
    });
  }, [clinicId]);

  useEffect(() => {
    if (!filters) return;

    // Filtros trocados no meio do carregamento: a resposta antiga é descartada
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const [analyticsResult, backlogResult, satisfactionResult] =
          await Promise.all([
            fetchInboxAnalytics(filters),
            fetchBacklog(filters),
            // A pesquisa é opcional: uma falha aqui não derruba o painel
            fetchSatisfactionSummary(filters).catch((surveyError) => {
              console.error("Erro ao carregar pesquisa de satisfação:", surveyError);
              return null;
            }),
          ]);

        if (cancelled) return;
        setAnalytics(analyticsResult);
        setBacklog(backlogResult);
        setSatisfaction(satisfactionResult);
      } catch (fetchError: unknown) {
        if (cancelled) return;
        console.error("Erro ao carregar o painel:", fetchError);
        // Não deixa números do filtro anterior na tela como se fossem os atuais
        setAnalytics(null);
        setBacklog(EMPTY_BACKLOG);
        setSatisfaction(null);
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : typeof fetchError === "object" && fetchError !== null && "message" in fetchError
            ? String((fetchError as { message: unknown }).message)
            : "Erro ao carregar analytics.";
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const applyFilters = () => {
    const params = new URLSearchParams();
    const range = resolveDateRange(draftStart, draftEnd, defaults);
    params.set("start", range.start);
    params.set("end", range.end);
    draftChannels.forEach((channel) => params.append("channel", channel));

    if (draftDepartmentId) params.set("department_id", draftDepartmentId);
    if (draftAssignedUserId)
      params.set("assigned_user_id", draftAssignedUserId);

    setSearchParams(params);
  };

  const toggleChannel = (channel: string) => {
    setDraftChannels((previous) =>
      previous.includes(channel)
        ? previous.filter((item) => item !== channel)
        : [...previous, channel],
    );
  };

  const backlogPage = useMemo(() => {
    const startIndex = (page - 1) * 20;
    return backlog.items.slice(startIndex, startIndex + 20);
  }, [backlog, page]);

  useEffect(() => {
    setPage(1);
  }, [backlog]);

  const totalPages = Math.max(1, Math.ceil(backlog.items.length / 20));
  // Mensagens do período também contam: pode haver movimento sem lead novo
  const hasData =
    !!analytics &&
    analytics.kpis.leads +
      analytics.kpis.inboundMessages +
      analytics.kpis.outboundMessages >
      0;
  const backlogTotal = backlog.total;

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-3 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* FILTROS */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <PreTitleIcon icon={MessageCircleIcon} />
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
                  Análise & Atendimento
                </h1>
                <p className="text-sm text-slate-500">
                  Visão executiva, decisão por canal/departamento e ação imediata no backlog
                </p>
              </div>
            </div>
            <div className="hidden gap-2 sm:flex">
              <button
                type="button"
                onClick={applyFilters}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                Aplicar
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 2xl:grid-cols-5">
            <input
              type="date"
              value={draftStart}
              onChange={(event) => setDraftStart(event.target.value)}
              aria-label="Data inicial"
              className="w-full min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="date"
              value={draftEnd}
              onChange={(event) => setDraftEnd(event.target.value)}
              aria-label="Data final"
              className="w-full min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />

            <div className="col-span-2 rounded-md border border-slate-300 p-2 2xl:col-span-1">
              <p className="mb-2 text-xs text-slate-500">Canal</p>
              <div className="flex flex-wrap gap-2">
                {CHANNEL_OPTIONS.map((channel) => (
                  <Pill
                    key={channel}
                    active={draftChannels.includes(channel)}
                    label={CHANNEL_LABEL[channel]}
                    onClick={() => toggleChannel(channel)}
                  />
                ))}
              </div>
            </div>

            <select
              value={draftDepartmentId}
              onChange={(event) => setDraftDepartmentId(event.target.value)}
              className="col-span-2 min-w-0 sm:col-span-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Todos departamentos</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                  {department.is_active === false ? " (inativo)" : ""}
                </option>
              ))}
            </select>

            {/* Atualizado: Select de Atendentes com tratamento de fallback amigável */}
            <select
              value={draftAssignedUserId}
              onChange={(event) => setDraftAssignedUserId(event.target.value)}
              className="col-span-2 min-w-0 sm:col-span-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Todos atendentes</option>
              {users.map((user) => {
                const displayName = user.name?.trim() || user.email?.split("@")[0] || "Usuário sem nome";
                return (
                  <option key={user.user_id} value={user.user_id}>
                    {displayName}
                  </option>
                );
              })}
            </select>

            <button
              type="button"
              onClick={applyFilters}
              className="col-span-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:hidden"
            >
              Aplicar filtros
            </button>
          </div>
        </section>

        {/* ERRO */}
        {error ? (
          <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            <p className="font-medium">Erro ao carregar dados</p>
            <p className="text-sm">{error}</p>
            <button
              type="button"
              onClick={applyFilters}
              className="mt-3 rounded-md bg-red-600 px-3 py-2 text-sm text-white transition-colors hover:bg-red-700"
            >
              Tentar novamente
            </button>
          </section>
        ) : null}

        {/* CAMADA 1: RESUMO EXECUTIVO */}
        <section className="space-y-3">
          <SectionHeader
            title="Resumo executivo"
            subtitle="Principais indicadores do período para acompanhar volume, atendimento e backlog."
          />
          <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {error ? null : loading || !analytics ? (
              Array.from({ length: 4 }).map((_, index) => <KpiSkeleton key={index} />)
            ) : (
              <>
                <KpiCard label="Novos leads" value={analytics.kpis.leads} />
                <KpiCard label="Mensagens sem resposta" value={backlogTotal} />
                <KpiCard label="Mensagens recebidas" value={analytics.kpis.inboundMessages} />
                <KpiCard label="Mensagens enviadas" value={analytics.kpis.outboundMessages} />
              </>
            )}
          </section>

          <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {error ? null : loading || !analytics ? (
              Array.from({ length: 4 }).map((_, index) => <KpiSkeleton key={index} />)
            ) : (
              <>
                <KpiCard label="Conversas ativas agora"value={analytics.kpis.activeConversations} />
                <KpiCard
                  label="Espera comum pela 1ª resposta"
                  value={formatSeconds(analytics.kpis.p50FirstResponseSec)}
                />
                <KpiCard
                  label="Espera longa pela 1ª resposta"
                  value={formatSeconds(analytics.kpis.p90FirstResponseSec)}
                />
                <KpiCard
                  label={`Respondidas em até ${formatDuration(analytics.slaThresholdSec)}`}
                  value={
                    analytics.kpis.withinSlaPct !== null
                      ? `${analytics.kpis.withinSlaPct}%`
                      : "-"
                  }
                />
              </>
            )}
          </section>
        </section>

        {!loading && !error && !hasData ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-8 text-center text-slate-600">
            <p className="font-medium">Nenhum dado para o período selecionado.</p>
            <p className="text-sm">Tente ampliar o período.</p>
          </section>
        ) : null}

        {/* CAMADA 2: DECISÃO */}
        {analytics ? (
          <section className="space-y-3">
            <SectionHeader
              title="Decisão"
              subtitle="Entenda volume e distribuição por canal/departamento e a tendência do período."
            />
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <SectionHeader title="Leads por canal" />
                <div className="space-y-3">
                  {analytics.leadsByChannel.length === 0 ? (
                    <p className="text-sm text-slate-500">Sem dados no período.</p>
                  ) : (
                    analytics.leadsByChannel.map((item) => (
                      <div key={item.channel} className="space-y-1">
                        <div className="flex items-center justify-between text-xs text-slate-600">
                          <span>{CHANNEL_LABEL[item.channel] ?? item.channel}</span>
                          <span>{item.leads}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.max(
                                6,
                                (item.leads / Math.max(1, analytics.kpis.leads)) * 100,
                              )}%`,
                              backgroundColor:
                                CHANNEL_COLORS[item.channel] ?? CHANNEL_COLORS.unknown,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </article>

              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <SectionHeader title="Leads por departamento" />
                <HorizontalBars
                  rows={analytics.leadsByDepartment}
                  labelKey="department"
                  valueKey="leads"
                />
              </article>

              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <SectionHeader title="Top Atendentes" subtitle="Distribuição de novos leads por responsável" />
                <HorizontalBars
                  rows={analytics.leadsByUserId}
                  labelKey="userName"
                  valueKey="leads"
                  color="#f59e0b"
                />
              </article>

              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <SectionHeader title="Evolução diária de leads" />
                <DailyLeadsChart rows={analytics.dailyLeads} />
              </article>

              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
                <SectionHeader
                  title="Horário de pico"
                  subtitle="Mensagens recebidas por hora do dia, somando todo o período selecionado."
                />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
                    <div className="rounded-lg border border-orange-100 bg-orange-50 p-3">
                      <p className="text-xs text-slate-500">Horário de pico</p>
                      <p className="mt-1 text-xl font-semibold text-orange-600">
                        {formatHourRange(analytics.peakHour.peakHour)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Mensagens no pico</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">
                        {analytics.peakHour.peakMessages}
                        {analytics.peakHour.peakSharePct !== null ? (
                          <span className="ml-1 text-sm font-normal text-slate-500">
                            ({Math.round(analytics.peakHour.peakSharePct)}% do total)
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <PeakHourChart summary={analytics.peakHour} />
                </div>
              </article>

              {satisfaction ? (
                <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
                  <SectionHeader
                    title="Satisfação dos clientes"
                    subtitle="Notas de 1 a 5 enviadas pelos clientes após o encerramento do atendimento."
                  />
                  {satisfaction.sent === 0 ? (
                    <p className="text-sm text-slate-500">
                      Nenhuma pesquisa enviada no período. Ative a pesquisa em
                      Configurações → Automações do chat.
                    </p>
                  ) : (
                    <div className="space-y-5">
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {[
                          {
                            label: "Nota média",
                            value:
                              satisfaction.averageScore !== null
                                ? satisfaction.averageScore.toFixed(1)
                                : "-",
                          },
                          {
                            label: "Satisfeitos (4 e 5)",
                            value:
                              satisfaction.csatPct !== null
                                ? `${Math.round(satisfaction.csatPct)}%`
                                : "-",
                          },
                          {
                            label: "Taxa de resposta",
                            value:
                              satisfaction.responseRatePct !== null
                                ? `${Math.round(satisfaction.responseRatePct)}%`
                                : "-",
                          },
                          {
                            label: "Respondidas / enviadas",
                            value: `${satisfaction.answered} / ${satisfaction.sent}`,
                          },
                        ].map((kpi) => (
                          <div
                            key={kpi.label}
                            className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                          >
                            <p className="text-xs text-slate-500">{kpi.label}</p>
                            <p className="mt-1 text-xl font-semibold text-slate-900">
                              {kpi.value}
                            </p>
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <div>
                          <p className="mb-3 text-sm font-medium text-slate-700">
                            Distribuição das notas
                          </p>
                          <HorizontalBars
                            rows={[...satisfaction.distribution]
                              .reverse()
                              .map((item) => ({
                                nota: `Nota ${item.score}`,
                                respostas: item.count,
                              }))}
                            labelKey="nota"
                            valueKey="respostas"
                            color="#8b5cf6"
                          />
                        </div>
                        <div>
                          <p className="mb-3 text-sm font-medium text-slate-700">
                            Nota média por atendente
                          </p>
                          <HorizontalBars
                            rows={satisfaction.byAgent.slice(0, 10).map((item) => ({
                              atendente: `${item.name} (${item.answered})`,
                              media: item.averageScore,
                            }))}
                            labelKey="atendente"
                            valueKey="media"
                            color="#8b5cf6"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              ) : null}

              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
                <SectionHeader
                  title="Tempo até a primeira resposta"
                  subtitle="Quanto tempo o cliente espera, depois da primeira mensagem dele, até um atendente responder. Respostas automáticas do bot não contam."
                />
                {analytics.slaByChannel.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    Nenhuma conversa do período recebeu resposta de um atendente ainda.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {analytics.slaByChannel.map((row) => (
                      <li key={row.channel}>
                        <span className="font-medium text-slate-900">
                          {CHANNEL_LABEL[row.channel] ?? row.channel}:
                        </span>{" "}
                        metade dos clientes foi respondida em até{" "}
                        <span className="font-medium">{formatSeconds(row.p50Sec)}</span>
                        {" "}e 9 em cada 10 em até{" "}
                        <span className="font-medium">{formatSeconds(row.p90Sec)}</span>.
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="whitespace-nowrap border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                        <th className="px-2 py-2">Canal</th>
                        <th className="px-2 py-2">Espera comum</th>
                        <th className="px-2 py-2">Espera longa</th>
                        <th className="px-2 py-2">Dentro da meta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.slaByChannel.map((row) => (
                        <tr key={row.channel} className="border-b border-slate-100">
                          <td className="px-2 py-2">
                            {CHANNEL_LABEL[row.channel] ?? row.channel}
                          </td>
                          <td className="px-2 py-2">{formatSeconds(row.p50Sec)}</td>
                          <td className="px-2 py-2">{formatSeconds(row.p90Sec)}</td>
                          <td className="px-2 py-2">{row.withinSlaPct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="mt-4 space-y-1 text-xs text-slate-500">
                  <div>
                    <dt className="inline font-semibold text-slate-600">Espera comum: </dt>
                    <dd className="inline">
                      metade dos clientes foi respondida nesse tempo ou antes. É o que a maioria encontra.
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-slate-600">Espera longa: </dt>
                    <dd className="inline">
                      9 em cada 10 clientes foram respondidos nesse tempo ou antes; 1 em cada 10 esperou mais.
                      Se ela for muito maior que a espera comum, há conversas ficando para trás.
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-slate-600">Dentro da meta: </dt>
                    <dd className="inline">
                      conversas respondidas em até {formatDuration(analytics.slaThresholdSec)}
                      {" "}(prazo de SLA definido em Configurações, ou 2 min quando não há).
                    </dd>
                  </div>
                </dl>
              </article>
            </section>
          </section>
        ) : null}

        {/* CAMADA 3: AÇÃO */}
        <section className="space-y-3">
          <SectionHeader
            title="Clique em uma conversa para abrir o atendimento"
            subtitle="Conversas que exigem atenção imediata e estão aguardando resposta"
          />

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">
                  Mensagens sem resposta
                </h2>
                <p className="text-xs text-slate-500">
                  Clique em uma linha para abrir a conversa.
                </p>
              </div>
              <div className="text-sm text-slate-600">
                Total:{" "}
                <span className="font-semibold text-slate-900">
                  {error ? "-" : backlogTotal}
                </span>
                {!error && backlog.slaBreachedTotal > 0 ? (
                  <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                    {backlog.slaBreachedTotal} com SLA estourado
                  </span>
                ) : null}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="whitespace-nowrap border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th className="px-2 py-2">Contato</th>
                    <th className="px-2 py-2">Canal</th>
                    <th className="px-2 py-2">Departamento</th>
                    <th className="px-2 py-2">Responsável</th>
                    <th className="px-2 py-2">Última mensagem</th>
                    <th className="px-2 py-2">Min sem resposta</th>
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <tr key={index} className="border-b border-slate-100">
                        <td className="px-2 py-3" colSpan={6}>
                          <div className="h-6 animate-pulse rounded bg-slate-100" />
                        </td>
                      </tr>
                    ))
                  ) : backlogPage.length === 0 ? (
                    <tr>
                      <td
                        className="px-2 py-6 sm:py-8 text-center text-slate-500"
                        colSpan={6}
                      >
                        {error
                          ? "Não foi possível carregar as conversas aguardando resposta."
                          : "Sem backlog para os filtros atuais."}
                      </td>
                    </tr>
                  ) : (
                    backlogPage.map((item) => (
                      <tr
                        key={item.conversationId}
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                        onClick={() => navigate(`/inbox/chat/${item.conversationId}`)}
                      >
                        <td className="px-2 py-2 font-medium text-slate-700">{item.contact}</td>
                        <td className="px-2 py-2">
                          {CHANNEL_LABEL[item.channel] ?? item.channel}
                        </td>
                        <td className="px-2 py-2">{item.department}</td>
                        <td className="px-2 py-2">{item.assignedTo}</td>
                        <td className="px-2 py-2">
                          <p className="max-w-xs truncate text-slate-700">{item.lastMessageText}</p>
                          <p className="text-xs text-slate-400">
                            {new Date(item.lastMessageAt).toLocaleString()}
                          </p>
                        </td>
                        <td className="px-2 py-2 font-semibold text-slate-700">
                          {item.minutesWaiting}
                          {item.slaBreached ? (
                            <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                              SLA estourado
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-white"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
              >
                Anterior
              </button>
              <span className="text-slate-600">
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-white"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}
              >
                Próxima
              </button>
            </div>
          </section>
        </section>
      </div>
    </div>
  );
};