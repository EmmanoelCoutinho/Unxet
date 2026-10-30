import React from "react";
import type {
  CampaignStats,
  ScheduledMessageStatus,
} from "../types/scheduledMessages";
import {
  estimateSendDurationMs,
  formatCurrency,
  formatDuration,
  progressPercent,
  ratePercent,
} from "../utils/schedule";

const segmentWidth = (part: number, total: number) =>
  total > 0 ? `${(part / total) * 100}%` : "0%";

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const LegendItem: React.FC<{ color: string; label: string }> = ({
  color,
  label,
}) => (
  <li className="flex items-center gap-1.5">
    <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
    {label}
  </li>
);

/**
 * Barra de envio: verde = enviadas, vermelho = falharam, cinza = canceladas.
 * Enquanto envia, mostra a porcentagem e a previsão de término.
 */
export const CampaignProgress: React.FC<{
  stats: CampaignStats;
  status: ScheduledMessageStatus;
  compact?: boolean;
}> = ({ stats, status, compact = false }) => {
  const percent = progressPercent(stats);
  const done = stats.total - stats.waiting;
  const sending = status === "processing";

  // Enviando: quanto do envio já andou. Terminado: quantos receberam (a barra
  // cheia com verde e vermelho mostra o que deu certo e o que falhou).
  const title = sending
    ? `Enviando · ${percent}%`
    : status === "cancelled"
      ? "Envio cancelado"
      : "Envio concluído";
  const detail = sending
    ? `${done} de ${stats.total}${
        stats.waiting > 0
          ? ` · termina em ~${formatDuration(estimateSendDurationMs(stats.waiting))}`
          : ""
      }`
    : `${stats.sent} de ${stats.total} receberam (${ratePercent(stats.sent, stats.total)}%)`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold text-slate-800">{title}</span>
        <span className="text-slate-500">{detail}</span>
      </div>
      <div
        className={`mt-1.5 flex w-full overflow-hidden rounded-full bg-slate-100 ${
          compact ? "h-1.5" : "h-2.5"
        }`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Progresso do envio"
      >
        <div
          className="h-full bg-green-500 transition-all duration-700"
          style={{ width: segmentWidth(stats.sent, stats.total) }}
        />
        <div
          className="h-full bg-red-400 transition-all duration-700"
          style={{ width: segmentWidth(stats.failed, stats.total) }}
        />
        <div
          className="h-full bg-slate-300 transition-all duration-700"
          style={{ width: segmentWidth(stats.cancelled, stats.total) }}
        />
      </div>
      {!compact && (stats.failed > 0 || stats.cancelled > 0) && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          <LegendItem color="bg-green-500" label={plural(stats.sent, "enviada", "enviadas")} />
          {stats.failed > 0 && (
            <LegendItem color="bg-red-400" label={plural(stats.failed, "com falha", "com falha")} />
          )}
          {stats.cancelled > 0 && (
            <LegendItem color="bg-slate-300" label={plural(stats.cancelled, "cancelada", "canceladas")} />
          )}
          {stats.waiting > 0 && (
            <LegendItem color="bg-slate-100 border border-slate-300" label={plural(stats.waiting, "na fila", "na fila")} />
          )}
        </ul>
      )}
    </div>
  );
};

type FunnelStep = {
  key: string;
  label: string;
  value: number;
  hint: string;
  tone: string;
};

const funnelSteps = (stats: CampaignStats): FunnelStep[] => [
  {
    key: "sent",
    label: "Enviadas",
    value: stats.sent,
    hint: `${ratePercent(stats.sent, stats.total)}% do total`,
    tone: "text-slate-900",
  },
  {
    key: "delivered",
    label: "Entregues",
    value: stats.delivered,
    hint: `${ratePercent(stats.delivered, stats.sent)}% das enviadas`,
    tone: "text-slate-900",
  },
  {
    key: "read",
    label: "Lidas",
    value: stats.read,
    hint: `${ratePercent(stats.read, stats.sent)}% das enviadas`,
    tone: "text-slate-900",
  },
  {
    key: "replied",
    label: "Responderam",
    value: stats.replied,
    hint: `${ratePercent(stats.replied, stats.sent)}% das enviadas`,
    tone: "text-blue-700",
  },
  {
    key: "converted",
    label: "Aderiram",
    value: stats.converted,
    hint: `${ratePercent(stats.converted, stats.sent)}% das enviadas`,
    tone: "text-green-700",
  },
];

/** Resultado completo (detalhe da campanha). */
export const CampaignFunnel: React.FC<{ stats: CampaignStats }> = ({ stats }) => (
  <div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {funnelSteps(stats).map((step) => (
        <div
          key={step.key}
          className="rounded-xl border border-slate-200 bg-white px-3 py-3"
        >
          <p className="text-xs font-medium text-slate-500">{step.label}</p>
          <p className={`mt-1 text-2xl font-semibold ${step.tone}`}>{step.value}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{step.hint}</p>
        </div>
      ))}
    </div>
    {stats.revenue > 0 && (
      <p className="mt-3 text-sm text-slate-600">
        Valor das adesões:{" "}
        <span className="font-semibold text-green-700">
          {formatCurrency(stats.revenue)}
        </span>
      </p>
    )}
  </div>
);

/** Resumo em uma linha (lista de campanhas). */
export const CampaignFunnelInline: React.FC<{ stats: CampaignStats }> = ({
  stats,
}) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
    <span>
      <span className="font-semibold text-slate-800">{stats.sent}</span> enviadas
    </span>
    <span>
      <span className="font-semibold text-slate-800">{stats.read}</span> lidas
    </span>
    <span>
      <span className="font-semibold text-blue-700">{stats.replied}</span>{" "}
      responderam
    </span>
    <span>
      <span className="font-semibold text-green-700">{stats.converted}</span>{" "}
      aderiram
    </span>
    {stats.revenue > 0 && (
      <span className="font-semibold text-green-700">
        {formatCurrency(stats.revenue)}
      </span>
    )}
  </div>
);
