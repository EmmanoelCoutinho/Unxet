import React, { useMemo, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import {
  ChevronDownIcon,
  FileBarChartIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  Loader2Icon,
  SearchCheckIcon,
  ShieldCheckIcon,
} from "lucide-react";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { useClinic } from "../contexts/ClinicContext";
import { supabase } from "../lib/supabaseClient";
import {
  fetchOperationalReport,
  listReportExports,
  verifyReportExport,
} from "../modules/reports/api";
import { exportReport } from "../modules/reports/exportReport";
import {
  REPORT_TYPE_LABEL,
  WEEKDAY_SHORT,
  addDaysToDay,
  channelLabel,
  compareValues,
  dayDiff,
  formatDateTime,
  formatDuration,
  formatInt,
  formatPct,
  formatPeriod,
  formatScore,
  formatTrend,
  previousRange,
} from "../modules/reports/format";
import { buildHighlights } from "../modules/reports/insights";
import { groupDailySeries } from "../modules/reports/series";
import type {
  OperationalReport,
  ReportExport,
  ReportFilterLabels,
  ReportFilters,
  ReportType,
  SlaGroupRow,
} from "../modules/reports/types";

const CHANNEL_OPTIONS = ["whatsapp", "instagram", "messenger"];

type Tab = Exclude<ReportType, "full">;
const TABS: Tab[] = ["summary", "team", "sla", "satisfaction"];

type PresetKey = "7d" | "30d" | "thisMonth" | "lastMonth" | "custom";

// Data local (toISOString usaria UTC e viraria o dia às 21h no Brasil)
const todayDay = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const presetRange = (preset: Exclude<PresetKey, "custom">) => {
  const today = todayDay();
  if (preset === "7d") return { start: addDaysToDay(today, -6), end: today };
  if (preset === "30d") return { start: addDaysToDay(today, -29), end: today };
  const monthStart = `${today.slice(0, 7)}-01`;
  if (preset === "thisMonth") return { start: monthStart, end: today };
  const lastMonthEnd = addDaysToDay(monthStart, -1);
  return { start: `${lastMonthEnd.slice(0, 7)}-01`, end: lastMonthEnd };
};

const PRESETS: Array<{ key: Exclude<PresetKey, "custom">; label: string }> = [
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "thisMonth", label: "Este mês" },
  { key: "lastMonth", label: "Mês passado" },
];

type Draft = {
  preset: PresetKey;
  start: string;
  end: string;
  channels: string[];
  departmentId: string;
  assignedUserId: string;
};

const initialDraft = (): Draft => {
  const range = presetRange("30d");
  return {
    preset: "30d",
    start: range.start,
    end: range.end,
    channels: [],
    departmentId: "",
    assignedUserId: "",
  };
};

// ---------------------------------------------------------------------------
// Peças visuais
// ---------------------------------------------------------------------------

const Card = ({
  title,
  subtitle,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
    {title ? (
      <div className="mb-3">
        <h3 className="text-base font-semibold text-slate-800">{title}</h3>
        {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      </div>
    ) : null}
    {children}
  </section>
);

const Kpi = ({
  label,
  value,
  current,
  previous,
  previousLabel,
  higherIsBetter = true,
  hint,
}: {
  label: string;
  value: string;
  current?: number | null;
  previous?: number | null;
  previousLabel?: string;
  higherIsBetter?: boolean;
  hint?: string;
}) => {
  const trend =
    current !== undefined && previous !== undefined
      ? compareValues(current ?? null, previous ?? null, higherIsBetter)
      : null;
  const trendClass =
    !trend || trend.good === null
      ? "text-slate-500"
      : trend.good
      ? "text-emerald-600"
      : "text-red-600";

  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500 sm:text-sm">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold text-slate-900" title={value}>
        {value}
      </p>
      {trend ? (
        <p className="mt-1 text-xs">
          <span className={`font-semibold ${trendClass}`}>
            {trend.direction === "up" ? "↑ " : trend.direction === "down" ? "↓ " : ""}
            {formatTrend(trend)}
          </span>
          <span className="text-slate-400"> · antes {previousLabel ?? "-"}</span>
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-400">{hint}</p>
      ) : null}
    </article>
  );
};

const Bars = ({
  rows,
  color = "#0066FF",
  format = formatInt,
}: {
  rows: Array<{ label: string; value: number; color?: string }>;
  color?: string;
  format?: (value: number) => string;
}) => {
  if (rows.length === 0) return <p className="text-sm text-slate-500">Sem dados no período.</p>;
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
            <span className="truncate">{row.label}</span>
            <span className="font-medium text-slate-800">{format(row.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{
                width: `${row.value > 0 ? Math.max(3, (row.value / max) * 100) : 0}%`,
                backgroundColor: row.color ?? color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const DailyChart = ({ daily }: { daily: OperationalReport["daily"] }) => {
  const rows = groupDailySeries(daily);
  if (rows.length === 0) return <p className="text-sm text-slate-500">Sem dados no período.</p>;
  const max = Math.max(1, ...rows.map((row) => Math.max(row.leads, row.closed)));
  const labelEvery = Math.max(1, Math.ceil(rows.length / 10));
  return (
    <div>
      <div className="flex h-44 items-end gap-0.5 border-b border-slate-200 sm:gap-1">
        {rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className="flex h-full flex-1 items-end justify-center gap-px"
            title={`${row.label}: ${row.leads} novas, ${row.closed} finalizadas`}
          >
            <div className="w-1/2 rounded-t bg-[#0066FF]" style={{ height: `${(row.leads / max) * 100}%` }} />
            <div className="w-1/2 rounded-t bg-[#00D374]" style={{ height: `${(row.closed / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 sm:gap-1">
        {rows.map((row, index) => (
          <span key={`${row.label}-l-${index}`} className="flex-1 text-center text-[10px] text-slate-500">
            {index % labelEvery === 0 ? row.label : ""}
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#0066FF]" />Novas conversas</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#00D374]" />Finalizadas</span>
      </div>
    </div>
  );
};

const Heatmap = ({ cells }: { cells: OperationalReport["sla"]["heatmap"] }) => {
  const max = Math.max(1, ...cells.map((cell) => cell.messages));
  const value = (weekday: number, hour: number) =>
    cells.find((cell) => cell.weekday === weekday && cell.hour === hour)?.messages ?? 0;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        {WEEKDAY_SHORT.map((label, index) => (
          <div key={label} className="mb-1 flex items-center gap-1">
            <span className="w-8 shrink-0 text-xs text-slate-500">{label}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const count = value(index + 1, hour);
              const ratio = count / max;
              return (
                <div
                  key={hour}
                  className="h-6 flex-1 rounded"
                  style={{
                    backgroundColor: count > 0 ? `rgba(0, 102, 255, ${0.12 + ratio * 0.88})` : "#F1F5F9",
                  }}
                  title={`${label}, ${hour}h às ${hour + 1}h: ${count} mensagens`}
                />
              );
            })}
          </div>
        ))}
        <div className="flex gap-1">
          <span className="w-8 shrink-0" />
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} className="flex-1 text-center text-[10px] text-slate-500">
              {hour % 3 === 0 ? `${hour}h` : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

type Column<T> = {
  title: string;
  align?: "left" | "right" | "center";
  render: (row: T) => React.ReactNode;
};

function DataTable<T>({
  columns,
  rows,
  emptyText = "Sem dados no período.",
}: {
  columns: Column<T>[];
  rows: T[];
  emptyText?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{emptyText}</p>;
  const alignClass = (align?: string) =>
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((col) => (
              <th key={col.title} className={`whitespace-nowrap px-3 py-2 font-medium ${alignClass(col.align)}`}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-slate-50">
              {columns.map((col) => (
                <td key={col.title} className={`whitespace-nowrap px-3 py-2 text-slate-700 ${alignClass(col.align)}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const slaTone = (pct: number | null) =>
  pct === null ? "" : pct >= 80 ? "text-emerald-600 font-medium" : pct < 50 ? "text-red-600 font-medium" : "";

const SCORE_COLORS: Record<number, string> = {
  1: "#EF4444",
  2: "#F97316",
  3: "#F59E0B",
  4: "#22C55E",
  5: "#00D374",
};

// ---------------------------------------------------------------------------
// Relatórios na tela
// ---------------------------------------------------------------------------

const SummaryView = ({ report, previousLabel }: { report: OperationalReport; previousLabel: string }) => {
  const { current: c, previous: p } = report.summary;
  const highlights = buildHighlights(report);
  const k = (
    label: string,
    key: keyof typeof c,
    fmt: (value: number | null) => string,
    higherIsBetter = true,
  ) => (
    <Kpi
      label={label}
      value={fmt(c[key] as number | null)}
      current={c[key] as number | null}
      previous={p[key] as number | null}
      previousLabel={fmt(p[key] as number | null)}
      higherIsBetter={higherIsBetter}
    />
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Comparação com o período anterior de mesmo tamanho ({previousLabel}).
      </p>
      {highlights.length > 0 && (
        <Card className="border-blue-100 bg-blue-50/60">
          <h3 className="mb-2 text-sm font-semibold text-blue-800">Destaques do período</h3>
          <ul className="space-y-1.5 text-sm text-slate-700">
            {highlights.map((text) => (
              <li key={text} className="flex gap-2">
                <span className="text-blue-600">•</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        {k("Novas conversas", "leads", formatInt)}
        {k("Finalizadas", "closed", formatInt)}
        <Kpi label="Ativas agora" value={formatInt(report.summary.activeNow)} hint="abertas ou pendentes" />
        {k("Contatos atendidos", "contactsServed", formatInt)}
        {k("Mensagens recebidas", "inboundMessages", formatInt)}
        {k("Enviadas pela equipe", "outboundMessages", formatInt)}
        {k("1ª resposta (mediana)", "p50FirstResponseSec", formatDuration, false)}
        {k("Dentro da meta", "withinSlaPct", formatPct)}
        {k("Até finalizar (mediana)", "p50ResolutionSec", formatDuration, false)}
        {k("Sem resposta humana", "unansweredLeads", formatInt, false)}
        {k("Nota média", "averageScore", formatScore)}
        {k("CSAT (notas 4 e 5)", "csatPct", formatPct)}
      </div>
      <Card title="Conversas por dia" subtitle="Novas conversas e conversas finalizadas">
        <DailyChart daily={report.daily} />
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Novas conversas por canal">
          <Bars rows={report.leadsByChannel.map((row) => ({ label: channelLabel(row.channel), value: row.leads }))} />
        </Card>
        <Card title="Novas conversas por departamento">
          <Bars color="#00D374" rows={report.leadsByDepartment.map((row) => ({ label: row.department, value: row.leads }))} />
        </Card>
      </div>
    </div>
  );
};

const TeamView = ({ report }: { report: OperationalReport }) => (
  <div className="space-y-4">
    <p className="text-sm text-slate-500">
      Os números consideram o responsável atual de cada conversa. 1ª resposta e Até finalizar são medianas; Na meta usa a meta de {formatDuration(report.slaThresholdSec)}.
    </p>
    <DataTable
      rows={report.team}
      emptyText="Nenhuma pessoa na equipe."
      columns={[
        {
          title: "Atendente",
          render: (r) => (
            <div>
              <p className="font-medium text-slate-800">{r.name}</p>
              <p className="text-xs text-slate-400">{r.role === "admin" ? "Administrador" : "Atendente"}</p>
            </div>
          ),
        },
        { title: "Conversas", align: "right", render: (r) => formatInt(r.conversations) },
        { title: "Finalizadas", align: "right", render: (r) => formatInt(r.closed) },
        { title: "Msgs enviadas", align: "right", render: (r) => formatInt(r.outboundMessages) },
        { title: "1ª resposta", align: "right", render: (r) => formatDuration(r.p50FirstResponseSec) },
        { title: "Na meta", align: "right", render: (r) => <span className={slaTone(r.withinSlaPct)}>{formatPct(r.withinSlaPct)}</span> },
        { title: "Até finalizar", align: "right", render: (r) => formatDuration(r.p50ResolutionSec) },
        {
          title: "Nota",
          align: "right",
          render: (r) => (r.averageScore === null ? "-" : `${formatScore(r.averageScore)} (${r.surveysAnswered})`),
        },
        { title: "Último acesso", align: "right", render: (r) => formatDateTime(r.lastSeenAt) },
      ]}
    />
  </div>
);

const slaColumns = (title: string, label: (v: string) => string): Column<SlaGroupRow>[] => [
  { title, render: (r) => label(r.label) },
  { title: "Respondidas", align: "right", render: (r) => formatInt(r.count) },
  { title: "Mediana", align: "right", render: (r) => formatDuration(r.p50Sec) },
  { title: "90% em até", align: "right", render: (r) => formatDuration(r.p90Sec) },
  { title: "Na meta", align: "right", render: (r) => <span className={slaTone(r.withinSlaPct)}>{formatPct(r.withinSlaPct)}</span> },
];

const SlaView = ({ report }: { report: OperationalReport }) => {
  const c = report.summary.current;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        <Kpi label="Meta de 1ª resposta" value={formatDuration(report.slaThresholdSec)} hint="definida nas automações" />
        <Kpi label="1ª resposta (mediana)" value={formatDuration(c.p50FirstResponseSec)} hint={`${formatInt(c.firstResponseCount)} respondidas`} />
        <Kpi label="90% em até" value={formatDuration(c.p90FirstResponseSec)} />
        <Kpi label="Dentro da meta" value={formatPct(c.withinSlaPct)} />
        <Kpi label="Sem resposta humana" value={formatInt(c.unansweredLeads)} hint="iniciadas no período" />
        <Kpi label="Finalizadas automaticamente" value={formatInt(c.autoClosed)} hint="por inatividade" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Tempo até a 1ª resposta">
          <Bars
            rows={report.sla.buckets.map((row, index) => ({
              label: row.label,
              value: row.count,
              color: index <= 1 ? "#00D374" : index <= 3 ? "#F59E0B" : "#EF4444",
            }))}
          />
        </Card>
        <Card title="Por canal">
          <DataTable rows={report.sla.byChannel} columns={slaColumns("Canal", channelLabel)} />
        </Card>
      </div>
      <Card title="Por departamento">
        <DataTable rows={report.sla.byDepartment} columns={slaColumns("Departamento", (v) => v)} />
      </Card>
      <Card title="Mensagens recebidas por dia da semana e hora" subtitle="Quanto mais escuro, maior a demanda. Use para montar a escala da equipe.">
        <Heatmap cells={report.sla.heatmap} />
      </Card>
      <Card title="Conversas fora da meta" subtitle="As 20 que mais esperaram pela 1ª resposta (ou ainda não foram respondidas)">
        <DataTable
          rows={report.sla.slowest}
          emptyText="Nenhuma conversa fora da meta no período."
          columns={[
            { title: "Contato", render: (r) => r.contact },
            { title: "Canal", render: (r) => channelLabel(r.channel) },
            { title: "Departamento", render: (r) => r.department },
            { title: "Responsável", render: (r) => r.assignedTo },
            { title: "1ª mensagem", render: (r) => formatDateTime(r.firstInboundAt) },
            {
              title: "Esperou",
              align: "right",
              render: (r) => (
                <span className="font-medium text-red-600">
                  {r.seconds === null ? "Sem resposta" : formatDuration(r.seconds)}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};

const SatisfactionView = ({ report }: { report: OperationalReport }) => {
  const c = report.summary.current;
  const p = report.summary.previous;
  const responseRate = c.surveysSent ? (c.surveysAnswered / c.surveysSent) * 100 : null;
  const agents = report.team
    .filter((row) => row.surveysAnswered > 0)
    .sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Nota média" value={formatScore(c.averageScore)} current={c.averageScore} previous={p.averageScore} previousLabel={formatScore(p.averageScore)} />
        <Kpi label="CSAT (notas 4 e 5)" value={formatPct(c.csatPct)} current={c.csatPct} previous={p.csatPct} previousLabel={formatPct(p.csatPct)} />
        <Kpi label="Taxa de resposta" value={formatPct(responseRate)} hint={`${formatInt(c.surveysAnswered)} de ${formatInt(c.surveysSent)} pesquisas`} />
        <Kpi
          label="Notas 1 e 2"
          value={formatInt(
            report.satisfaction.distribution
              .filter((row) => row.score <= 2)
              .reduce((sum, row) => sum + row.count, 0),
          )}
          hint="clientes insatisfeitos"
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Distribuição das notas">
          <Bars
            rows={[...report.satisfaction.distribution].reverse().map((row) => ({
              label: `Nota ${row.score}`,
              value: row.count,
              color: SCORE_COLORS[row.score],
            }))}
          />
        </Card>
        <Card title="Por atendente">
          <DataTable
            rows={agents}
            emptyText="Nenhuma avaliação no período."
            columns={[
              { title: "Atendente", render: (r) => r.name },
              { title: "Avaliações", align: "right", render: (r) => formatInt(r.surveysAnswered) },
              { title: "Média", align: "right", render: (r) => formatScore(r.averageScore) },
            ]}
          />
        </Card>
        <Card title="Por departamento">
          <DataTable
            rows={report.satisfaction.byDepartment}
            emptyText="Nenhuma avaliação no período."
            columns={[
              { title: "Departamento", render: (r) => r.label },
              { title: "Avaliações", align: "right", render: (r) => formatInt(r.answered) },
              { title: "Média", align: "right", render: (r) => formatScore(r.averageScore) },
            ]}
          />
        </Card>
      </div>
      <Card title="Notas 1 e 2" subtitle="Para entender o que deu errado e retornar ao cliente">
        <DataTable
          rows={report.satisfaction.lowScores}
          emptyText="Nenhuma nota 1 ou 2 no período."
          columns={[
            { title: "Data", render: (r) => formatDateTime(r.answeredAt) },
            {
              title: "Nota",
              align: "center",
              render: (r) => (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: SCORE_COLORS[r.score] }}>
                  {r.score}
                </span>
              ),
            },
            { title: "Contato", render: (r) => r.contact },
            { title: "Atendente", render: (r) => r.agent },
            { title: "Departamento", render: (r) => r.department },
            { title: "Resposta do cliente", render: (r) => <span className="whitespace-normal">{r.comment ?? "-"}</span> },
          ]}
        />
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Histórico e verificação
// ---------------------------------------------------------------------------

const ExportHistory = ({ clinicId }: { clinicId: string }) => {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ReportExport | null | "not-found">(null);

  const history = useQuery({
    queryKey: ["report-exports", clinicId],
    queryFn: () => listReportExports(clinicId, 15),
  });

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setChecking(true);
    try {
      const found = await verifyReportExport(clinicId, code);
      setResult(found ?? "not-found");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao verificar o código.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="Relatórios gerados" subtitle="Cada arquivo exportado recebe um código impresso no rodapé" className="xl:col-span-2">
        {history.isLoading ? (
          <p className="text-sm text-slate-500">Carregando...</p>
        ) : (
          <DataTable
            rows={history.data ?? []}
            emptyText="Nenhum relatório exportado ainda."
            columns={[
              { title: "Código", render: (r) => <span className="font-mono text-xs font-semibold text-blue-700">{r.code}</span> },
              { title: "Relatório", render: (r) => REPORT_TYPE_LABEL[r.report_type] },
              { title: "Formato", render: (r) => r.format.toUpperCase() },
              { title: "Período", render: (r) => formatPeriod(String(r.filters.startDay ?? ""), String(r.filters.endDay ?? "")) },
              { title: "Gerado por", render: (r) => r.generated_by_name ?? "-" },
              { title: "Quando", render: (r) => formatDateTime(r.created_at) },
            ]}
          />
        )}
      </Card>
      <Card title="Verificar autenticidade" subtitle="Digite o código do rodapé de um PDF ou CSV">
        <form onSubmit={verify} className="flex gap-2">
          <input
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setResult(null);
            }}
            placeholder="UNX-XXXX-XXXX"
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm uppercase focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={checking || !code.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {checking ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SearchCheckIcon className="h-4 w-4" />}
            Verificar
          </button>
        </form>
        {result === "not-found" ? (
          <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
            Código não encontrado. Este arquivo não foi gerado pela Unxet para esta empresa.
          </p>
        ) : result ? (
          <div className="mt-3 space-y-1 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
            <p className="flex items-center gap-1.5 font-semibold">
              <ShieldCheckIcon className="h-4 w-4" /> Relatório autêntico
            </p>
            <p>{REPORT_TYPE_LABEL[result.report_type]} ({result.format.toUpperCase()})</p>
            <p>Período: {formatPeriod(String(result.filters.startDay ?? ""), String(result.filters.endDay ?? ""))}</p>
            <p>Gerado por {result.generated_by_name ?? "-"} em {formatDateTime(result.created_at)}</p>
            <p className="break-all font-mono text-[11px] text-emerald-700">SHA-256: {result.data_hash}</p>
          </div>
        ) : null}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export const ReportsPage: React.FC = () => {
  const { clinicId, clinic } = useClinic();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [applied, setApplied] = useState<Draft>(initialDraft);
  const [tab, setTab] = useState<Tab>("summary");
  const [exporting, setExporting] = useState<string | null>(null);

  const options = useQuery({
    queryKey: ["report-filter-options", clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const [departments, users] = await Promise.all([
        supabase
          .from("departments")
          .select("id,name,is_active")
          .eq("clinic_id", clinicId!)
          .order("is_active", { ascending: false })
          .order("name"),
        supabase
          .from("clinic_users")
          .select("user_id,name,email")
          .eq("clinic_id", clinicId!)
          .order("name"),
      ]);
      return {
        departments: (departments.data ?? []) as Array<{ id: string; name: string; is_active: boolean }>,
        users: (users.data ?? []) as Array<{ user_id: string; name: string | null; email: string | null }>,
      };
    },
  });

  const filters = useMemo<ReportFilters | null>(() => {
    if (!clinicId) return null;
    const startDay = applied.start <= applied.end ? applied.start : applied.end;
    const endDay = applied.start <= applied.end ? applied.end : applied.start;
    return {
      clinicId,
      startDay,
      endDay,
      start: new Date(`${startDay}T00:00:00`).toISOString(),
      end: new Date(`${addDaysToDay(endDay, 1)}T00:00:00`).toISOString(),
      channels: applied.channels,
      departmentId: applied.departmentId || undefined,
      assignedUserId: applied.assignedUserId || undefined,
    };
  }, [applied, clinicId]);

  const report = useQuery({
    queryKey: ["operational-report", filters],
    enabled: !!filters,
    queryFn: () => fetchOperationalReport(filters!),
  });

  const filterLabels = useMemo<ReportFilterLabels>(() => {
    const department = options.data?.departments.find((d) => d.id === applied.departmentId);
    const user = options.data?.users.find((u) => u.user_id === applied.assignedUserId);
    return {
      channels: applied.channels.length ? applied.channels.map(channelLabel).join(", ") : "Todos",
      department: department?.name ?? "Todos",
      attendant: user ? user.name?.trim() || user.email || "Sem nome" : "Todos",
    };
  }, [applied, options.data]);

  const companyName = clinic?.name?.trim() || "Empresa";
  const previous = filters ? previousRange(filters.startDay, filters.endDay) : null;
  const previousLabel = previous ? formatPeriod(previous.startDay, previous.endDay) : "";
  const rangeTooLong = dayDiff(draft.start, draft.end) > 366 || dayDiff(draft.end, draft.start) > 366;

  const handleExport = async (type: ReportType, format: "pdf" | "csv") => {
    if (!report.data || !filters) return;
    const key = `${type}-${format}`;
    setExporting(key);
    try {
      const result = await exportReport({
        report: report.data,
        type,
        format,
        companyName,
        filters,
        filterLabels,
      });
      toast.success(`Relatório gerado (${result.code}).`);
      queryClient.invalidateQueries({ queryKey: ["report-exports", clinicId] });
    } catch (error) {
      console.error("Erro ao exportar relatório:", error);
      toast.error(error instanceof Error ? error.message : "Falha ao gerar o relatório.");
    } finally {
      setExporting(null);
    }
  };

  const setPreset = (preset: Exclude<PresetKey, "custom">) => {
    const range = presetRange(preset);
    setDraft((d) => ({ ...d, preset, start: range.start, end: range.end }));
  };

  const toggleChannel = (channel: string) =>
    setDraft((d) => ({
      ...d,
      channels: d.channels.includes(channel)
        ? d.channels.filter((c) => c !== channel)
        : [...d.channels, channel],
    }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const menuItemClass =
    "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700";

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-3 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <PreTitleIcon icon={FileBarChartIcon} />
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Relatórios</h1>
                <p className="text-sm text-slate-500">
                  Números da operação de {companyName} para apoiar decisões, com exportação em PDF e planilha
                </p>
              </div>
            </div>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  disabled={!report.data || !!exporting}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {exporting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <FileTextIcon className="h-4 w-4" />}
                  {exporting ? "Gerando..." : "Exportar"}
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-72 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  <DropdownMenu.Label className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-slate-400">PDF</DropdownMenu.Label>
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => handleExport(tab, "pdf")}>
                    <FileTextIcon className="h-4 w-4 text-red-500" /> {REPORT_TYPE_LABEL[tab]}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => handleExport("full", "pdf")}>
                    <FileTextIcon className="h-4 w-4 text-red-500" /> Relatório completo (todos)
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
                  <DropdownMenu.Label className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-slate-400">Planilha (CSV)</DropdownMenu.Label>
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => handleExport(tab, "csv")}>
                    <FileSpreadsheetIcon className="h-4 w-4 text-emerald-600" /> {REPORT_TYPE_LABEL[tab]}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => handleExport("full", "csv")}>
                    <FileSpreadsheetIcon className="h-4 w-4 text-emerald-600" /> Relatório completo (todos)
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => setPreset(preset.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    draft.preset === preset.key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 2xl:grid-cols-6">
              <input
                type="date"
                value={draft.start}
                max={todayDay()}
                onChange={(event) => setDraft((d) => ({ ...d, preset: "custom", start: event.target.value }))}
                aria-label="Data inicial"
                className="w-full min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="date"
                value={draft.end}
                max={todayDay()}
                onChange={(event) => setDraft((d) => ({ ...d, preset: "custom", end: event.target.value }))}
                aria-label="Data final"
                className="w-full min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="col-span-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-300 px-2 py-1.5">
                <span className="text-xs text-slate-500">Canal</span>
                {CHANNEL_OPTIONS.map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    onClick={() => toggleChannel(channel)}
                    className={`rounded-full px-2 py-1 text-xs transition-colors ${
                      draft.channels.includes(channel) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {channelLabel(channel)}
                  </button>
                ))}
              </div>
              <select
                value={draft.departmentId}
                onChange={(event) => setDraft((d) => ({ ...d, departmentId: event.target.value }))}
                className="min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Todos departamentos</option>
                {options.data?.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                    {department.is_active === false ? " (inativo)" : ""}
                  </option>
                ))}
              </select>
              <select
                value={draft.assignedUserId}
                onChange={(event) => setDraft((d) => ({ ...d, assignedUserId: event.target.value }))}
                className="min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Todos atendentes</option>
                {options.data?.users.map((user) => (
                  <option key={user.user_id} value={user.user_id}>
                    {user.name?.trim() || user.email?.split("@")[0] || "Sem nome"}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                {rangeTooLong
                  ? "Escolha um período de até 1 ano."
                  : filters
                  ? `Exibindo ${formatPeriod(filters.startDay, filters.endDay)}`
                  : ""}
              </p>
              <button
                type="button"
                disabled={!dirty || rangeTooLong || !draft.start || !draft.end}
                onClick={() => setApplied(draft)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
              >
                Aplicar filtros
              </button>
            </div>
          </div>
        </section>

        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {REPORT_TYPE_LABEL[key]}
            </button>
          ))}
        </nav>

        {report.isError ? (
          <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            <p className="font-medium">Erro ao carregar o relatório</p>
            <p className="text-sm">{report.error instanceof Error ? report.error.message : "Tente novamente."}</p>
            <button
              type="button"
              onClick={() => report.refetch()}
              className="mt-3 rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
            >
              Tentar novamente
            </button>
          </section>
        ) : report.isLoading || !report.data ? (
          <div className="grid grid-cols-2 gap-3 2xl:grid-cols-6">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className={report.isFetching ? "opacity-60 transition-opacity" : ""}>
            {tab === "summary" && <SummaryView report={report.data} previousLabel={previousLabel} />}
            {tab === "team" && <TeamView report={report.data} />}
            {tab === "sla" && <SlaView report={report.data} />}
            {tab === "satisfaction" && <SatisfactionView report={report.data} />}
          </div>
        )}

        {clinicId ? <ExportHistory clinicId={clinicId} /> : null}
      </div>
    </div>
  );
};
