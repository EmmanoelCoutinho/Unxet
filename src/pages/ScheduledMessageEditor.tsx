import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useOpenConversation } from "../modules/floatingChats/useOpenConversation";
import {
  ArrowLeftIcon,
  BanIcon,
  CalendarClockIcon,
  CheckIcon,
  MessageSquareTextIcon,
  PlusIcon,
  SearchIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../contexts/ClinicContext";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useConfirm } from "../components/ui/ConfirmDialog";
import {
  MessageStatusBadge,
  RecipientStatusBadge,
} from "../modules/scheduledMessages/components/StatusBadge";
import {
  useQrWhatsappNumbers,
  useScheduledMessage,
  useScheduledMessageActions,
  useWalletContactSearch,
} from "../modules/scheduledMessages/hooks/useScheduledMessages";
import type {
  RecipientDraft,
  ScheduledMessage,
  WalletContact,
} from "../modules/scheduledMessages/types/scheduledMessages";
import {
  MAX_MESSAGE_LENGTH,
  MAX_RECIPIENTS,
  MIN_LEAD_MS,
  combineDateAndTime,
  defaultScheduleDate,
  formatPhone,
  formatScheduleDateTime,
  isCancellable,
  isEditable,
  normalizeTypedPhone,
  onlyDigits,
  recipientLabel,
  summarizeRecipients,
  toDateInputValue,
  toTimeInputValue,
} from "../modules/scheduledMessages/utils/schedule";

const LIST_PATH = "/inbox/scheduled-messages";

// Campos que a função de envio troca pela informação de cada destinatário.
// Um campo novo aqui precisa ser tratado também em renderScheduledText
// (supabase/functions/_shared/scheduledMessages.ts).
const MESSAGE_FIELDS: {
  token: string;
  label: string;
  description: string;
  icon: React.ElementType<{ className?: string }>;
}[] = [
  {
    token: "{nome}",
    label: "Nome do cliente",
    description:
      "vira o nome de quem recebe, como está na carteira ou como você digitou ao adicionar o número. Sem nome cadastrado, o campo é retirado do texto.",
    icon: UserPlusIcon,
  },
];

const FIELD_CLASS =
  "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

type RecipientSource = "wallet" | "manual";

const SectionTitle: React.FC<{
  icon: React.ElementType<{ className?: string }>;
  children: React.ReactNode;
}> = ({ icon: Icon, children }) => (
  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
    <Icon className="h-4 w-4 text-blue-500" />
    {children}
  </h2>
);

export const ScheduledMessageEditorPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const scheduledMessageId = id ?? null;

  const { scheduledMessage, loading, error } =
    useScheduledMessage(scheduledMessageId);

  if (scheduledMessageId && loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (scheduledMessageId && !scheduledMessage) {
    return (
      <div className="h-full bg-slate-50 px-4 py-6 sm:px-8">
        <Card className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Programação não encontrada
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {error ?? "Ela pode ter sido excluída ou pertencer a outra pessoa."}
          </p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate(LIST_PATH)}
            className="mt-4"
          >
            Voltar para a lista
          </Button>
        </Card>
      </div>
    );
  }

  if (scheduledMessage && !isEditable(scheduledMessage.status)) {
    return <ScheduledMessageDetails scheduledMessage={scheduledMessage} />;
  }

  // key: o formulário é montado uma vez por programação (as atualizações
  // periódicas da consulta não apagam o que a pessoa está digitando)
  return (
    <ScheduledMessageForm
      key={scheduledMessage?.id ?? "new"}
      existing={scheduledMessage}
    />
  );
};

const PageShell: React.FC<{
  title: string;
  subtitle: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, badge, children }) => {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b bg-white px-4 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(LIST_PATH)}
            className="rounded-full border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
            aria-label="Voltar para a lista"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
              {badge}
            </div>
            <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {children}
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Criar / editar                                                             */
/* -------------------------------------------------------------------------- */

const ScheduledMessageForm: React.FC<{ existing: ScheduledMessage | null }> = ({
  existing,
}) => {
  const navigate = useNavigate();
  const { clinicId } = useClinic();
  const { save, saving } = useScheduledMessageActions();

  const initialDate = useRef(
    existing ? new Date(existing.scheduledAt) : defaultScheduleDate(),
  ).current;

  const [recipients, setRecipients] = useState<RecipientDraft[]>(() =>
    (existing?.recipients ?? []).map((r) => ({
      contactId: r.contactId,
      name: r.name,
      phone: r.phone,
    })),
  );
  const [date, setDate] = useState(toDateInputValue(initialDate));
  const [time, setTime] = useState(toTimeInputValue(initialDate));
  const [message, setMessage] = useState(existing?.message ?? "");
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Número de saída: a escolha só aparece quando a empresa tem mais de um
  const { numbers } = useQrWhatsappNumbers(clinicId);
  const [connectionId, setConnectionId] = useState<string | null>(
    existing?.channelConnectionId ?? null,
  );

  useEffect(() => {
    if (numbers.length === 0) return;
    if (connectionId && numbers.some((n) => n.id === connectionId)) return;
    setConnectionId((numbers.find((n) => n.connected) ?? numbers[0]).id);
  }, [numbers, connectionId]);

  const [source, setSource] = useState<RecipientSource>("wallet");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const {
    contacts,
    loading: loadingContacts,
    error: contactsError,
  } = useWalletContactSearch(clinicId, debouncedSearch, source === "wallet");

  const selectedPhones = useMemo(
    () => new Set(recipients.map((r) => r.phone)),
    [recipients],
  );
  const isFull = recipients.length >= MAX_RECIPIENTS;

  const addRecipient = (recipient: RecipientDraft) => {
    if (selectedPhones.has(recipient.phone)) {
      toast.info("Este número já está na lista.");
      return false;
    }
    if (isFull) {
      toast.error(`Cada programação aceita no máximo ${MAX_RECIPIENTS} destinatários.`);
      return false;
    }
    setRecipients((prev) => [...prev, recipient]);
    return true;
  };

  const removeRecipient = (phone: string) =>
    setRecipients((prev) => prev.filter((r) => r.phone !== phone));

  const toggleContact = (contact: WalletContact) => {
    const phone = onlyDigits(contact.phone);
    if (!phone) return;
    if (selectedPhones.has(phone)) {
      removeRecipient(phone);
      return;
    }
    addRecipient({ contactId: contact.id, name: contact.name, phone });
  };

  const addManualNumber = () => {
    const phone = normalizeTypedPhone(manualPhone);
    if (!phone) {
      toast.error("Informe o número com DDD. Ex.: (11) 99999-8888");
      return;
    }
    const added = addRecipient({
      contactId: null,
      name: manualName.trim() || null,
      phone,
    });
    if (added) {
      setManualName("");
      setManualPhone("");
    }
  };

  // Coloca o campo onde o cursor está (ou no lugar do trecho selecionado)
  const insertField = (token: string) => {
    const textarea = messageRef.current;
    const start = textarea?.selectionStart ?? message.length;
    const end = textarea?.selectionEnd ?? message.length;
    const next = message.slice(0, start) + token + message.slice(end);
    if (next.length > MAX_MESSAGE_LENGTH) {
      toast.error("A mensagem já está no tamanho máximo.");
      return;
    }
    setMessage(next);
    const cursor = start + token.length;
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });
  };

  const handleSave = async () => {
    if (recipients.length === 0) {
      toast.error("Adicione pelo menos um destinatário.");
      return;
    }
    const scheduledAt = combineDateAndTime(date, time);
    if (!scheduledAt) {
      toast.error("Informe a data e a hora do envio.");
      return;
    }
    if (scheduledAt.getTime() < Date.now() + MIN_LEAD_MS) {
      toast.error("Escolha uma data e hora no futuro.");
      return;
    }
    if (!message.trim()) {
      toast.error("Escreva a mensagem.");
      return;
    }

    try {
      await save({
        id: existing?.id ?? null,
        message,
        scheduledAt,
        recipients,
        channelConnectionId: numbers.length > 0 ? connectionId : null,
      });
      toast.success(
        existing ? "Programação atualizada." : "Mensagem programada.",
      );
      navigate(LIST_PATH);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar a programação.");
    }
  };

  const today = toDateInputValue(new Date());

  return (
    <PageShell
      title={existing ? "Editar programação" : "Nova programação"}
      subtitle="A mensagem sai pelo WhatsApp conectado por QR Code, no dia e horário escolhidos."
      badge={existing ? <MessageStatusBadge status={existing.status} /> : null}
    >
      <Card className="rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle icon={UsersIcon}>1. Para quem</SectionTitle>
          <span className="text-xs text-slate-500">
            {recipients.length} de {MAX_RECIPIENTS}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
          {(
            [
              ["wallet", "Carteira de clientes"],
              ["manual", "Outro número"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSource(key)}
              className={`rounded-lg px-3 py-1.5 transition ${
                source === key
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {source === "wallet" ? (
          <div className="mt-4">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome ou telefone"
                className={`${FIELD_CLASS} pl-9`}
              />
            </div>

            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
              {contactsError ? (
                <p className="py-6 text-center text-sm text-red-600">
                  Não foi possível carregar a carteira.
                </p>
              ) : loadingContacts ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  Carregando clientes...
                </p>
              ) : contacts.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  {debouncedSearch
                    ? "Nenhum cliente encontrado. Use a aba “Outro número”."
                    : "A carteira ainda não tem clientes."}
                </p>
              ) : (
                contacts.map((contact) => {
                  const selected = selectedPhones.has(onlyDigits(contact.phone));
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => toggleContact(contact)}
                      aria-pressed={selected}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                        selected
                          ? "border-blue-200 bg-blue-50/60"
                          : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-800">
                          {recipientLabel(contact)}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {formatPhone(contact.phone)}
                        </span>
                      </span>
                      <span
                        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border ${
                          selected
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-300 text-slate-400"
                        }`}
                      >
                        {selected ? (
                          <CheckIcon className="h-3.5 w-3.5" />
                        ) : (
                          <PlusIcon className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              addManualNumber();
            }}
          >
            <div>
              <label
                htmlFor="scheduled-manual-phone"
                className="block text-sm font-medium text-slate-800"
              >
                WhatsApp com DDD
              </label>
              <input
                id="scheduled-manual-phone"
                type="tel"
                inputMode="tel"
                value={manualPhone}
                onChange={(event) => setManualPhone(event.target.value)}
                placeholder="(11) 99999-8888"
                className={`${FIELD_CLASS} mt-1`}
              />
            </div>
            <div>
              <label
                htmlFor="scheduled-manual-name"
                className="block text-sm font-medium text-slate-800"
              >
                Nome <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                id="scheduled-manual-name"
                type="text"
                value={manualName}
                onChange={(event) => setManualName(event.target.value)}
                maxLength={80}
                placeholder="Como chamar a pessoa"
                className={`${FIELD_CLASS} mt-1`}
              />
            </div>
            <Button type="submit" variant="ghost" size="sm" className="border border-slate-200">
              <span className="flex items-center gap-2">
                <PlusIcon className="h-4 w-4" />
                Adicionar número
              </span>
            </Button>
          </form>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Selecionados
          </p>
          {recipients.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              Ninguém selecionado ainda.
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {recipients.map((recipient) => (
                <li
                  key={recipient.phone}
                  className="flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm text-slate-700"
                  title={formatPhone(recipient.phone)}
                >
                  <span className="truncate">{recipientLabel(recipient)}</span>
                  <button
                    type="button"
                    onClick={() => removeRecipient(recipient.phone)}
                    className="rounded-full p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                    aria-label={`Remover ${recipientLabel(recipient)}`}
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <div className="space-y-6">
        <Card className="rounded-2xl border border-slate-200 p-5">
          <SectionTitle icon={CalendarClockIcon}>2. Quando</SectionTitle>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="scheduled-date"
                className="block text-sm font-medium text-slate-800"
              >
                Data
              </label>
              <input
                id="scheduled-date"
                type="date"
                value={date}
                min={today}
                onChange={(event) => setDate(event.target.value)}
                className={`${FIELD_CLASS} mt-1`}
              />
            </div>
            <div>
              <label
                htmlFor="scheduled-time"
                className="block text-sm font-medium text-slate-800"
              >
                Hora
              </label>
              <input
                id="scheduled-time"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className={`${FIELD_CLASS} mt-1`}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Horário do seu computador. Com vários destinatários, os envios saem
            aos poucos (cerca de 6 por minuto) a partir desse horário.
          </p>
          {numbers.length > 1 && (
            <div className="mt-4">
              <label
                htmlFor="scheduled-connection"
                className="block text-sm font-medium text-slate-800"
              >
                Enviar pelo número
              </label>
              <select
                id="scheduled-connection"
                value={connectionId ?? ""}
                onChange={(event) => setConnectionId(event.target.value || null)}
                className={`${FIELD_CLASS} mt-1 bg-white`}
              >
                {numbers.map((number) => (
                  <option key={number.id} value={number.id}>
                    {number.connected
                      ? number.label
                      : `${number.label} (desconectado)`}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                As respostas dos clientes chegam por esse mesmo número.
              </p>
            </div>
          )}
        </Card>

        <Card className="rounded-2xl border border-slate-200 p-5">
          <SectionTitle icon={MessageSquareTextIcon}>3. Mensagem</SectionTitle>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Escreva o texto uma vez só. Cada destinatário recebe a mensagem em
            uma conversa individual, como se tivesse sido enviada só para ele.
          </p>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={7}
            ref={messageRef}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Ex.: Olá, passando para lembrar da sua consulta amanhã às 14h."
            aria-label="Mensagem"
            className={`${FIELD_CLASS} mt-3 resize-none leading-6`}
          />
          <p className="mt-1 text-right text-xs text-slate-500">
            {message.length}/{MAX_MESSAGE_LENGTH}
          </p>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-800">
              Campos automáticos
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Clique em um campo para colocá-lo onde o cursor está no texto. No
              envio, ele é trocado pela informação de cada destinatário.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {MESSAGE_FIELDS.map((field) => (
                <button
                  key={field.token}
                  type="button"
                  onClick={() => insertField(field.token)}
                  className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <field.icon className="h-3.5 w-3.5" />
                  {field.label}
                </button>
              ))}
            </div>

            <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-500">
              {MESSAGE_FIELDS.map((field) => (
                <li key={field.token}>
                  <code className="rounded bg-white px-1 py-0.5 font-semibold text-slate-700">
                    {field.token}
                  </code>{" "}
                  {field.description}
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => navigate(LIST_PATH)}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-full"
          >
            {saving
              ? "Salvando..."
              : existing
                ? "Salvar alterações"
                : "Programar mensagem"}
          </Button>
        </div>
      </div>
    </PageShell>
  );
};

/* -------------------------------------------------------------------------- */
/* Detalhes (já começou a ser enviada, foi finalizada ou cancelada)           */
/* -------------------------------------------------------------------------- */

const ScheduledMessageDetails: React.FC<{
  scheduledMessage: ScheduledMessage;
}> = ({ scheduledMessage }) => {
  const openConversation = useOpenConversation();
  const confirm = useConfirm();
  const { cancel, acting } = useScheduledMessageActions();
  const { total, sent, failed, waiting } = summarizeRecipients(
    scheduledMessage.recipients,
  );
  const { clinicId } = useClinic();
  const { numbers } = useQrWhatsappNumbers(clinicId);
  const numberLabel =
    numbers.length > 1
      ? numbers.find((n) => n.id === scheduledMessage.channelConnectionId)
          ?.label
      : undefined;

  const handleCancel = async () => {
    const ok = await confirm({
      title: "Cancelar programação?",
      description:
        "Os envios que ainda não saíram serão cancelados. Os que já foram enviados não são afetados.",
      confirmLabel: "Cancelar envios",
      cancelLabel: "Voltar",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await cancel(scheduledMessage.id);
      toast.success("Programação cancelada.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível cancelar.");
    }
  };

  return (
    <PageShell
      title="Detalhes da programação"
      subtitle={`Programada para ${formatScheduleDateTime(scheduledMessage.scheduledAt)}`}
      badge={<MessageStatusBadge status={scheduledMessage.status} />}
    >
      <Card className="rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle icon={UsersIcon}>Destinatários</SectionTitle>
          <span className="text-xs text-slate-500">
            {sent} de {total} enviada{total === 1 ? "" : "s"}
            {failed > 0 ? ` · ${failed} com falha` : ""}
            {waiting > 0 ? ` · ${waiting} aguardando` : ""}
          </span>
        </div>

        <ul className="mt-4 divide-y divide-slate-100">
          {scheduledMessage.recipients.map((recipient) => (
            <li key={recipient.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {recipientLabel(recipient)}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {formatPhone(recipient.phone)}
                    {recipient.sentAt
                      ? ` · ${new Date(recipient.sentAt).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}`
                      : ""}
                  </p>
                </div>
                <RecipientStatusBadge status={recipient.status} />
              </div>
              {recipient.error && (
                <p
                  className={`mt-1.5 text-xs ${
                    recipient.status === "failed"
                      ? "text-red-600"
                      : "text-amber-700"
                  }`}
                >
                  {recipient.error}
                </p>
              )}
              {recipient.conversationId && (
                <button
                  type="button"
                  onClick={() =>
                    openConversation(recipient.conversationId!)
                  }
                  className="mt-1.5 text-xs font-medium text-blue-600 hover:underline"
                >
                  Abrir conversa
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-6">
        <Card className="rounded-2xl border border-slate-200 p-5">
          <SectionTitle icon={MessageSquareTextIcon}>Mensagem</SectionTitle>
          <p className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-800">
            {scheduledMessage.message}
          </p>
          {numberLabel && (
            <p className="mt-3 text-xs text-slate-500">
              Enviada pelo número{" "}
              <span className="font-medium text-slate-700">{numberLabel}</span>
            </p>
          )}
        </Card>

        {isCancellable(scheduledMessage.status) && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancel}
              disabled={acting}
              className="border border-amber-200"
            >
              <span className="flex items-center gap-2 text-amber-700">
                <BanIcon className="h-4 w-4" />
                Cancelar envios restantes
              </span>
            </Button>
          </div>
        )}
      </div>
    </PageShell>
  );
};
