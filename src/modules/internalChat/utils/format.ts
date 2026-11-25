// Textos e datas do chat interno (página e janela flutuante)

export const GENERAL_NAME = "Geral";

export function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

// Na lista: hora para hoje, data para os outros dias
export const formatListTime = (iso: string) => {
  const date = new Date(iso);
  return isSameDay(date, new Date())
    ? formatTime(iso)
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

export const formatDayLabel = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, today)) return "Hoje";
  if (isSameDay(date, yesterday)) return "Ontem";
  return date.toLocaleDateString("pt-BR");
};

export const roleLabel = (role: string) =>
  role === "admin" ? "Administrador" : "Atendente";

export const formatUnread = (count: number) => (count > 99 ? "99+" : String(count));
