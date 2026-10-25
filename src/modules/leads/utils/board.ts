import type { Deal, DealFilters, DealTaskSummary } from "../types/leads";

// Negociação aberta há mais que isso na mesma etapa aparece como "parada"
export const STALLED_DAYS = 7;
// Ganhos e perdidos ficam no quadro por este tempo depois de fechados
export const CLOSED_VISIBLE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const sortByPosition = <T extends { position: number; createdAt?: string }>(
  items: T[],
) =>
  [...items].sort(
    (a, b) =>
      a.position - b.position ||
      String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
  );

/**
 * Posição para um cartão que vai ficar entre `before` e `after` (menor em
 * cima). Sem vizinhos, 0; só com um, um passo para fora dele.
 */
export const positionBetween = (before?: number, after?: number) => {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
};

/**
 * Posição de um cartão solto no índice `index` de uma etapa (cartões já na
 * ordem da tela). O próprio cartão é ignorado na conta, para mover dentro da
 * mesma etapa funcionar.
 */
export const dropPosition = (
  stageDeals: { id: string; position: number }[],
  index: number,
  movingId: string,
) => {
  const others = stageDeals.filter((d) => d.id !== movingId);
  const at = Math.max(0, Math.min(index, others.length));
  return positionBetween(others[at - 1]?.position, others[at]?.position);
};

/** Posição para entrar no topo de uma etapa. */
export const topPosition = (stageDeals: { position: number }[]) =>
  stageDeals.length === 0
    ? 0
    : Math.min(...stageDeals.map((d) => d.position)) - 1;

export const daysSince = (iso: string, now = Date.now()) =>
  Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY_MS));

export const isStalled = (
  deal: Pick<Deal, "status" | "stageEnteredAt">,
  now = Date.now(),
) => deal.status === "open" && daysSince(deal.stageEnteredAt, now) >= STALLED_DAYS;

export const nextOpenTask = (tasks: DealTaskSummary[]) =>
  tasks
    .filter((t) => !t.doneAt)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] ?? null;

export const isOverdue = (iso: string, now = Date.now()) =>
  new Date(iso).getTime() < now;

const normalize = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export const filterDeals = (
  deals: Deal[],
  filters: DealFilters,
  currentUserId: string | null,
  now = Date.now(),
) => {
  const term = normalize(filters.search.trim());
  const digits = filters.search.replace(/\D/g, "");

  return deals.filter((deal) => {
    if (term) {
      const matches =
        normalize(deal.title).includes(term) ||
        normalize(deal.contact.name).includes(term) ||
        (digits.length >= 3 && String(deal.contact.phone ?? "").includes(digits));
      if (!matches) return false;
    }
    if (filters.owner === "mine" && deal.ownerUserId !== currentUserId) return false;
    if (filters.owner === "none" && deal.ownerUserId !== null) return false;
    if (
      filters.owner !== "all" &&
      filters.owner !== "mine" &&
      filters.owner !== "none" &&
      deal.ownerUserId !== filters.owner
    ) {
      return false;
    }
    if (filters.tagId && !deal.tagIds.includes(filters.tagId)) return false;
    if (filters.stalledOnly && !isStalled(deal, now)) return false;
    return true;
  });
};

export const stageTotals = (deals: Pick<Deal, "value">[]) => ({
  count: deals.length,
  value: deals.reduce((sum, d) => sum + (d.value ?? 0), 0),
});

/** "R$ 1,5 mil" para caber no topo da coluna; valores pequenos completos. */
export const formatCompactCurrency = (value: number) => {
  if (value >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  }
  if (value >= 10_000) {
    return `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  }
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export const initials = (name: string | null | undefined) => {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter((p) => /\p{L}/u.test(p));
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
};

/** Data em ISO a partir dos campos de data e hora da tela (fuso do navegador). */
export const localDateTimeToIso = (date: string, time: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const result = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (result.getMonth() !== m - 1 || result.getDate() !== d) return null;
  return result.toISOString();
};

/** "hoje 14:30", "amanhã 09:00", "ontem 18:00" ou "12/11 10:00" */
export const formatDue = (iso: string, now = new Date()) => {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(date) - startOf(now)) / DAY_MS);
  if (diff === 0) return `hoje ${time}`;
  if (diff === 1) return `amanhã ${time}`;
  if (diff === -1) return `ontem ${time}`;
  return `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`;
};
