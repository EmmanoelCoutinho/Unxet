import type {
  ScheduledMessageStatus,
  ScheduledRecipient,
  ScheduledRecipientStatus,
} from "../types/scheduledMessages";

export const MAX_RECIPIENTS = 100;
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
  sent: "Enviada",
  partial: "Enviada com falhas",
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

export const isCancellable = (status: ScheduledMessageStatus) =>
  status === "scheduled" || status === "processing";

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
