import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOpenConversation } from "../modules/floatingChats/useOpenConversation";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  FileBarChartIcon,
  RefreshCwIcon,
} from "lucide-react";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { useClinic } from "../contexts/ClinicContext";
import { supabase } from "../lib/supabaseClient";
import { fetchBacklog, type BacklogResult } from "../services/inboxAnalytics";
import { fetchOperationalNow } from "../modules/reports/api";
import {
  channelLabel,
  compareValues,
  formatDuration,
  formatInt,
  formatPct,
  formatTrend,
} from "../modules/reports/format";
import type { LiveTeamRow, OperationalNow, PeriodKpis } from "../modules/reports/types";

/**
 * Painel: como está o atendimento AGORA (fila, metas estouradas, equipe) e os
 * números de hoje. Análise de período, comparativos e exportação ficam na tela
 * Relatórios; os números de hoje vêm da mesma função do banco que ela usa.
 */

const CHANNEL_OPTIONS = ["whatsapp", "instagram", "messenger"];
const REFRESH_MS = 60_000;
const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

// Números das páginas com reticências: 1 … 4 5 6 … 12
const pageNumbers = (current: number, total: number): Array<number | "gap"> => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push("gap");
    result.push(p);
  });
  return result;
};

const Pagination = ({
  page,
  pageSize,
  totalItems,
  totalInQueue,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  // Total real da fila (a lista carregada traz no máximo 500)
  totalInQueue: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(totalItems, page * pageSize);
  const navButton =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-300 px-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3 text-slate-600">
        <span>
          Mostrando <span className="font-medium text-slate-900">{from}–{to}</span> de{" "}
          <span className="font-medium text-slate-900">{formatInt(totalItems)}</span>
          {totalInQueue > totalItems ? ` (os ${formatInt(totalItems)} que esperam há mais tempo, de ${formatInt(totalInQueue)})` : ""}
        </span>
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Por página</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <nav className="flex items-center gap-1" aria-label="Paginação da fila">
        <button type="button" className={navButton} onClick={() => onPageChange(1)} disabled={page === 1} aria-label="Primeira página">
          <ChevronsLeftIcon className="h-4 w-4" />
        </button>
        <button type="button" className={navButton} onClick={() => onPageChange(page - 1)} disabled={page === 1} aria-label="Página anterior">
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        {pageNumbers(page, totalPages).map((item, index) =>
          item === "gap" ? (
            <span key={`gap-${index}`} className="px-1 text-slate-400">…</span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-current={item === page ? "page" : undefined}
              className={
                item === page
                  ? "inline-flex h-8 min-w-8 items-center justify-center rounded-md bg-blue-600 px-2 text-sm font-medium text-white"
                  : navButton
              }
            >
              {item}
            </button>
          ),
        )}
        <button type="button" className={navButton} onClick={() => onPageChange(page + 1)} disabled={page === totalPages} aria-label="Próxima página">
          <ChevronRightIcon className="h-4 w-4" />
        </button>
        <button type="button" className={navButton} onClick={() => onPageChange(totalPages)} disabled={page === totalPages} aria-label="Última página">
          <ChevronsRightIcon className="h-4 w-4" />
        </button>
      </nav>
    </div>
  );
};

const EMPTY_BACKLOG: BacklogResult = { items: [], total: 0, slaBreachedTotal: 0 };

const secondsSince = (iso: string | null, nowMs: number) =>
  iso ? Math.max(0, (nowMs - new Date(iso).getTime()) / 1000) : null;

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const lastSeenLabel = (row: LiveTeamRow, nowMs: number) => {
  if (row.online) return "Online agora";
  const seconds = secondsSince(row.lastSeenAt, nowMs);
  if (seconds === null) return "Nunca acessou";
  return `Visto há ${formatDuration(seconds)}`;
};

// Re-renderiza a cada 30s para os "há X min" andarem entre uma atualização e outra
const useNow = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
};

const NowCard = ({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "warning" | "success";
}) => {
  const toneClass = {
    default: "border-slate-200 bg-white",
    danger: "border-red-200 bg-red-50",
    warning: "border-amber-200 bg-amber-50",
    success: "border-emerald-200 bg-emerald-50",
  }[tone];
  const valueClass = {
    default: "text-slate-900",
    danger: "text-red-700",
    warning: "text-amber-700",
    success: "text-emerald-700",
  }[tone];

  return (
    <article className={`flex flex-col rounded-xl border p-4 shadow-sm ${toneClass}`}>
      <p className="text-xs text-slate-500 sm:text-sm">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${valueClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </article>
  );
};

const TodayCard = ({
  label,
  kpi,
  today,
  yesterday,
  format,
  higherIsBetter = true,
}: {
  label: string;
  kpi: keyof PeriodKpis;
  today: PeriodKpis;
  yesterday: PeriodKpis;
  format: (value: number | null) => string;
  higherIsBetter?: boolean;
}) => {
  const current = today[kpi] as number | null;
  const previous = yesterday[kpi] as number | null;
  const trend = compareValues(current, previous, higherIsBetter);
  const trendClass =
    trend.good === null ? "text-slate-500" : trend.good ? "text-emerald-600" : "text-red-600";

  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500 sm:text-sm">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{format(current)}</p>
      <p className="mt-1 text-xs">
        <span className={`font-semibold ${trendClass}`}>
          {trend.direction === "up" ? "↑ " : trend.direction === "down" ? "↓ " : ""}
          {formatTrend(trend)}
        </span>
        <span className="text-slate-400"> · ontem {format(previous)}</span>
      </p>
    </article>
  );
};

const HourlyChart = ({ counts, currentHour }: { counts: number[]; currentHour: number }) => {
  const max = Math.max(1, ...counts);
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return <p className="text-sm text-slate-500">Nenhuma mensagem recebida hoje ainda.</p>;
  }
  return (
    <div>
      <div className="flex h-36 items-end gap-0.5 sm:gap-1">
        {counts.map((value, hour) => (
          <div
            key={hour}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${hour}h às ${hour + 1}h: ${value} mensagens`}
          >
            <div
              className={`w-full rounded-t ${
                hour === currentHour ? "bg-[#00D374]" : hour > currentHour ? "bg-slate-100" : "bg-[#0066FF]/70"
              }`}
              style={{ height: `${value > 0 ? Math.max(3, (value / max) * 100) : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 border-t border-slate-200 pt-1 sm:gap-1">
        {counts.map((_, hour) => (
          <span key={hour} className="flex-1 text-center text-[10px] text-slate-500">
            {hour % 3 === 0 ? `${hour}h` : ""}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {formatInt(total)} mensagens de clientes hoje · em verde, a hora atual
      </p>
    </div>
  );
};

const TeamNow = ({ team, nowMs }: { team: LiveTeamRow[]; nowMs: number }) => {
  if (team.length === 0) return <p className="text-sm text-slate-500">Nenhuma pessoa na equipe.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="whitespace-nowrap border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="px-2 py-2">Pessoa</th>
            <th className="px-2 py-2 text-right">Ativas</th>
            <th className="px-2 py-2 text-right">Esperando</th>
            <th className="px-2 py-2 text-right">Mais antiga</th>
            <th className="px-2 py-2 text-right">Finalizadas hoje</th>
          </tr>
        </thead>
        <tbody>
          {team.map((row) => {
            const oldest = secondsSince(row.oldestWaitingAt, nowMs);
            return (
              <tr key={row.userId} className="border-b border-slate-100">
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${row.online ? "bg-emerald-500" : "bg-slate-300"}`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{row.name}</p>
                      <p className="text-xs text-slate-400">{lastSeenLabel(row, nowMs)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 text-right">{formatInt(row.active)}</td>
                <td className="px-2 py-2 text-right">
                  <span className={row.slaBreached > 0 ? "font-semibold text-red-600" : row.waiting > 0 ? "font-semibold text-amber-600" : ""}>
                    {formatInt(row.waiting)}
                  </span>
                </td>
                <td className="px-2 py-2 text-right text-slate-600">{oldest === null ? "-" : formatDuration(oldest)}</td>
                <td className="px-2 py-2 text-right">{formatInt(row.closedToday)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const InboxAnalyticsDashboard: React.FC = () => {
  const { clinicId } = useClinic();
  const navigate = useNavigate();
  // No computador abre em caixa flutuante, sem sair do painel
  const openConversation = useOpenConversation();
  const nowMs = useNow();
  const [channels, setChannels] = useState<string[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);

  const departments = useQuery({
    queryKey: ["dashboard-departments", clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const { data } = await supabase
        .from("departments")
        .select("id,name,is_active")
        .eq("clinic_id", clinicId!)
        .eq("is_active", true)
        .order("name");
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const filterKey = { clinicId, channels, departmentId };

  const live = useQuery<OperationalNow>({
    queryKey: ["operational-now", filterKey],
    enabled: !!clinicId,
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      fetchOperationalNow({
        clinicId: clinicId!,
        channels,
        departmentId: departmentId || undefined,
      }),
  });

  const backlog = useQuery<BacklogResult>({
    queryKey: ["dashboard-backlog", filterKey],
    enabled: !!clinicId,
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      fetchBacklog({
        clinicId: clinicId!,
        channels,
        departmentId: departmentId || undefined,
      }),
  });

  useEffect(() => setPage(1), [channels, departmentId]);

  const backlogData = backlog.data ?? EMPTY_BACKLOG;
  const totalPages = Math.max(1, Math.ceil(backlogData.items.length / pageSize));

  // A fila encolhe quando clientes são respondidos: não deixa a página apontar para o vazio
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const backlogPage = useMemo(
    () => backlogData.items.slice((page - 1) * pageSize, page * pageSize),
    [backlogData.items, page, pageSize],
  );

  const toggleChannel = (channel: string) =>
    setChannels((current) =>
      current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel],
    );

  const refresh = () => {
    live.refetch();
    backlog.refetch();
  };

  const data = live.data;
  const oldestWaiting = data ? secondsSince(data.now.oldestWaitingAt, nowMs) : null;
  const currentHour = new Date(nowMs).getHours();
  const refreshing = live.isFetching || backlog.isFetching;

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-3 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <PreTitleIcon icon={ActivityIcon} />
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Painel</h1>
                <p className="text-sm text-slate-500">
                  Como está o atendimento agora
                  {data ? ` · atualizado às ${formatTime(data.generatedAt)}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
                title="Atualiza sozinho a cada minuto"
              >
                <RefreshCwIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                Atualizar
              </button>
              <button
                type="button"
                onClick={() => navigate("/inbox/reports")}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <FileBarChartIcon className="h-4 w-4" />
                Análise do período
                <ArrowRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {CHANNEL_OPTIONS.map((channel) => (
              <button
                key={channel}
                type="button"
                onClick={() => toggleChannel(channel)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  channels.includes(channel) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {channelLabel(channel)}
              </button>
            ))}
            <select
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Todos departamentos</option>
              {departments.data?.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        {live.isError ? (
          <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            <p className="font-medium">Erro ao carregar o painel</p>
            <p className="text-sm">{live.error instanceof Error ? live.error.message : "Tente novamente."}</p>
          </section>
        ) : null}

        {data && data.now.slaBreached > 0 ? (
          <section className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
            <AlertTriangleIcon className="h-5 w-5 shrink-0" />
            <p className="text-sm">
              <span className="font-semibold">
                {data.now.slaBreached} {data.now.slaBreached === 1 ? "cliente está esperando" : "clientes estão esperando"} além da meta
              </span>{" "}
              de {formatDuration(data.slaThresholdSec)} para a 1ª resposta. Veja a fila abaixo.
            </p>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-700">Agora</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5">
            {!data ? (
              Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
              ))
            ) : (
              <>
                <NowCard
                  label="Clientes esperando resposta"
                  value={formatInt(data.now.waiting)}
                  hint={oldestWaiting !== null ? `o mais antigo há ${formatDuration(oldestWaiting)}` : "ninguém na espera"}
                  tone={data.now.waiting > 0 ? "warning" : "success"}
                />
                <NowCard
                  label="Além da meta de 1ª resposta"
                  value={formatInt(data.now.slaBreached)}
                  hint={`meta de ${formatDuration(data.slaThresholdSec)}`}
                  tone={data.now.slaBreached > 0 ? "danger" : "success"}
                />
                <NowCard
                  label="Na fila sem responsável"
                  value={formatInt(data.now.unassigned)}
                  hint="aguardando alguém assumir"
                  tone={data.now.unassigned > 0 ? "warning" : "default"}
                />
                <NowCard
                  label="Conversas ativas"
                  value={formatInt(data.now.active)}
                  hint={`${formatInt(data.now.open)} abertas · ${formatInt(data.now.pending)} pendentes · ${formatInt(data.now.inBot)} no bot`}
                />
                <NowCard
                  label="Equipe online"
                  value={`${data.now.teamOnline} de ${data.now.teamTotal}`}
                  hint="com o Unxet aberto agora"
                  tone={data.now.teamOnline === 0 && data.now.waiting > 0 ? "danger" : "default"}
                />
              </>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-700">Hoje</h2>
            <p className="text-sm text-slate-500">
              Desde a meia-noite, comparado com ontem até este mesmo horário.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5">
            {!data ? (
              Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
              ))
            ) : (
              <>
                <TodayCard label="Novas conversas" kpi="leads" today={data.today} yesterday={data.yesterdaySoFar} format={formatInt} />
                <TodayCard label="Finalizadas" kpi="closed" today={data.today} yesterday={data.yesterdaySoFar} format={formatInt} />
                <TodayCard label="Mensagens recebidas" kpi="inboundMessages" today={data.today} yesterday={data.yesterdaySoFar} format={formatInt} />
                <TodayCard
                  label="1ª resposta (mediana)"
                  kpi="p50FirstResponseSec"
                  today={data.today}
                  yesterday={data.yesterdaySoFar}
                  format={formatDuration}
                  higherIsBetter={false}
                />
                <TodayCard label="Dentro da meta" kpi="withinSlaPct" today={data.today} yesterday={data.yesterdaySoFar} format={formatPct} />
              </>
            )}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-5">
          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-3">
            <h3 className="text-base font-semibold text-slate-800">Equipe agora</h3>
            <p className="mb-3 text-xs text-slate-500">
              Quem está online e quantos clientes cada pessoa tem esperando resposta.
            </p>
            {data ? <TeamNow team={data.team} nowMs={nowMs} /> : <div className="h-40 animate-pulse rounded bg-slate-100" />}
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
            <h3 className="text-base font-semibold text-slate-800">Movimento de hoje</h3>
            <p className="mb-3 text-xs text-slate-500">Mensagens de clientes por hora.</p>
            {data ? (
              <HourlyChart counts={data.inboundByHourToday} currentHour={currentHour} />
            ) : (
              <div className="h-40 animate-pulse rounded bg-slate-100" />
            )}
          </article>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-800">Fila: clientes esperando resposta</h3>
              <p className="text-xs text-slate-500">Quem espera há mais tempo aparece primeiro. Clique para abrir a conversa.</p>
            </div>
            <div className="text-sm text-slate-600">
              Total: <span className="font-semibold text-slate-900">{backlog.isError ? "-" : backlogData.total}</span>
              {backlogData.slaBreachedTotal > 0 ? (
                <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                  {backlogData.slaBreachedTotal} além da meta
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
                  <th className="px-2 py-2 text-right">Esperando há</th>
                </tr>
              </thead>
              <tbody>
                {backlog.isLoading ? (
                  Array.from({ length: 5 }, (_, index) => (
                    <tr key={index} className="border-b border-slate-100">
                      <td className="px-2 py-3" colSpan={6}>
                        <div className="h-6 animate-pulse rounded bg-slate-100" />
                      </td>
                    </tr>
                  ))
                ) : backlogPage.length === 0 ? (
                  <tr>
                    <td className="px-2 py-8 text-center text-slate-500" colSpan={6}>
                      {backlog.isError
                        ? "Não foi possível carregar a fila."
                        : "Nenhum cliente esperando resposta. 🎉"}
                    </td>
                  </tr>
                ) : (
                  backlogPage.map((item) => (
                    <tr
                      key={item.conversationId}
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                      onClick={() =>
                        openConversation(item.conversationId, { title: item.contact })
                      }
                    >
                      <td className="px-2 py-2 font-medium text-slate-700">{item.contact}</td>
                      <td className="px-2 py-2">{channelLabel(item.channel)}</td>
                      <td className="px-2 py-2">{item.department}</td>
                      <td className="px-2 py-2">{item.assignedTo}</td>
                      <td className="px-2 py-2">
                        <p className="max-w-xs truncate text-slate-700">{item.lastMessageText}</p>
                        <p className="text-xs text-slate-400">{new Date(item.lastMessageAt).toLocaleString("pt-BR")}</p>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-semibold text-slate-700">
                        {formatDuration(secondsSince(item.lastMessageAt, nowMs))}
                        {item.slaBreached ? (
                          <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                            além da meta
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {backlogData.items.length > 0 ? (
            <Pagination
              page={page}
              pageSize={pageSize}
              totalItems={backlogData.items.length}
              totalInQueue={backlogData.total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
};
