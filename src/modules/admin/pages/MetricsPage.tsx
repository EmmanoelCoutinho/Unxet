import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { adminSupabase } from "../lib/adminSupabaseClient";

type Counter = { total: number; period: number };

type PlatformMetrics = {
  days: number;
  generated_at: string;
  clinics: { total: number; new: number; active: number };
  people: { total: number; admins: number; agents: number; active: number };
  contacts: { total: number; new: number };
  conversations: {
    total: number;
    period: number;
    open: number;
    pending: number;
    closed: number;
  };
  conversations_by_channel: Array<{ channel: string; conversations: number }>;
  messages: {
    total: number;
    period: number;
    period_inbound: number;
    period_outbound: number;
    period_automated: number;
  };
  media: {
    images: Counter;
    audios: Counter;
    videos: Counter;
    documents: Counter;
    stickers: Counter;
    transcribed: Counter;
  };
  channels: {
    connected: number;
    connected_qr: number;
    connected_official: number;
  };
  bots: {
    active: number;
    sessions: number;
    resolved: number;
    handed_off: number;
  };
  first_response: {
    conversations: number;
    avg_seconds: number | null;
    median_seconds: number | null;
  };
  satisfaction: { sent: number; answered: number; avg_score: number | null };
  daily: Array<{ day: string; inbound: number; outbound: number }>;
  per_clinic: Array<{
    id: string;
    name: string;
    created_at: string | null;
    people: number;
    active_people: number;
    channels: number;
    contacts: number;
    conversations: number;
    period_conversations: number;
    messages: number;
    period_messages: number;
    last_message_at: string | null;
  }>;
};

type OnlineUsers = {
  generated_at: string;
  total: number;
  admins: number;
  agents: number;
  clinics: number;
  per_clinic: Array<{ id: string; name: string; online: number }>;
  users: Array<{
    user_id: string;
    name: string;
    role: string;
    clinic_id: string;
    clinic_name: string;
    last_seen_at: string;
  }>;
};

// Quem deu sinal de vida nos últimos 2 min (o app avisa a cada minuto)
const ONLINE_WINDOW_SECONDS = 120;
const ONLINE_REFRESH_MS = 30 * 1000;

const PERIODS = [7, 30, 90];

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

const numberFormat = new Intl.NumberFormat("pt-BR");
const fmt = (value: number | null | undefined) =>
  numberFormat.format(Number(value ?? 0));

// "1 ativa", "2 ativas"
const plural = (value: number, one: string, many: string) =>
  `${fmt(value)} ${Number(value) === 1 ? one : many}`;

const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";

const formatDuration = (seconds: number | null) => {
  if (seconds === null || seconds === undefined) return "–";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes} min` : `${hours}h`;
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("pt-BR") : "–";

const formatDay = (yyyyMmDd: string) => {
  const [, m, d] = yyyyMmDd.split("-");
  return `${d}/${m}`;
};

const fetchMetrics = async (days: number) => {
  const { data, error } = await adminSupabase.rpc("platform_metrics", {
    p_days: days,
    p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  if (error) throw error;
  return data as PlatformMetrics;
};

const fetchOnlineUsers = async () => {
  const { data, error } = await adminSupabase.rpc("platform_online_users", {
    p_window_seconds: ONLINE_WINDOW_SECONDS,
  });
  if (error) throw error;
  return data as OnlineUsers;
};

const Section = ({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <section>
    <div className="mb-3">
      <h2 className="text-lg font-semibold text-slate-700">{title}</h2>
      {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
    </div>
    {children}
  </section>
);

const Panel = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>
    {children}
  </div>
);

const StatCard = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) => (
  <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
    <p className="text-xs text-slate-500 sm:text-sm">{label}</p>
    <p className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">
      {value}
    </p>
    {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
  </article>
);

const BarList = ({
  rows,
}: {
  rows: Array<{ label: string; value: number; hint?: string }>;
}) => {
  const max = Math.max(1, ...rows.map((row) => row.value));

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">Sem dados no período.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-xs text-slate-600">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0">
              <span className="font-medium text-slate-800">
                {fmt(row.value)}
              </span>
              {row.hint ? (
                <span className="ml-2 text-slate-500">{row.hint}</span>
              ) : null}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-[#003366] transition-all duration-500"
              style={{
                width: `${row.value > 0 ? Math.max(2, (row.value / max) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const DailyMessagesChart = ({ rows }: { rows: PlatformMetrics["daily"] }) => {
  const totals = rows.map((row) => row.inbound + row.outbound);
  const max = Math.max(1, ...totals);
  const labelEvery = Math.ceil(rows.length / 8);

  if (totals.every((total) => total === 0)) {
    return <p className="text-sm text-slate-500">Sem mensagens no período.</p>;
  }

  return (
    <div>
      <div className="flex h-40 items-end gap-px sm:gap-0.5">
        {rows.map((row, index) => (
          <div
            key={row.day}
            className="group flex h-full flex-1 flex-col justify-end"
            title={`${formatDay(row.day)}: ${fmt(totals[index])} mensagens (${fmt(row.inbound)} recebidas, ${fmt(row.outbound)} enviadas)`}
          >
            <div
              className="w-full rounded-t bg-[#003366] transition-all duration-500 group-hover:bg-[#0A84FF]"
              style={{
                height: `${totals[index] > 0 ? Math.max(3, (totals[index] / max) * 100) : 0}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-px border-t border-slate-200 pt-1 sm:gap-0.5">
        {rows.map((row, index) => (
          <span
            key={row.day}
            className="flex-1 overflow-visible whitespace-nowrap text-center text-[10px] text-slate-500"
          >
            {index % labelEvery === 0 ? formatDay(row.day) : ""}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Maior dia: {fmt(max)} mensagens. Passe o mouse sobre uma barra para ver
        o detalhe.
      </p>
    </div>
  );
};

const OnlineNow = () => {
  const { data, error, isLoading } = useQuery({
    queryKey: ["platform-online-users"],
    queryFn: fetchOnlineUsers,
    refetchInterval: ONLINE_REFRESH_MS,
  });

  return (
    <Section
      title="Online agora"
      subtitle="Pessoas com o app aberto nos últimos 2 minutos. Atualiza sozinho a cada 30 segundos."
    >
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Não foi possível saber quem está online.
        </div>
      ) : isLoading || !data ? (
        <div className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label="Usuários online"
            value={
              <span className="inline-flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${data.total > 0 ? "bg-emerald-500" : "bg-slate-300"}`}
                />
                {fmt(data.total)}
              </span>
            }
            hint={`${plural(data.agents, "atendente", "atendentes")}, ${plural(data.admins, "admin", "admins")} · em ${plural(data.clinics, "empresa", "empresas")}`}
          />
          <div className="md:col-span-2">
            <Panel title="Quem está online">
              {data.users.length === 0 ? (
                <p className="text-sm text-slate-500">Ninguém online agora.</p>
              ) : (
                <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto text-sm">
                  {data.users.map((user) => (
                    <li
                      key={`${user.user_id}-${user.clinic_id}`}
                      className="flex items-center justify-between gap-3 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                        <span className="truncate font-medium text-slate-800">
                          {user.name || "Sem nome"}
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">
                          {user.role === "admin" ? "admin" : "atendente"}
                        </span>
                      </span>
                      <span className="truncate text-xs text-slate-500">
                        {user.clinic_name}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </Section>
  );
};

export const MetricsPage: React.FC = () => {
  const [days, setDays] = useState(30);
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["platform-metrics", days],
    queryFn: () => fetchMetrics(days),
    placeholderData: (previous) => previous,
  });

  const periodLabel = `últimos ${days} dias`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Visão geral</h1>
          <p className="mt-1 text-sm text-gray-500">
            Números de todas as empresas da plataforma.
            {data
              ? ` Atualizado às ${new Date(data.generated_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {PERIODS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                option === days
                  ? "bg-[#003366] text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              {option} dias
            </button>
          ))}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Atualizar"
            className="rounded-full p-1.5 text-slate-600 hover:bg-slate-200 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Não foi possível carregar os números. Tente atualizar.
        </div>
      ) : null}

      <OnlineNow />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100"
            />
          ))}
        </div>
      ) : null}

      {data ? (
        <>
          <Section title="Plataforma" subtitle="Acumulado desde o início.">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <StatCard
                label="Empresas"
                value={fmt(data.clinics.total)}
                hint={`${plural(data.clinics.active, "ativa", "ativas")} e ${plural(data.clinics.new, "nova", "novas")} nos ${periodLabel}`}
              />
              <StatCard
                label="Atendentes e admins"
                value={fmt(data.people.total)}
                hint={`${plural(data.people.agents, "atendente", "atendentes")}, ${plural(data.people.admins, "admin", "admins")} · ${plural(data.people.active, "entrou", "entraram")} nos ${periodLabel}`}
              />
              <StatCard
                label="Canais conectados"
                value={fmt(data.channels.connected)}
                hint={`${fmt(data.channels.connected_qr)} por QR Code, ${fmt(data.channels.connected_official)} pela API oficial`}
              />
              <StatCard
                label="Contatos"
                value={fmt(data.contacts.total)}
                hint={`${plural(data.contacts.new, "novo", "novos")} nos ${periodLabel}`}
              />
              <StatCard
                label="Conversas"
                value={fmt(data.conversations.total)}
                hint={`${plural(data.conversations.period, "iniciada", "iniciadas")} nos ${periodLabel}`}
              />
              <StatCard
                label="Mensagens"
                value={fmt(data.messages.total)}
                hint={`${fmt(data.messages.period)} nos ${periodLabel}`}
              />
            </div>
          </Section>

          <Section
            title="Atendimento"
            subtitle={`Conversas iniciadas nos ${periodLabel}.`}
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                label="Tempo até a 1ª resposta"
                value={formatDuration(data.first_response.median_seconds)}
                hint={`Mediana de ${plural(data.first_response.conversations, "conversa", "conversas")} · média ${formatDuration(data.first_response.avg_seconds)}`}
              />
              <StatCard
                label="Satisfação"
                value={
                  data.satisfaction.avg_score !== null
                    ? `${Number(data.satisfaction.avg_score).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} / 5`
                    : "–"
                }
                hint={`${plural(data.satisfaction.answered, "resposta", "respostas")} em ${plural(data.satisfaction.sent, "pesquisa enviada", "pesquisas enviadas")}`}
              />
              <StatCard
                label="Atendimentos do bot"
                value={fmt(data.bots.sessions)}
                hint={`${percent(data.bots.resolved, data.bots.sessions)} concluídos sem atendente · ${plural(data.bots.active, "bot ativo", "bots ativos")}`}
              />
              <StatCard
                label="Mensagens automáticas"
                value={percent(
                  data.messages.period_automated,
                  data.messages.period_outbound,
                )}
                hint={`${fmt(data.messages.period_automated)} de ${fmt(data.messages.period_outbound)} mensagens enviadas`}
              />
            </div>
          </Section>

          <Section
            title="Mensagens por dia"
            subtitle={`${fmt(data.messages.period_inbound)} recebidas e ${fmt(data.messages.period_outbound)} enviadas nos ${periodLabel}.`}
          >
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <DailyMessagesChart rows={data.daily} />
            </div>
          </Section>

          <Section title="Uso em detalhe">
            <div className="grid gap-3 md:grid-cols-3">
              <Panel title="Mídias trocadas (acumulado)">
                <BarList
                  rows={[
                    { label: "Imagens", counter: data.media.images },
                    { label: "Áudios", counter: data.media.audios },
                    { label: "Documentos", counter: data.media.documents },
                    { label: "Vídeos", counter: data.media.videos },
                    { label: "Figurinhas", counter: data.media.stickers },
                    {
                      label: "Áudios transcritos",
                      counter: data.media.transcribed,
                    },
                  ].map(({ label, counter }) => ({
                    label,
                    value: counter.total,
                    hint: `${fmt(counter.period)} em ${days} dias`,
                  }))}
                />
              </Panel>
              <Panel title={`Conversas por canal (${days} dias)`}>
                <BarList
                  rows={data.conversations_by_channel.map((row) => ({
                    label: CHANNEL_LABELS[row.channel] ?? row.channel,
                    value: row.conversations,
                  }))}
                />
              </Panel>
              <Panel title="Situação das conversas (agora)">
                <BarList
                  rows={[
                    {
                      label: "Na fila de espera",
                      value: data.conversations.pending,
                    },
                    {
                      label: "Em atendimento",
                      value: data.conversations.open,
                    },
                    { label: "Encerradas", value: data.conversations.closed },
                  ]}
                />
              </Panel>
            </div>
          </Section>

          <Section
            title="Empresas"
            subtitle={`Ordenadas pelo volume de mensagens nos ${periodLabel}. Empresa sem mensagens no período pode precisar de atenção.`}
          >
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Empresa</th>
                    <th className="px-4 py-3 font-medium">Cliente desde</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Pessoas
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Canais
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Conversas ({days}d)
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Mensagens ({days}d)
                    </th>
                    <th className="px-4 py-3 font-medium">Última mensagem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.per_clinic.map((clinic) => (
                    <tr key={clinic.id}>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {clinic.name}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(clinic.created_at)}
                      </td>
                      <td
                        className="px-4 py-3 text-right tabular-nums text-slate-600"
                        title={`${fmt(clinic.active_people)} entraram nos ${periodLabel}`}
                      >
                        {fmt(clinic.people)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {fmt(clinic.channels)}
                      </td>
                      <td
                        className="px-4 py-3 text-right tabular-nums text-slate-600"
                        title={`${fmt(clinic.conversations)} no total`}
                      >
                        {fmt(clinic.period_conversations)}
                      </td>
                      <td
                        className="px-4 py-3 text-right tabular-nums text-slate-600"
                        title={`${fmt(clinic.messages)} no total`}
                      >
                        {fmt(clinic.period_messages)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(clinic.last_message_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
};
