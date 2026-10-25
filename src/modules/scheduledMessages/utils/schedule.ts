import type {
  CampaignStats,
  ScheduledMessageStatus,
  ScheduledRecipient,
  ScheduledRecipientStatus,
} from "../types/scheduledMessages";

export const MAX_RECIPIENTS = 300;
// Ritmo do scheduled-messages-dispatch (2 por minuto por empresa). Mudou lá,
// muda aqui: é a base da previsão de término mostrada na tela.
export const CAMPAIGN_SENDS_PER_MINUTE = 2;
export const REPLY_WINDOW_OPTIONS = [3, 7, 15, 30] as const;
export const DEFAULT_REPLY_WINDOW_DAYS = 7;
export const MAX_MESSAGE_LENGTH = 4000;
// Folga para a pessoa terminar de preencher sem o horário "vencer" no caminho
export const MIN_LEAD_MS = 60 * 1000;

export const onlyDigits = (value: string | null | undefined) =>
  String(value ?? "").replace(/\D/g, "");

/**
 * Número digitado na tela -> dígitos com DDI, ou null se não for um telefone.
 * DDD + número (10 ou 11 dígitos) é tratado como Brasil e recebe o 55.
 */
export const normalizeTypedPhone = (input: string): string | null => {
  const digits = onlyDigits(input).replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length === 12 || digits.length === 13) return digits;
  return null;
};

export const formatPhone = (phone: string | null | undefined) => {
  const digits = onlyDigits(phone);
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const number = digits.slice(4);
    return `+55 (${ddd}) ${number.slice(0, number.length - 4)}-${number.slice(-4)}`;
  }
  return digits ? `+${digits}` : "";
};

// Contato criado pelo WhatsApp sem nome de perfil fica com o telefone no nome
export const recipientLabel = (recipient: {
  name: string | null;
  phone: string;
}) => {
  const name = recipient.name?.trim() ?? "";
  return /\p{L}/u.test(name) ? name : formatPhone(recipient.phone);
};

const pad = (value: number) => String(value).padStart(2, "0");

// Valores dos <input type="date"> e <input type="time">, no fuso do navegador
export const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const toTimeInputValue = (date: Date) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const combineDateAndTime = (date: string, time: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const result = new Date(year, month - 1, day, hours, minutes, 0, 0);
  // new Date aceita 31/02 e "rola" para março: isso não é o que a pessoa digitou
  if (result.getMonth() !== month - 1 || result.getDate() !== day) return null;
  return result;
};

/** Sugestão para uma programação nova: daqui a 1 hora, no próximo múltiplo de 5 min. */
export const defaultScheduleDate = (now = new Date()) => {
  const date = new Date(now.getTime() + 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
  return date;
};

export const formatScheduleDateTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const MESSAGE_STATUS_LABEL: Record<ScheduledMessageStatus, string> = {
  scheduled: "Agendada",
  processing: "Enviando",
  sent: "Concluída",
  partial: "Concluída com falhas",
  failed: "Falhou",
  cancelled: "Cancelada",
};

export const RECIPIENT_STATUS_LABEL: Record<ScheduledRecipientStatus, string> = {
  pending: "Aguardando",
  sending: "Enviando",
  sent: "Enviada",
  failed: "Falhou",
  cancelled: "Cancelada",
};

export const isEditable = (status: ScheduledMessageStatus) =>
  status === "scheduled";

/**
 * Situação para mostrar na tela. "Enviar agora" (ou um horário que já
 * chegou) fica como "scheduled" até o disparador pegar, em até 1 minuto:
 * para quem olha, já está enviando.
 */
export const effectiveStatus = (
  item: { status: ScheduledMessageStatus; scheduledAt: string },
  now = Date.now(),
): ScheduledMessageStatus =>
  item.status === "scheduled" && new Date(item.scheduledAt).getTime() <= now
    ? "processing"
    : item.status;

export const isCancellable = (status: ScheduledMessageStatus) =>
  status === "scheduled" || status === "processing";

/** Números do funil a partir dos destinatários (tela de detalhe). */
export const campaignStats = (
  recipients: Pick<
    ScheduledRecipient,
    | "status"
    | "deliveredAt"
    | "readAt"
    | "repliedAt"
    | "convertedAt"
    | "conversionValue"
  >[],
): CampaignStats => {
  const stats: CampaignStats = {
    total: recipients.length,
    sent: 0,
    failed: 0,
    waiting: 0,
    cancelled: 0,
    delivered: 0,
    read: 0,
    replied: 0,
    converted: 0,
    revenue: 0,
  };
  for (const r of recipients) {
    if (r.status === "sent") stats.sent++;
    else if (r.status === "failed") stats.failed++;
    else if (r.status === "cancelled") stats.cancelled++;
    else stats.waiting++;
    if (r.status === "sent" && (r.deliveredAt || r.readAt)) stats.delivered++;
    if (r.status === "sent" && r.readAt) stats.read++;
    if (r.repliedAt) stats.replied++;
    if (r.convertedAt) {
      stats.converted++;
      stats.revenue += r.conversionValue ?? 0;
    }
  }
  return stats;
};

/**
 * Quem não recebeu, separado pelo que dá para fazer. Mesma regra do
 * campaign_retry no banco: falha segura e cancelado voltam para a fila.
 */
export const retrySummary = (
  recipients: Pick<ScheduledRecipient, "status" | "failureKind">[],
) => {
  let retryable = 0;
  let cancelled = 0;
  let permanent = 0;
  let uncertain = 0;
  for (const r of recipients) {
    if (r.status === "cancelled") cancelled++;
    else if (r.status === "failed") {
      if (r.failureKind === "permanent") permanent++;
      else if (r.failureKind === "uncertain") uncertain++;
      else retryable++;
    }
  }
  return { retryable, cancelled, permanent, uncertain, toRetry: retryable + cancelled };
};

/** Quanto do envio já terminou (enviadas, falhas e canceladas), de 0 a 100. */
export const progressPercent = (stats: Pick<CampaignStats, "total" | "waiting">) => {
  if (stats.total <= 0) return 0;
  const done = stats.total - stats.waiting;
  return Math.min(100, Math.max(0, Math.floor((done / stats.total) * 100)));
};

/** Tempo aproximado para enviar `count` mensagens no ritmo seguro, em ms. */
export const estimateSendDurationMs = (count: number) =>
  Math.max(0, Math.ceil(count / CAMPAIGN_SENDS_PER_MINUTE)) * 60 * 1000;

/** "menos de 1 min", "25 min", "2h30" */
export const formatDuration = (ms: number) => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
};

/** Porcentagem inteira de `part` sobre `whole` (0 quando não há base). */
export const ratePercent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

/**
 * Texto como o cliente recebe, para a prévia na tela. Mesma regra do envio
 * (renderScheduledText em supabase/functions/_shared/scheduledMessages.ts):
 * {nome} vira o nome; sem nome, a marcação some e a pontuação é ajustada.
 */
export const previewMessageText = (template: string, name: string | null | undefined) => {
  const text = String(template ?? "");
  const value = typeof name === "string" ? name.trim() : "";
  if (/\p{L}/u.test(value)) return text.replace(/\{nome\}/gi, value);
  return text
    .replace(/[ \t]*\{nome\}/gi, "")
    .replace(/^[ \t]*[,;:][ \t]*/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

/** "1.500,50" / "1500.5" / "R$ 80" -> número; vazio -> null; inválido -> NaN */
export const parseMoneyInput = (input: string): number | null => {
  const raw = input.replace(/[R$\s]/g, "");
  if (!raw) return null;
  // Com vírgula, o padrão é o brasileiro (ponto separa milhar)
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
};

export const formatCurrency = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Título da campanha; programações antigas não têm nome e usam o começo do texto. */
export const campaignTitle = (item: { name: string | null; message: string }) => {
  const name = item.name?.trim();
  if (name) return name;
  const firstLine = item.message.trim().split(/\r?\n/)[0] ?? "";
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine || "Sem nome";
};

export const summarizeRecipients = (
  recipients: Pick<ScheduledRecipient, "status">[],
) => ({
  total: recipients.length,
  sent: recipients.filter((r) => r.status === "sent").length,
  failed: recipients.filter((r) => r.status === "failed").length,
  waiting: recipients.filter(
    (r) => r.status === "pending" || r.status === "sending",
  ).length,
});
