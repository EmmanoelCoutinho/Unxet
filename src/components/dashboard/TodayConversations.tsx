import React, { useEffect, useMemo, useState } from "react";
import { Building2Icon, UserIcon } from "lucide-react";
import type { TodayConversation, TodayConversationsResult } from "../../services/inboxAnalytics";

/**
 * Painel: conversas com movimento hoje. Cada card mostra departamento,
 * situação e responsável; clicar abre a conversa.
 */

type StatusKey = "open" | "pending" | "bot" | "closed";

const STATUS: Record<StatusKey, { label: string; className: string }> = {
  open: { label: "Em atendimento", className: "bg-green-50 text-green-700" },
  pending: { label: "Na fila", className: "bg-amber-50 text-amber-700" },
  bot: { label: "No bot", className: "bg-violet-50 text-violet-700" },
  closed: { label: "Finalizada", className: "bg-slate-100 text-slate-600" },
};

const STATUS_ORDER: StatusKey[] = ["open", "pending", "bot", "closed"];
const PAGE = 12;

const statusOf = (item: TodayConversation): StatusKey =>
  item.status === "pending" && item.inBotFlow ? "bot" : item.status;

const formatHour = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export const TodayConversations: React.FC<{
  data: TodayConversationsResult | undefined;
  loading: boolean;
  error: boolean;
  channelLabel: (channel: string) => string;
  onOpen: (item: TodayConversation) => void;
}> = ({ data, loading, error, channelLabel, onOpen }) => {
  const [filter, setFilter] = useState<StatusKey | "all">("all");
  const [visibleCount, setVisibleCount] = useState(PAGE);

  const items = useMemo(() => data?.items ?? [], [data]);

  const counts = useMemo(() => {
    const result: Record<StatusKey, number> = { open: 0, pending: 0, bot: 0, closed: 0 };
    items.forEach((item) => {
      result[statusOf(item)] += 1;
    });
    return result;
  }, [items]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((item) => statusOf(item) === filter)),
    [items, filter],
  );

  useEffect(() => setVisibleCount(PAGE), [filter]);

  const visible = filtered.slice(0, visibleCount);
  const total = data?.total ?? 0;

  const chip = (key: StatusKey | "all", label: string, count: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      aria-pressed={filter === key}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        filter === key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label} ({count})
    </button>
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Atendimentos de hoje</h3>
          <p className="text-xs text-slate-500">
            Conversas com movimento desde a meia-noite, da mais recente para a mais antiga. Clique para
            abrir a conversa.
          </p>
        </div>
        <div className="text-sm text-slate-600">
          Total: <span className="font-semibold text-slate-900">{error ? "-" : total}</span>
        </div>
      </div>

      {items.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {chip("all", "Todos", items.length)}
          {STATUS_ORDER.map((key) => chip(key, STATUS[key].label, counts[key]))}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          {error
            ? "Não foi possível carregar os atendimentos de hoje."
            : items.length === 0
              ? "Nenhum atendimento hoje ainda."
              : "Nenhum atendimento nesta situação."}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => {
            const status = STATUS[statusOf(item)];
            return (
              <li key={item.conversationId}>
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className="flex h-full w-full flex-col gap-2 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-blue-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate font-medium text-slate-800">{item.contact}</p>
                    <span
                      className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <p className="flex min-w-0 items-center gap-1 text-xs text-slate-600">
                    <Building2Icon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                    <span className="truncate">{item.department}</span>
                  </p>
                  <p className="flex min-w-0 items-center gap-1 text-xs text-slate-600">
                    <UserIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                    <span className="truncate">{item.assignedTo}</span>
                  </p>
                  <p className="mt-auto text-xs text-slate-400">
                    {channelLabel(item.channel)} · última atividade às {formatHour(item.lastActivityAt)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {filtered.length > visibleCount && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((current) => current + PAGE)}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            Mostrar mais ({filtered.length - visibleCount} restantes)
          </button>
        </div>
      )}

      {total > items.length && (
        <p className="mt-3 text-center text-xs text-slate-400">
          Mostrando os {items.length} mais recentes de {total}.
        </p>
      )}
    </section>
  );
};
