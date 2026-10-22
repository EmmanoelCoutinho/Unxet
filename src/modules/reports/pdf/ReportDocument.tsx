import React from "react";
import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
// Versões leves da marca: o PNG original repetido em cada página deixava o PDF com MBs
import logoWordmark from "./logo-unxet-wordmark.png";
import logoIcon from "./logo-unxet-icon.png";
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff?url";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff?url";
import inter700 from "@fontsource/inter/files/inter-latin-700-normal.woff?url";
import {
  BRAND,
  REPORT_TYPE_LABEL,
  WEEKDAY_SHORT,
  channelLabel,
  compareValues,
  formatDateTime,
  formatDateTimeLong,
  formatDuration,
  formatInt,
  formatPct,
  formatPeriod,
  formatScore,
  formatTrend,
  previousRange,
} from "../format";
import { buildHighlights } from "../insights";
import { groupDailySeries } from "../series";
import type {
  ExportContext,
  OperationalReport,
  PeriodKpis,
  ReportType,
} from "../types";

Font.register({
  family: "Inter",
  fonts: [
    { src: inter400, fontWeight: 400 },
    { src: inter500, fontWeight: 500 },
    { src: inter600, fontWeight: 600 },
    { src: inter700, fontWeight: 700 },
  ],
});
// Sem hifenização: nomes e termos em português quebrariam errado
Font.registerHyphenationCallback((word) => [word]);

const PAGE_PADDING_X = 36;

const s = StyleSheet.create({
  page: {
    fontFamily: "Inter",
    fontSize: 9,
    color: BRAND.ink,
    paddingTop: 64,
    paddingBottom: 64,
    paddingHorizontal: PAGE_PADDING_X,
    backgroundColor: "#FFFFFF",
  },
  // Faixa da marca no topo de todas as páginas
  topStripe: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    flexDirection: "row",
  },
  header: {
    position: "absolute",
    top: 18,
    left: PAGE_PADDING_X,
    right: PAGE_PADDING_X,
  },
  headerInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.line,
  },
  headerBrand: { flexDirection: "row", alignItems: "center" },
  headerLogo: { width: 71, height: 20 },
  headerTitle: {
    fontSize: 8,
    color: BRAND.muted,
    marginLeft: 10,
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: BRAND.line,
  },
  headerRight: { alignItems: "flex-end" },
  headerCompany: { fontSize: 8.5, fontWeight: 600, color: BRAND.ink },
  headerPeriod: { fontSize: 7.5, color: BRAND.muted },
  footer: {
    position: "absolute",
    bottom: 20,
    left: PAGE_PADDING_X,
    right: PAGE_PADDING_X,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: BRAND.line,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  footerLeft: { flexDirection: "row", alignItems: "center", maxWidth: 420 },
  footerLogo: { width: 14, height: 14, marginRight: 6 },
  footerText: { fontSize: 6.8, color: BRAND.muted, lineHeight: 1.4 },
  footerStrong: { fontWeight: 600, color: BRAND.ink },
  footerPage: { fontSize: 7.5, color: BRAND.muted, fontWeight: 500 },

  // Capa / abertura
  // Marca em destaque no topo da 1ª página
  brandBlock: {
    marginTop: -30,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingBottom: 14,
  },
  brandLogo: { width: 185, height: 52 },
  brandTagline: { fontSize: 8.5, color: BRAND.muted, textAlign: "right" },
  brandTaglineStrong: { fontSize: 9, fontWeight: 600, color: BRAND.blue, textAlign: "right" },
  hero: {
    marginHorizontal: -PAGE_PADDING_X,
    paddingHorizontal: PAGE_PADDING_X,
    paddingTop: 26,
    paddingBottom: 26,
    backgroundColor: BRAND.blue,
  },
  heroDivider: {
    marginBottom: 12,
    height: 3,
    width: 56,
    backgroundColor: BRAND.green,
    borderRadius: 2,
  },
  heroKicker: { fontSize: 8.5, color: "#D6E6FF", letterSpacing: 1.5, fontWeight: 600 },
  heroTitle: { fontSize: 24, fontWeight: 700, color: "#FFFFFF", marginTop: 4 },
  heroCompany: { fontSize: 13, fontWeight: 500, color: "#FFFFFF", marginTop: 8 },
  heroPeriod: { fontSize: 10, color: "#D6E6FF", marginTop: 3 },

  infoBox: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: BRAND.line,
    borderRadius: 8,
    padding: 12,
    backgroundColor: BRAND.surface,
  },
  infoGrid: { flexDirection: "row", flexWrap: "wrap" },
  infoItem: { width: "50%", marginBottom: 7, paddingRight: 8 },
  infoLabel: { fontSize: 6.8, color: BRAND.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  infoValue: { fontSize: 9, fontWeight: 500, marginTop: 1.5 },
  infoCode: { fontSize: 11, fontWeight: 700, color: BRAND.blue, marginTop: 1, letterSpacing: 1 },
  authenticity: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: BRAND.line,
    fontSize: 7.2,
    color: BRAND.muted,
    lineHeight: 1.45,
  },

  toc: { marginTop: 16 },
  tocItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.line,
  },
  tocNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: BRAND.blueSoft,
    color: BRAND.blue,
    fontSize: 8.5,
    fontWeight: 700,
    textAlign: "center",
    paddingTop: 4.5,
    marginRight: 10,
  },
  tocTitle: { fontSize: 10, fontWeight: 600 },
  tocText: { fontSize: 8, color: BRAND.muted, marginTop: 1 },

  // Seções
  sectionHead: { flexDirection: "row", alignItems: "center", marginTop: 4, marginBottom: 4 },
  sectionBar: { width: 4, height: 20, backgroundColor: BRAND.blue, borderRadius: 2, marginRight: 8 },
  sectionTitle: { fontSize: 15, fontWeight: 700 },
  sectionLead: { fontSize: 8.5, color: BRAND.muted, marginBottom: 12, marginLeft: 12, lineHeight: 1.4 },
  subTitle: { fontSize: 10.5, fontWeight: 600, marginTop: 11, marginBottom: 6 },
  note: { fontSize: 7.3, color: BRAND.muted, marginTop: 5, lineHeight: 1.4 },

  kpiGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  kpiCard: {
    width: "33.333%",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  kpiInner: {
    borderWidth: 1,
    borderColor: BRAND.line,
    borderRadius: 8,
    padding: 8,
    minHeight: 52,
  },
  kpiLabel: { fontSize: 7.4, color: BRAND.muted },
  kpiValue: { fontSize: 15, fontWeight: 700, marginTop: 3 },
  kpiFoot: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  kpiTrend: { fontSize: 7.2, fontWeight: 600 },
  kpiPrev: { fontSize: 6.8, color: BRAND.muted, marginLeft: 4 },

  highlights: {
    backgroundColor: BRAND.blueSoft,
    borderRadius: 8,
    padding: 11,
    marginBottom: 6,
  },
  highlightsTitle: { fontSize: 9, fontWeight: 700, color: BRAND.blueDark, marginBottom: 5 },
  highlightRow: { flexDirection: "row", marginBottom: 3 },
  highlightDot: { width: 10, color: BRAND.blue, fontWeight: 700 },
  highlightText: { flex: 1, fontSize: 8.5, lineHeight: 1.4 },

  twoCols: { flexDirection: "row", marginHorizontal: -6 },
  col: { flex: 1, paddingHorizontal: 6 },

  barRow: { marginBottom: 6 },
  barLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  barLabel: { fontSize: 8, color: BRAND.ink, maxWidth: "75%" },
  barValue: { fontSize: 8, fontWeight: 600 },
  barTrack: { height: 6, backgroundColor: "#EEF2F7", borderRadius: 3 },
  barFill: { height: 6, borderRadius: 3 },

  table: { borderWidth: 1, borderColor: BRAND.line, borderRadius: 6 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BRAND.line },
  trLast: { flexDirection: "row" },
  th: {
    fontSize: 7,
    fontWeight: 600,
    color: "#FFFFFF",
    paddingVertical: 5,
    paddingHorizontal: 5,
  },
  thRow: {
    flexDirection: "row",
    backgroundColor: BRAND.blue,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  td: { fontSize: 7.6, paddingVertical: 4.5, paddingHorizontal: 5 },
  empty: { fontSize: 8.5, color: BRAND.muted, paddingVertical: 8 },
});

// --------------------------------------------------------------------------
// Peças
// --------------------------------------------------------------------------

const SectionHeader = ({ title, lead }: { title: string; lead?: string }) => (
  <View wrap={false}>
    <View style={s.sectionHead}>
      <View style={s.sectionBar} />
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
    {lead ? <Text style={s.sectionLead}>{lead}</Text> : null}
  </View>
);

const trendColor = (good: boolean | null) =>
  good === null ? BRAND.muted : good ? "#059669" : BRAND.red;

const trendArrow = (direction: "up" | "down" | "flat") =>
  direction === "up" ? "↑ " : direction === "down" ? "↓ " : "";

type KpiDef = {
  label: string;
  value: string;
  current?: number | null;
  previous?: number | null;
  previousLabel?: string;
  higherIsBetter?: boolean;
  hint?: string;
};

const KpiGrid = ({ items }: { items: KpiDef[] }) => (
  <View style={s.kpiGrid}>
    {items.map((item) => {
      const hasCompare = item.current !== undefined && item.previous !== undefined;
      const trend = hasCompare
        ? compareValues(item.current ?? null, item.previous ?? null, item.higherIsBetter ?? true)
        : null;
      return (
        <View key={item.label} style={s.kpiCard} wrap={false}>
          <View style={s.kpiInner}>
            <Text style={s.kpiLabel}>{item.label}</Text>
            <Text style={s.kpiValue}>{item.value}</Text>
            {trend ? (
              <View style={s.kpiFoot}>
                <Text style={[s.kpiTrend, { color: trendColor(trend.good) }]}>
                  {trendArrow(trend.direction)}
                  {formatTrend(trend)}
                </Text>
                <Text style={s.kpiPrev}>antes: {item.previousLabel ?? "-"}</Text>
              </View>
            ) : item.hint ? (
              <View style={s.kpiFoot}>
                <Text style={s.kpiPrev}>{item.hint}</Text>
              </View>
            ) : null}
          </View>
        </View>
      );
    })}
  </View>
);

const Bars = ({
  rows,
  color = BRAND.blue,
  format = formatInt,
}: {
  rows: Array<{ label: string; value: number; color?: string }>;
  color?: string;
  format?: (value: number) => string;
}) => {
  if (rows.length === 0) return <Text style={s.empty}>Sem dados no período.</Text>;
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <View>
      {rows.map((row, index) => (
        <View key={`${row.label}-${index}`} style={s.barRow} wrap={false}>
          <View style={s.barLabelRow}>
            <Text style={s.barLabel}>{row.label}</Text>
            <Text style={s.barValue}>{format(row.value)}</Text>
          </View>
          <View style={s.barTrack}>
            <View
              style={[
                s.barFill,
                {
                  width: `${row.value > 0 ? Math.max(2, (row.value / max) * 100) : 0}%`,
                  backgroundColor: row.color ?? color,
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
};

type Column<T> = {
  title: string;
  width: number; // flex
  align?: "left" | "right" | "center";
  render: (row: T) => string;
  color?: (row: T) => string | undefined;
};

function Table<T>({
  columns,
  rows,
  emptyText = "Sem dados no período.",
}: {
  columns: Column<T>[];
  rows: T[];
  emptyText?: string;
}) {
  if (rows.length === 0) return <Text style={s.empty}>{emptyText}</Text>;
  return (
    <View style={s.table}>
      <View style={s.thRow} fixed>
        {columns.map((col) => (
          <Text
            key={col.title}
            style={[s.th, { flex: col.width, textAlign: col.align ?? "left" }]}
          >
            {col.title}
          </Text>
        ))}
      </View>
      {rows.map((row, index) => (
        <View
          key={index}
          wrap={false}
          style={[
            index === rows.length - 1 ? s.trLast : s.tr,
            { backgroundColor: index % 2 === 1 ? BRAND.surface : "#FFFFFF" },
          ]}
        >
          {columns.map((col) => (
            <Text
              key={col.title}
              style={[
                s.td,
                {
                  flex: col.width,
                  textAlign: col.align ?? "left",
                  color: col.color?.(row) ?? BRAND.ink,
                },
              ]}
            >
              {col.render(row)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const ColumnsChart = ({
  rows,
}: {
  rows: Array<{ label: string; leads: number; closed: number }>;
}) => {
  if (rows.length === 0) return <Text style={s.empty}>Sem dados no período.</Text>;
  const max = Math.max(1, ...rows.map((row) => Math.max(row.leads, row.closed)));
  const height = 90;
  const labelEvery = Math.max(1, Math.ceil(rows.length / 12));
  return (
    <View wrap={false}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", height, borderBottomWidth: 1, borderBottomColor: BRAND.line }}>
        {rows.map((row, index) => (
          <View
            key={`${row.label}-${index}`}
            style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", height, paddingHorizontal: 1 }}
          >
            <View style={{ width: "42%", height: (row.leads / max) * (height - 6), backgroundColor: BRAND.blue, borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5 }} />
            <View style={{ width: "42%", height: (row.closed / max) * (height - 6), backgroundColor: BRAND.green, borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5, marginLeft: 1 }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", marginTop: 3 }}>
        {rows.map((row, index) => (
          <Text key={`${row.label}-l-${index}`} style={{ flex: 1, fontSize: 6, color: BRAND.muted, textAlign: "center" }}>
            {index % labelEvery === 0 ? row.label : ""}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", marginTop: 6 }}>
        <Legend color={BRAND.blue} label="Novas conversas" />
        <Legend color={BRAND.green} label="Finalizadas" />
      </View>
    </View>
  );
};

const Legend = ({ color, label }: { color: string; label: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center", marginRight: 14 }}>
    <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color, marginRight: 4 }} />
    <Text style={{ fontSize: 7.4, color: BRAND.muted }}>{label}</Text>
  </View>
);

// Interpola do azul bem claro ao azul da marca
const heatColor = (ratio: number) => {
  if (ratio <= 0) return "#F5F8FC";
  const from = [232, 240, 255];
  const to = [0, 102, 255];
  const mix = from.map((value, index) =>
    Math.round(value + (to[index] - value) * Math.min(1, 0.15 + ratio * 0.85)),
  );
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
};

const Heatmap = ({ cells }: { cells: OperationalReport["sla"]["heatmap"] }) => {
  const max = Math.max(1, ...cells.map((cell) => cell.messages));
  const value = (weekday: number, hour: number) =>
    cells.find((cell) => cell.weekday === weekday && cell.hour === hour)?.messages ?? 0;
  return (
    <View wrap={false}>
      {WEEKDAY_SHORT.map((label, index) => (
        <View key={label} style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
          <Text style={{ width: 26, fontSize: 7, color: BRAND.muted }}>{label}</Text>
          {Array.from({ length: 24 }, (_, hour) => {
            const count = value(index + 1, hour);
            return (
              <View
                key={hour}
                style={{
                  flex: 1,
                  height: 13,
                  marginRight: 1.5,
                  borderRadius: 2,
                  backgroundColor: heatColor(count / max),
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {count > 0 && count / max >= 0.5 ? (
                  <Text style={{ fontSize: 5.2, color: "#FFFFFF", fontWeight: 600 }}>{count}</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
      <View style={{ flexDirection: "row", marginTop: 2 }}>
        <View style={{ width: 26 }} />
        {Array.from({ length: 24 }, (_, hour) => (
          <Text key={hour} style={{ flex: 1, fontSize: 5.8, color: BRAND.muted, textAlign: "center", marginRight: 1.5 }}>
            {hour % 3 === 0 ? `${hour}h` : ""}
          </Text>
        ))}
      </View>
    </View>
  );
};

const SCORE_COLORS: Record<number, string> = {
  1: "#EF4444",
  2: "#F97316",
  3: "#F59E0B",
  4: "#22C55E",
  5: BRAND.green,
};

// --------------------------------------------------------------------------
// Seções
// --------------------------------------------------------------------------

const prevLabel = (
  value: number | null,
  fmt: (value: number | null) => string,
) => fmt(value);

const SummarySection = ({ report, previousLabel }: SectionProps) => {
  const { current: c, previous: p } = report.summary;
  const highlights = buildHighlights(report);
  const kpi = (
    label: string,
    key: keyof PeriodKpis,
    fmt: (value: number | null) => string,
    higherIsBetter = true,
  ): KpiDef => ({
    label,
    value: fmt(c[key] as number | null),
    current: c[key] as number | null,
    previous: p[key] as number | null,
    previousLabel: prevLabel(p[key] as number | null, fmt),
    higherIsBetter,
  });

  return (
    <View>
      <SectionHeader
        title="Resumo executivo"
        lead={`Os principais números do período, comparados com o período anterior de mesmo tamanho (${previousLabel}).`}
      />
      {highlights.length > 0 && (
        <View style={s.highlights} wrap={false}>
          <Text style={s.highlightsTitle}>Destaques do período</Text>
          {highlights.map((text) => (
            <View key={text} style={s.highlightRow}>
              <Text style={s.highlightDot}>•</Text>
              <Text style={s.highlightText}>{text}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={s.subTitle}>Volume</Text>
      <KpiGrid
        items={[
          kpi("Novas conversas", "leads", formatInt),
          kpi("Conversas finalizadas", "closed", formatInt),
          {
            label: "Conversas ativas agora",
            value: formatInt(report.summary.activeNow),
            hint: "abertas ou pendentes no momento da geração",
          },
          kpi("Contatos atendidos", "contactsServed", formatInt),
          kpi("Mensagens recebidas", "inboundMessages", formatInt),
          kpi("Mensagens enviadas pela equipe", "outboundMessages", formatInt),
        ]}
      />

      <Text style={s.subTitle}>Qualidade do atendimento</Text>
      <KpiGrid
        items={[
          kpi("1ª resposta (mediana)", "p50FirstResponseSec", formatDuration, false),
          kpi("Dentro da meta de 1ª resposta", "withinSlaPct", formatPct),
          kpi("Tempo até finalizar (mediana)", "p50ResolutionSec", formatDuration, false),
          kpi("Sem resposta humana", "unansweredLeads", formatInt, false),
          kpi("Nota média (1 a 5)", "averageScore", formatScore),
          kpi("CSAT (notas 4 e 5)", "csatPct", formatPct),
        ]}
      />

      <View wrap={false}>
        <Text style={s.subTitle}>Conversas por dia</Text>
        <ColumnsChart rows={groupDailySeries(report.daily)} />
      </View>

      <View style={s.twoCols} wrap={false}>
        <View style={s.col}>
          <Text style={s.subTitle}>Novas conversas por canal</Text>
          <Bars
            rows={report.leadsByChannel.map((row) => ({
              label: channelLabel(row.channel),
              value: row.leads,
            }))}
          />
        </View>
        <View style={s.col}>
          <Text style={s.subTitle}>Novas conversas por departamento</Text>
          <Bars
            color={BRAND.green}
            rows={report.leadsByDepartment.slice(0, 8).map((row) => ({
              label: row.department,
              value: row.leads,
            }))}
          />
        </View>
      </View>
      <Text style={s.note}>
        Mediana: metade das conversas ficou abaixo deste tempo. 1ª resposta conta só mensagens da equipe (bots e mensagens automáticas não entram).
      </Text>
    </View>
  );
};

const TeamSection = ({ report }: { report: OperationalReport }) => {
  const rows = report.team;
  const active = rows.filter((row) => row.conversations > 0);
  const fastest = [...active]
    .filter((row) => row.p50FirstResponseSec !== null)
    .sort((a, b) => (a.p50FirstResponseSec ?? 0) - (b.p50FirstResponseSec ?? 0))[0];
  const mostClosed = [...active].sort((a, b) => b.closed - a.closed)[0];
  const bestScore = [...active]
    .filter((row) => row.surveysAnswered >= 3 && row.averageScore !== null)
    .sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0))[0];

  return (
    <View>
      <SectionHeader
        title="Desempenho da equipe"
        lead="Produção e qualidade de cada pessoa da equipe no período. Os números consideram o responsável atual de cada conversa."
      />
      <KpiGrid
        items={[
          {
            label: "Pessoas com atendimentos",
            value: `${active.length} de ${rows.length}`,
            hint: "na equipe da empresa",
          },
          {
            label: "Mais conversas finalizadas",
            value: mostClosed && mostClosed.closed > 0 ? mostClosed.name : "-",
            hint: mostClosed && mostClosed.closed > 0 ? `${mostClosed.closed} finalizadas` : undefined,
          },
          {
            label: "1ª resposta mais rápida",
            value: fastest ? fastest.name : "-",
            hint: fastest ? `mediana de ${formatDuration(fastest.p50FirstResponseSec)}` : undefined,
          },
        ]}
      />
      <Table
        rows={rows}
        columns={[
          { title: "Atendente", width: 2.2, render: (r) => r.name },
          { title: "Conversas", width: 1, align: "right", render: (r) => formatInt(r.conversations) },
          { title: "Finalizadas", width: 1.1, align: "right", render: (r) => formatInt(r.closed) },
          { title: "Msgs enviadas", width: 1.2, align: "right", render: (r) => formatInt(r.outboundMessages) },
          { title: "1ª resposta", width: 1.3, align: "right", render: (r) => formatDuration(r.p50FirstResponseSec) },
          {
            title: "Na meta",
            width: 1,
            align: "right",
            render: (r) => formatPct(r.withinSlaPct),
            color: (r) =>
              r.withinSlaPct === null ? undefined : r.withinSlaPct >= 80 ? "#059669" : r.withinSlaPct < 50 ? BRAND.red : undefined,
          },
          { title: "Até finalizar", width: 1.3, align: "right", render: (r) => formatDuration(r.p50ResolutionSec) },
          {
            title: "Nota",
            width: 0.9,
            align: "right",
            render: (r) => (r.averageScore === null ? "-" : `${formatScore(r.averageScore)} (${r.surveysAnswered})`),
          },
          { title: "Último acesso", width: 2, align: "right", render: (r) => formatDateTime(r.lastSeenAt) },
        ]}
      />
      <Text style={s.note}>
        1ª resposta e Até finalizar são medianas. Na meta: conversas respondidas dentro de {formatDuration(report.slaThresholdSec)}. Nota: média das avaliações (quantidade entre parênteses).
        {bestScore ? ` Melhor nota com 3 ou mais avaliações: ${bestScore.name} (${formatScore(bestScore.averageScore)}).` : ""}
      </Text>
    </View>
  );
};

const SlaSection = ({ report }: { report: OperationalReport }) => {
  const c = report.summary.current;
  const slaColumns = (labelTitle: string, label: (v: string) => string): Column<OperationalReport["sla"]["byChannel"][number]>[] => [
    { title: labelTitle, width: 2.2, render: (r) => label(r.label) },
    { title: "Respondidas", width: 1.1, align: "right", render: (r) => formatInt(r.count) },
    { title: "Mediana", width: 1.2, align: "right", render: (r) => formatDuration(r.p50Sec) },
    { title: "90% em até", width: 1.2, align: "right", render: (r) => formatDuration(r.p90Sec) },
    {
      title: "Na meta",
      width: 1,
      align: "right",
      render: (r) => formatPct(r.withinSlaPct),
      color: (r) =>
        r.withinSlaPct === null ? undefined : r.withinSlaPct >= 80 ? "#059669" : r.withinSlaPct < 50 ? BRAND.red : undefined,
    },
  ];

  return (
    <View>
      <SectionHeader
        title="Atendimento e SLA"
        lead={`Quanto tempo o cliente espera pela 1ª resposta da equipe, onde a meta de ${formatDuration(report.slaThresholdSec)} é cumprida e quando a demanda é maior.`}
      />
      <KpiGrid
        items={[
          { label: "Meta de 1ª resposta", value: formatDuration(report.slaThresholdSec), hint: "configurada nas automações" },
          { label: "1ª resposta (mediana)", value: formatDuration(c.p50FirstResponseSec), hint: `${formatInt(c.firstResponseCount)} conversas respondidas` },
          { label: "90% responderam em até", value: formatDuration(c.p90FirstResponseSec) },
          { label: "Dentro da meta", value: formatPct(c.withinSlaPct) },
          { label: "Sem resposta humana", value: formatInt(c.unansweredLeads), hint: "conversas iniciadas no período" },
          { label: "Finalizadas automaticamente", value: formatInt(c.autoClosed), hint: "por inatividade" },
        ]}
      />

      <View style={s.twoCols}>
        <View style={s.col} wrap={false}>
          <Text style={s.subTitle}>Tempo até a 1ª resposta</Text>
          <Bars
            rows={report.sla.buckets.map((row, index) => ({
              label: row.label,
              value: row.count,
              color: index <= 1 ? BRAND.green : index <= 3 ? BRAND.amber : BRAND.red,
            }))}
          />
        </View>
        <View style={s.col} wrap={false}>
          <Text style={s.subTitle}>Por canal</Text>
          <Table rows={report.sla.byChannel} columns={slaColumns("Canal", channelLabel).filter((col) => col.title !== "90% em até")} />
        </View>
      </View>

      <View wrap={false}>
        <Text style={s.subTitle}>Por departamento</Text>
        <Table rows={report.sla.byDepartment} columns={slaColumns("Departamento", (v) => v)} />
      </View>

      <View wrap={false}>
        <Text style={s.subTitle}>Mensagens recebidas por dia da semana e hora</Text>
        <Heatmap cells={report.sla.heatmap} />
        <Text style={s.note}>Quanto mais escuro, mais mensagens de clientes chegaram naquele horário. Use para dimensionar a escala da equipe.</Text>
      </View>

      <Text style={s.subTitle}>Conversas fora da meta (as 20 que mais esperaram)</Text>
      <Table
        rows={report.sla.slowest}
        emptyText="Nenhuma conversa fora da meta no período."
        columns={[
          { title: "Contato", width: 2, render: (r) => r.contact },
          { title: "Canal", width: 1, render: (r) => channelLabel(r.channel) },
          { title: "Departamento", width: 1.5, render: (r) => r.department },
          { title: "Responsável", width: 1.5, render: (r) => r.assignedTo },
          { title: "1ª mensagem", width: 1.5, render: (r) => formatDateTime(r.firstInboundAt) },
          {
            title: "Esperou",
            width: 1.1,
            align: "right",
            render: (r) => (r.seconds === null ? "Sem resposta" : formatDuration(r.seconds)),
            color: () => BRAND.red,
          },
        ]}
      />
    </View>
  );
};

const SatisfactionSection = ({ report }: { report: OperationalReport }) => {
  const c = report.summary.current;
  const p = report.summary.previous;
  const responseRate = c.surveysSent ? (c.surveysAnswered / c.surveysSent) * 100 : null;
  const agents = report.team.filter((row) => row.surveysAnswered > 0);

  return (
    <View>
      <SectionHeader
        title="Satisfação (CSAT)"
        lead="Notas de 1 a 5 dadas pelos clientes na pesquisa enviada ao finalizar a conversa."
      />
      <KpiGrid
        items={[
          { label: "Nota média", value: formatScore(c.averageScore), current: c.averageScore, previous: p.averageScore, previousLabel: formatScore(p.averageScore) },
          { label: "CSAT (notas 4 e 5)", value: formatPct(c.csatPct), current: c.csatPct, previous: p.csatPct, previousLabel: formatPct(p.csatPct) },
          { label: "Taxa de resposta", value: formatPct(responseRate), hint: `${formatInt(c.surveysAnswered)} de ${formatInt(c.surveysSent)} pesquisas` },
        ]}
      />
      <View style={s.twoCols}>
        <View style={s.col} wrap={false}>
          <Text style={s.subTitle}>Distribuição das notas</Text>
          <Bars
            rows={[...report.satisfaction.distribution].reverse().map((row) => ({
              label: `Nota ${row.score}`,
              value: row.count,
              color: SCORE_COLORS[row.score],
            }))}
          />
        </View>
        <View style={s.col} wrap={false}>
          <Text style={s.subTitle}>Por departamento</Text>
          <Table
            rows={report.satisfaction.byDepartment}
            emptyText="Nenhuma avaliação no período."
            columns={[
              { title: "Departamento", width: 2, render: (r) => r.label },
              { title: "Avaliações", width: 1, align: "right", render: (r) => formatInt(r.answered) },
              { title: "Média", width: 0.8, align: "right", render: (r) => formatScore(r.averageScore) },
            ]}
          />
        </View>
      </View>

      <View wrap={false}>
        <Text style={s.subTitle}>Por atendente</Text>
        <Table
          rows={[...agents].sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0))}
          emptyText="Nenhuma avaliação no período."
          columns={[
            { title: "Atendente", width: 2.5, render: (r) => r.name },
            { title: "Avaliações", width: 1, align: "right", render: (r) => formatInt(r.surveysAnswered) },
            { title: "Nota média", width: 1, align: "right", render: (r) => formatScore(r.averageScore) },
          ]}
        />
      </View>

      <Text style={s.subTitle}>Notas 1 e 2 (para investigar)</Text>
      <Table
        rows={report.satisfaction.lowScores}
        emptyText="Nenhuma nota 1 ou 2 no período."
        columns={[
          { title: "Data", width: 1.4, render: (r) => formatDateTime(r.answeredAt) },
          { title: "Nota", width: 0.6, align: "center", render: (r) => String(r.score), color: (r) => SCORE_COLORS[r.score] },
          { title: "Contato", width: 1.6, render: (r) => r.contact },
          { title: "Atendente", width: 1.4, render: (r) => r.agent },
          { title: "Departamento", width: 1.4, render: (r) => r.department },
          { title: "Resposta do cliente", width: 2.4, render: (r) => r.comment ?? "-" },
        ]}
      />
    </View>
  );
};

// --------------------------------------------------------------------------
// Documento
// --------------------------------------------------------------------------

const SECTION_ORDER: Array<Exclude<ReportType, "full">> = ["summary", "team", "sla", "satisfaction"];

const SECTION_DESCRIPTION: Record<Exclude<ReportType, "full">, string> = {
  summary: "Volume, qualidade e comparação com o período anterior",
  team: "Produção, tempo de resposta e nota de cada pessoa",
  sla: "Tempo de 1ª resposta, meta, horários de pico e atrasos",
  satisfaction: "Notas dos clientes, por atendente e departamento",
};

const SECTION_COMPONENT: Record<Exclude<ReportType, "full">, React.FC<SectionProps>> = {
  summary: SummarySection,
  team: TeamSection,
  sla: SlaSection,
  satisfaction: SatisfactionSection,
};

type SectionProps = { report: OperationalReport; previousLabel: string };

const previousPeriodLabel = (context: ExportContext) => {
  const range = previousRange(context.filters.startDay, context.filters.endDay);
  return formatPeriod(range.startDay, range.endDay);
};

const PageChrome = ({ context }: { context: ExportContext }) => (
  <>
    <View style={s.topStripe} fixed>
      <View style={{ flex: 4, backgroundColor: BRAND.blue }} />
      <View style={{ flex: 1, backgroundColor: BRAND.green }} />
    </View>
    <View
      style={s.header}
      fixed
      // Na 1ª página a marca já aparece grande na abertura
      render={({ pageNumber }) =>
        pageNumber === 1 ? null : (
          <View style={s.headerInner}>
            <View style={s.headerBrand}>
              <Image src={logoWordmark} style={s.headerLogo} />
              <Text style={s.headerTitle}>{REPORT_TYPE_LABEL[context.type]}</Text>
            </View>
            <View style={s.headerRight}>
              <Text style={s.headerCompany}>{context.companyName}</Text>
              <Text style={s.headerPeriod}>
                {formatPeriod(context.filters.startDay, context.filters.endDay)}
              </Text>
            </View>
          </View>
        )
      }
    />
    <View style={s.footer} fixed>
      <View style={s.footerLeft}>
        <Image src={logoIcon} style={s.footerLogo} />
        <View>
          <Text style={s.footerText}>
            Documento gerado pela plataforma <Text style={s.footerStrong}>Unxet</Text> em{" "}
            {formatDateTimeLong(context.generatedAt)} por{" "}
            <Text style={s.footerStrong}>{context.generatedByName}</Text> · {context.companyName}
          </Text>
          <Text style={s.footerText}>
            Código de verificação <Text style={s.footerStrong}>{context.code}</Text> · SHA-256{" "}
            {context.dataHash.slice(0, 16)}…
          </Text>
        </View>
      </View>
      <Text
        style={s.footerPage}
        render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
      />
    </View>
  </>
);

const Cover = ({
  context,
  report,
}: {
  context: ExportContext;
  report: OperationalReport;
}) => (
  <View>
    <View style={s.brandBlock}>
      <Image src={logoWordmark} style={s.brandLogo} />
      <View>
        <Text style={s.brandTaglineStrong}>Relatório oficial da plataforma</Text>
        <Text style={s.brandTagline}>Atendimento multicanal</Text>
      </View>
    </View>
    <View style={s.hero}>
      <View style={s.heroDivider} />
      <Text style={s.heroKicker}>RELATÓRIO OPERACIONAL</Text>
      <Text style={s.heroTitle}>{REPORT_TYPE_LABEL[context.type]}</Text>
      <Text style={s.heroCompany}>{context.companyName}</Text>
      <Text style={s.heroPeriod}>
        Período: {formatPeriod(context.filters.startDay, context.filters.endDay)}
      </Text>
    </View>

    <View style={s.infoBox} wrap={false}>
      <View style={s.infoGrid}>
        <Info label="Empresa" value={context.companyName} />
        <Info label="Período analisado" value={formatPeriod(context.filters.startDay, context.filters.endDay)} />
        <Info
          label="Comparado com"
          value={previousPeriodLabel(context)}
        />
        <Info label="Canais" value={context.filterLabels.channels} />
        <Info label="Departamento" value={context.filterLabels.department} />
        <Info label="Atendente" value={context.filterLabels.attendant} />
        <Info label="Gerado em" value={formatDateTimeLong(context.generatedAt)} />
        <Info label="Gerado por" value={context.generatedByName} />
        <View style={s.infoItem}>
          <Text style={s.infoLabel}>Código de verificação</Text>
          <Text style={s.infoCode}>{context.code}</Text>
        </View>
        <Info label="Fuso horário" value={report.timezone} />
      </View>
      <Text style={s.authenticity}>
        Este documento foi gerado automaticamente pela plataforma Unxet a partir dos dados de atendimento da empresa {context.companyName}.
        Para confirmar a autenticidade, um administrador pode consultar o código {context.code} na tela Relatórios da Unxet.
        Impressão digital dos dados (SHA-256): {context.dataHash}
      </Text>
    </View>

    {context.type === "full" && (
      <View style={s.toc} wrap={false}>
        <Text style={s.subTitle}>Neste relatório</Text>
        {SECTION_ORDER.map((key, index) => (
          <View key={key} style={s.tocItem}>
            <Text style={s.tocNumber}>{index + 1}</Text>
            <View>
              <Text style={s.tocTitle}>{REPORT_TYPE_LABEL[key]}</Text>
              <Text style={s.tocText}>{SECTION_DESCRIPTION[key]}</Text>
            </View>
          </View>
        ))}
      </View>
    )}
  </View>
);

const Info = ({ label, value }: { label: string; value: string }) => (
  <View style={s.infoItem}>
    <Text style={s.infoLabel}>{label}</Text>
    <Text style={s.infoValue}>{value}</Text>
  </View>
);

export const ReportDocument = ({
  report,
  context,
}: {
  report: OperationalReport;
  context: ExportContext;
}) => {
  const sections = context.type === "full" ? SECTION_ORDER : [context.type];
  const title = `${REPORT_TYPE_LABEL[context.type]} - ${context.companyName} - ${formatPeriod(context.filters.startDay, context.filters.endDay)}`;

  return (
    <Document
      title={title}
      author={`Unxet · ${context.generatedByName}`}
      subject={`Relatório operacional Unxet · código ${context.code}`}
      creator="Unxet"
      producer="Unxet"
      keywords={`Unxet, relatório, ${context.code}`}
      language="pt-BR"
    >
      {context.type === "full" ? (
        <>
          <Page size="A4" style={s.page}>
            <PageChrome context={context} />
            <Cover context={context} report={report} />
          </Page>
          {sections.map((key) => {
            const Section = SECTION_COMPONENT[key];
            return (
              <Page key={key} size="A4" style={s.page}>
                <PageChrome context={context} />
                <Section report={report} previousLabel={previousPeriodLabel(context)} />
              </Page>
            );
          })}
        </>
      ) : (
        <Page size="A4" style={s.page}>
          <PageChrome context={context} />
          <Cover context={context} report={report} />
          <View break>
            {React.createElement(SECTION_COMPONENT[sections[0] as Exclude<ReportType, "full">], {
              report,
              previousLabel: previousPeriodLabel(context),
            })}
          </View>
        </Page>
      )}
    </Document>
  );
};

