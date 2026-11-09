import {
  WEEKDAY_SHORT,
  channelLabel,
  compareValues,
  formatDuration,
  formatPct,
  formatScore,
  formatTrend,
} from "./format";
import type { OperationalReport } from "./types";
import { satisfiedFrom, scoreRangeLabel } from "./surveyScale";

/**
 * Frases curtas com o que mais mudou no período, para a pessoa não precisar
 * cruzar os números sozinha. Só entram afirmações que os dados sustentam.
 */
export const buildHighlights = (report: OperationalReport): string[] => {
  const { current, previous } = report.summary;
  const items: string[] = [];

  const leadsTrend = compareValues(current.leads, previous.leads);
  if (current.leads > 0 && leadsTrend.pct !== null && leadsTrend.direction !== "flat") {
    items.push(
      `${current.leads} novas conversas no período, ${formatTrend(leadsTrend)} em relação ao período anterior.`,
    );
  } else if (current.leads > 0) {
    items.push(`${current.leads} novas conversas no período.`);
  }

  if (current.p50FirstResponseSec !== null) {
    const trend = compareValues(current.p50FirstResponseSec, previous.p50FirstResponseSec, false);
    const base = `Metade dos clientes recebeu a 1ª resposta humana em até ${formatDuration(current.p50FirstResponseSec)}`;
    items.push(
      trend.pct !== null && trend.direction !== "flat"
        ? `${base} (${trend.good ? "melhorou" : "piorou"} ${formatTrend(trend).replace(/^[+-]/, "")}).`
        : `${base}.`,
    );
  }

  if (current.withinSlaPct !== null) {
    items.push(
      `${formatPct(current.withinSlaPct)} das conversas foram respondidas dentro da meta de ${formatDuration(report.slaThresholdSec)}.`,
    );
  }

  if (current.unansweredLeads > 0) {
    items.push(
      `${current.unansweredLeads} ${current.unansweredLeads === 1 ? "conversa iniciada no período ainda não recebeu" : "conversas iniciadas no período ainda não receberam"} resposta humana.`,
    );
  }

  const peak = [...report.sla.heatmap].sort((a, b) => b.messages - a.messages)[0];
  if (peak && peak.messages > 0) {
    items.push(
      `Maior movimento: ${WEEKDAY_SHORT[peak.weekday - 1]} das ${peak.hour}h às ${peak.hour + 1}h (${peak.messages} mensagens recebidas).`,
    );
  }

  const topChannel = report.leadsByChannel[0];
  if (topChannel && current.leads > 0) {
    const share = (topChannel.leads / current.leads) * 100;
    items.push(`${channelLabel(topChannel.channel)} trouxe ${formatPct(share)} das novas conversas.`);
  }

  if (current.averageScore !== null) {
    const scale = { min: report.satisfaction.scaleMin, max: report.satisfaction.scaleMax };
    items.push(
      `Nota média de satisfação ${formatScore(current.averageScore)} de ${scale.max}, com ${current.surveysAnswered} ${current.surveysAnswered === 1 ? "avaliação" : "avaliações"} (${formatPct(current.csatPct)} de notas ${scoreRangeLabel(satisfiedFrom(scale), scale.max)}).`,
    );
  }

  return items.slice(0, 6);
};
