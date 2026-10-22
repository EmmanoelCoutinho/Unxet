import {
  REPORT_TYPE_LABEL,
  WEEKDAY_SHORT,
  channelLabel,
  formatDateTime,
  formatDay,
  formatPeriod,
} from "./format";
import type { ExportContext, OperationalReport, ReportType } from "./types";

type Cell = string | number | null | undefined;

// Excel em pt-BR abre separado por ponto e vírgula e com vírgula decimal
const DELIMITER = ";";
const CRLF = "\r\n";

const decimal = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined
    ? ""
    : value.toFixed(digits).replace(".", ",");

const minutes = (seconds: number | null | undefined) =>
  seconds === null || seconds === undefined ? "" : decimal(seconds / 60, 1);

export const escapeCsvCell = (value: Cell) => {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Evita que o Excel interprete texto (nome, comentário) como fórmula
  if (
    typeof value === "string" &&
    /^[=+\-@\t\r]/.test(text) &&
    !/^-?\d+(,\d+)?$/.test(text)
  ) {
    text = `'${text}`;
  }
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const line = (cells: Cell[]) => cells.map(escapeCsvCell).join(DELIMITER);

const section = (title: string, header: string[], rows: Cell[][]) => [
  "",
  line([title]),
  line(header),
  ...rows.map(line),
];

const includes = (type: ReportType, part: Exclude<ReportType, "full">) =>
  type === "full" || type === part;

export const buildReportCsv = (
  report: OperationalReport,
  context: ExportContext,
) => {
  const { current, previous } = report.summary;
  const lines: string[] = [
    line([`Unxet - ${REPORT_TYPE_LABEL[context.type]}`]),
    line(["Empresa", context.companyName]),
    line(["Período", formatPeriod(context.filters.startDay, context.filters.endDay)]),
    line(["Canais", context.filterLabels.channels]),
    line(["Departamento", context.filterLabels.department]),
    line(["Atendente", context.filterLabels.attendant]),
    line(["Gerado em", formatDateTime(context.generatedAt)]),
    line(["Gerado por", context.generatedByName]),
    line(["Código de verificação", context.code]),
    line(["Hash dos dados (SHA-256)", context.dataHash]),
  ];

  if (includes(context.type, "summary")) {
    const kpi = (
      label: string,
      cur: number | null,
      prev: number | null,
      fmt: (v: number | null) => string = (v) => (v === null ? "" : String(v)),
    ) => [label, fmt(cur), fmt(prev)];

    lines.push(
      ...section("Resumo executivo", ["Indicador", "Período", "Período anterior"], [
        kpi("Novas conversas", current.leads, previous.leads),
        kpi("Conversas finalizadas", current.closed, previous.closed),
        kpi("Finalizadas automaticamente", current.autoClosed, previous.autoClosed),
        kpi("Contatos atendidos", current.contactsServed, previous.contactsServed),
        kpi("Contatos novos", current.newContacts, previous.newContacts),
        kpi("Mensagens recebidas", current.inboundMessages, previous.inboundMessages),
        kpi("Mensagens enviadas pela equipe", current.outboundMessages, previous.outboundMessages),
        kpi("Mensagens enviadas por bot", current.botMessages, previous.botMessages),
        kpi("1ª resposta mediana (min)", current.p50FirstResponseSec, previous.p50FirstResponseSec, minutes),
        kpi("1ª resposta p90 (min)", current.p90FirstResponseSec, previous.p90FirstResponseSec, minutes),
        kpi("Dentro da meta de 1ª resposta (%)", current.withinSlaPct, previous.withinSlaPct, (v) => decimal(v)),
        kpi("Conversas sem resposta humana", current.unansweredLeads, previous.unansweredLeads),
        kpi("Tempo mediano até finalizar (min)", current.p50ResolutionSec, previous.p50ResolutionSec, minutes),
        kpi("Pesquisas enviadas", current.surveysSent, previous.surveysSent),
        kpi("Pesquisas respondidas", current.surveysAnswered, previous.surveysAnswered),
        kpi("Nota média (1 a 5)", current.averageScore, previous.averageScore, (v) => decimal(v, 2)),
        kpi("CSAT - notas 4 e 5 (%)", current.csatPct, previous.csatPct, (v) => decimal(v)),
      ]),
      ...section(
        "Conversas por dia",
        ["Dia", "Novas", "Finalizadas"],
        report.daily.map((row) => [formatDay(row.day), row.leads, row.closed]),
      ),
      ...section(
        "Novas conversas por canal",
        ["Canal", "Conversas"],
        report.leadsByChannel.map((row) => [channelLabel(row.channel), row.leads]),
      ),
      ...section(
        "Novas conversas por departamento",
        ["Departamento", "Conversas"],
        report.leadsByDepartment.map((row) => [row.department, row.leads]),
      ),
    );
  }

  if (includes(context.type, "team")) {
    lines.push(
      ...section(
        "Desempenho da equipe",
        [
          "Atendente",
          "Papel",
          "Conversas",
          "Finalizadas",
          "Mensagens enviadas",
          "1ª resposta mediana (min)",
          "Dentro da meta (%)",
          "Tempo mediano até finalizar (min)",
          "Avaliações",
          "Nota média",
          "Último acesso",
        ],
        report.team.map((row) => [
          row.name,
          row.role === "admin" ? "Administrador" : "Atendente",
          row.conversations,
          row.closed,
          row.outboundMessages,
          minutes(row.p50FirstResponseSec),
          decimal(row.withinSlaPct),
          minutes(row.p50ResolutionSec),
          row.surveysAnswered,
          decimal(row.averageScore, 2),
          row.lastSeenAt ? formatDateTime(row.lastSeenAt) : "",
        ]),
      ),
    );
  }

  if (includes(context.type, "sla")) {
    const slaRows = (rows: OperationalReport["sla"]["byChannel"], label: (v: string) => string) =>
      rows.map((row) => [
        label(row.label),
        row.count,
        minutes(row.p50Sec),
        minutes(row.p90Sec),
        decimal(row.withinSlaPct),
      ]);
    const slaHeader = ["Grupo", "Conversas respondidas", "Mediana (min)", "p90 (min)", "Dentro da meta (%)"];

    lines.push(
      line([]),
      line(["Meta de 1ª resposta (min)", decimal(report.slaThresholdSec / 60)]),
      ...section("1ª resposta por canal", slaHeader, slaRows(report.sla.byChannel, channelLabel)),
      ...section("1ª resposta por departamento", slaHeader, slaRows(report.sla.byDepartment, (v) => v)),
      ...section(
        "Distribuição do tempo de 1ª resposta",
        ["Faixa", "Conversas"],
        report.sla.buckets.map((row) => [row.label, row.count]),
      ),
      ...section(
        "Mensagens recebidas por dia da semana e hora",
        ["Dia", ...Array.from({ length: 24 }, (_, h) => `${h}h`)],
        WEEKDAY_SHORT.map((label, index) => [
          label,
          ...Array.from({ length: 24 }, (_, hour) =>
            report.sla.heatmap.find((c) => c.weekday === index + 1 && c.hour === hour)?.messages ?? 0,
          ),
        ]),
      ),
      ...section(
        "Conversas fora da meta",
        ["Contato", "Canal", "Departamento", "Responsável", "1ª mensagem", "Espera até a 1ª resposta (min)"],
        report.sla.slowest.map((row) => [
          row.contact,
          channelLabel(row.channel),
          row.department,
          row.assignedTo,
          formatDateTime(row.firstInboundAt),
          row.seconds === null ? "Sem resposta" : minutes(row.seconds),
        ]),
      ),
    );
  }

  if (includes(context.type, "satisfaction")) {
    lines.push(
      ...section(
        "Distribuição das notas",
        ["Nota", "Respostas"],
        report.satisfaction.distribution.map((row) => [row.score, row.count]),
      ),
      ...section(
        "Nota por atendente",
        ["Atendente", "Avaliações", "Nota média"],
        report.team
          .filter((row) => row.surveysAnswered > 0)
          .map((row) => [row.name, row.surveysAnswered, decimal(row.averageScore, 2)]),
      ),
      ...section(
        "Nota por departamento",
        ["Departamento", "Avaliações", "Nota média"],
        report.satisfaction.byDepartment.map((row) => [row.label, row.answered, decimal(row.averageScore, 2)]),
      ),
      ...section(
        "Notas 1 e 2",
        ["Data", "Nota", "Contato", "Atendente", "Departamento", "Resposta do cliente"],
        report.satisfaction.lowScores.map((row) => [
          formatDateTime(row.answeredAt),
          row.score,
          row.contact,
          row.agent,
          row.department,
          row.comment ?? "",
        ]),
      ),
    );
  }

  // BOM para o Excel reconhecer UTF-8 (acentos)
  const BOM = String.fromCharCode(0xfeff);
  return BOM + lines.join(CRLF) + CRLF;
};
