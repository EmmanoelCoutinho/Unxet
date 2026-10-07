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
  type BacklogItem,
  type SatisfactionSummary,
} from "../services/inboxAnalytics";
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

const dateInputValue = (date: Date) => date.toISOString().slice(0, 10);

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

const KpiCard = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) => (
  <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-2">
      <p className="text-sm text-slate-500">{label}</p>
    </div>
    <p className="mt-3 text-center text-3xl font-semibold text-slate-900">
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
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [satisfaction, setSatisfaction] = useState<SatisfactionSummary | null>(
    null,
  );

  const [departments, setDepartments] = useState<
    Array<{ id: string; name: string }>
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

    const urlStart = searchParams.get("start") ?? defaults.start;
    const urlEnd = searchParams.get("end") ?? defaults.end;

    const departmentId = searchParams.get("department_id") || undefined;
    const assignedUserId = searchParams.get("assigned_user_id") || undefined;

    return {
      clinicId,
      start: new Date(`${urlStart}T00:00:00`).toISOString(),
      end: new Date(`${urlEnd}T23:59:59`).toISOString(),
      channels: searchParams.getAll("channel"),
      departmentId,
      assignedUserId,
    };
  }, [clinicId, searchParams, defaults.end, defaults.start]);

  useEffect(() => {
    const nextStart = searchParams.get("start") ?? defaults.start;
    const nextEnd = searchParams.get("end") ?? defaults.end;

    setDraftStart(nextStart);
    setDraftEnd(nextEnd);
    setDraftChannels(searchParams.getAll("channel"));
    setDraftDepartmentId(searchParams.get("department_id") ?? "");
    setDraftAssignedUserId(searchParams.get("assigned_user_id") ?? "");
  }, [defaults.end, defaults.start, searchParams]);

  useEffect(() => {
    if (!clinicId) return;

    Promise.all([
      supabase
        .from("departments")
        .select("id,name")
        .eq("clinic_id", clinicId)
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

        setAnalytics(analyticsResult);
        setBacklog(backlogResult);
        setSatisfaction(satisfactionResult);
      } catch (fetchError: unknown) {
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : typeof fetchError === "object" && fetchError !== null && "message" in fetchError
            ? String((fetchError as { message: unknown }).message)
            : "Erro ao carregar analytics.";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [filters]);

  const applyFilters = () => {
    const params = new URLSearchParams();
    params.set("start", draftStart);
    params.set("end", draftEnd);
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
    return backlog.slice(startIndex, startIndex + 20);
  }, [backlog, page]);

  useEffect(() => {
    setPage(1);
  }, [backlog]);

  const totalPages = Math.max(1, Math.ceil(backlog.length / 20));
  const hasData = !!analytics && analytics.kpis.leads > 0;
  const backlogTotal = backlog.length;

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* FILTROS */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <PreTitleIcon icon={MessageCircleIcon} />
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">
                  Análise & Atendimento
                </h1>
                <p className="text-sm text-slate-500">
                  Visão executiva, decisão por canal/departamento e ação imediata no backlog
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={applyFilters}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                Aplicar
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-5">
            <input
              type="date"
              value={draftStart}
              onChange={(event) => setDraftStart(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="date"
              value={draftEnd}
              onChange={(event) => setDraftEnd(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />

            <div className="rounded-md border border-slate-300 p-2">
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
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Todos departamentos</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>

            {/* Atualizado: Select de Atendentes com tratamento de fallback amigável */}
            <select
              value={draftAssignedUserId}
              onChange={(event) => setDraftAssignedUserId(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
          <section className="grid gap-4 md:grid-cols-4">
            {loading || !analytics ? (
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

          <section className="grid gap-4 md:grid-cols-4">
            {loading || !analytics ? (
              Array.from({ length: 4 }).map((_, index) => <KpiSkeleton key={index} />)
            ) : (
              <>
                <KpiCard label="Conversas ativas" value={analytics.kpis.activeConversations} />
                <KpiCard
                  label="Tempo típico de 1ª resposta"
                  value={formatSeconds(analytics.kpis.p50FirstResponseSec)}
                />
                <KpiCard
                  label="90% respondem em até"
                  value={formatSeconds(analytics.kpis.p90FirstResponseSec)}
                />
                <KpiCard
                  label="Dentro do SLA (até 2 min)"
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
          <section className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">
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
            <section className="grid gap-4 lg:grid-cols-2">
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

                      <div className="grid gap-6 lg:grid-cols-2">
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
                  title="Tempo de 1ª resposta por canal"
                  subtitle="Comparativo por canal (tempo alto = 90% respondem em até)."
                />
                <HorizontalBars
                  rows={analytics.slaByChannel.map((item) => ({
                    canal: CHANNEL_LABEL[item.channel] ?? item.channel,
                    tempo: Math.round(item.p90Sec),
                  }))}
                  labelKey="canal"
                  valueKey="tempo"
                  color="#14b8a6"
                />
                <p className="mt-3 text-xs text-slate-500">
                  A barra usa o tempo “alto” (90%). O tempo “típico” (50%) fica disponível no detalhe.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                        <th className="px-2 py-2">Canal</th>
                        <th className="px-2 py-2">Tempo típico</th>
                        <th className="px-2 py-2">Tempo alto</th>
                        <th className="px-2 py-2">Dentro SLA</th>
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
                Total: <span className="font-semibold text-slate-900">{backlogTotal}</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
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
                        className="px-2 py-8 text-center text-slate-500"
                        colSpan={6}
                      >
                        Sem backlog para os filtros atuais.
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
                        <td className="px-2 py-2 font-semibold text-slate-700">{item.minutesWaiting}</td>
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