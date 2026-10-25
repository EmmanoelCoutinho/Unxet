import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useOpenConversation } from "../modules/floatingChats/useOpenConversation";
import {
  ArrowLeftIcon,
  BanIcon,
  CalendarClockIcon,
  CheckIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  TagIcon,
  TargetIcon,
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
  CampaignFunnel,
  CampaignProgress,
} from "../modules/scheduledMessages/components/CampaignInsights";
import {
  useCampaignAudience,
  useCampaignTags,
  useQrWhatsappNumbers,
  useScheduledMessage,
  useScheduledMessageActions,
  useWalletContactSearch,
} from "../modules/scheduledMessages/hooks/useScheduledMessages";
import type {
  CampaignTag,
  RecipientDraft,
  ScheduledMessage,
  ScheduledRecipient,
  WalletContact,
} from "../modules/scheduledMessages/types/scheduledMessages";
import {
  DEFAULT_REPLY_WINDOW_DAYS,
  MAX_MESSAGE_LENGTH,
  MAX_RECIPIENTS,
  MIN_LEAD_MS,
  REPLY_WINDOW_OPTIONS,
  campaignStats,
  campaignTitle,
  combineDateAndTime,
  defaultScheduleDate,
  effectiveStatus,
  estimateSendDurationMs,
  formatCurrency,
  formatDuration,
  formatPhone,
  formatScheduleDateTime,
  isCancellable,
  isEditable,
  normalizeTypedPhone,
  onlyDigits,
  recipientLabel,
  retrySummary,
  toDateInputValue,
  toTimeInputValue,
} from "../modules/scheduledMessages/utils/schedule";
import { CAMPAIGNS_PATH } from "../modules/scheduledMessages/paths";

const MAX_NAME_LENGTH = 120;

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

type RecipientSource = "wallet" | "tags" | "manual";

const SectionTitle: React.FC<{
  icon: React.ElementType<{ className?: string }>;
  children: React.ReactNode;
}> = ({ icon: Icon, children }) => (
  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
    <Icon className="h-4 w-4 text-blue-500" />
    {children}
  </h2>
);

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

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
            Campanha não encontrada
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {error ?? "Ela pode ter sido excluída ou pertencer a outra pessoa."}
          </p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate(CAMPAIGNS_PATH)}
            className="mt-4"
          >
            Voltar para a lista
          </Button>
        </Card>
      </div>
    );
  }

  if (scheduledMessage && !isEditable(effectiveStatus(scheduledMessage))) {
    return <CampaignResult scheduledMessage={scheduledMessage} />;
  }

  // key: o formulário é montado uma vez por campanha (as atualizações
  // periódicas da consulta não apagam o que a pessoa está digitando)
  return (
    <CampaignForm
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
            onClick={() => navigate(CAMPAIGNS_PATH)}
            className="rounded-full border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
            aria-label="Voltar para a lista"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-xl font-semibold text-gray-900">{title}</h1>
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

const CampaignForm: React.FC<{ existing: ScheduledMessage | null }> = ({
  existing,
}) => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { clinicId } = useClinic();
  const { save, saving } = useScheduledMessageActions();

  const initialDate = useRef(
    existing ? new Date(existing.scheduledAt) : defaultScheduleDate(),
  ).current;

  const [name, setName] = useState(existing?.name ?? "");
  const [recipients, setRecipients] = useState<RecipientDraft[]>(() =>
    (existing?.recipients ?? []).map((r) => ({
      contactId: r.contactId,
      name: r.name,
      phone: r.phone,
    })),
  );
  // Campanha nova sai na hora por padrão; uma já agendada continua agendada
  const [sendNow, setSendNow] = useState(!existing);
  const [date, setDate] = useState(toDateInputValue(initialDate));
  const [time, setTime] = useState(toTimeInputValue(initialDate));
  const [message, setMessage] = useState(existing?.message ?? "");
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [conversionTagId, setConversionTagId] = useState<string | null>(
    existing?.conversionTagId ?? null,
  );
  const [replyWindowDays, setReplyWindowDays] = useState(
    existing?.replyWindowDays ?? DEFAULT_REPLY_WINDOW_DAYS,
  );

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

  const { tags } = useCampaignTags(clinicId);

  const [source, setSource] = useState<RecipientSource>("wallet");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [audienceTagIds, setAudienceTagIds] = useState<string[]>([]);
  const audience = useCampaignAudience();

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
      toast.error(`Cada campanha aceita no máximo ${MAX_RECIPIENTS} destinatários.`);
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

  const toggleAudienceTag = (tagId: string) =>
    setAudienceTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );

  // Sem etiqueta marcada = todos os clientes da carteira
  const addAudience = async () => {
    try {
      const found = await audience.mutateAsync(audienceTagIds);
      const fresh: RecipientDraft[] = [];
      const seen = new Set(selectedPhones);
      for (const contact of found) {
        const phone = onlyDigits(contact.phone);
        if (!phone || seen.has(phone)) continue;
        seen.add(phone);
        fresh.push({ contactId: contact.id, name: contact.name, phone });
      }

      if (found.length === 0) {
        toast.info("Nenhum cliente com telefone encontrado.");
        return;
      }
      if (fresh.length === 0) {
        toast.info("Esses clientes já estão na lista.");
        return;
      }

      const room = Math.max(0, MAX_RECIPIENTS - recipients.length);
      const accepted = fresh.slice(0, room);
      setRecipients((prev) => [...prev, ...accepted]);

      if (accepted.length < fresh.length) {
        toast.warn(
          `${plural(accepted.length, "cliente adicionado", "clientes adicionados")}. ` +
            `O limite é ${MAX_RECIPIENTS} por campanha: ${fresh.length - accepted.length} ficaram de fora.`,
        );
      } else {
        toast.success(
          plural(accepted.length, "cliente adicionado", "clientes adicionados"),
        );
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível buscar os clientes.");
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

  const duration = formatDuration(estimateSendDurationMs(recipients.length));

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome para a campanha.");
      return;
    }
    if (!message.trim()) {
      toast.error("Escreva a mensagem.");
      return;
    }
    if (recipients.length === 0) {
      toast.error("Adicione pelo menos um destinatário.");
      return;
    }
    let scheduledAt: Date | null = null;
    if (!sendNow) {
      scheduledAt = combineDateAndTime(date, time);
      if (!scheduledAt) {
        toast.error("Informe a data e a hora do envio.");
        return;
      }
      if (scheduledAt.getTime() < Date.now() + MIN_LEAD_MS) {
        toast.error("Escolha uma data e hora no futuro.");
        return;
      }
    }

    const ok = await confirm({
      title: sendNow ? "Enviar a campanha agora?" : "Agendar a campanha?",
      description: (
        <>
          {plural(recipients.length, "cliente vai", "clientes vão")} receber a
          mensagem
          {sendNow
            ? ", começando em até 1 minuto."
            : ` a partir de ${formatScheduleDateTime(scheduledAt!.toISOString())}.`}{" "}
          Para proteger o número, os envios saem aos poucos e levam cerca de{" "}
          {duration}. Dá para cancelar enquanto estiver enviando.
        </>
      ),
      confirmLabel: sendNow ? "Enviar agora" : "Agendar",
      cancelLabel: "Revisar",
    });
    if (!ok) return;

    try {
      const savedId = await save({
        id: existing?.id ?? null,
        name,
        message,
        scheduledAt,
        sendNow,
        recipients,
        channelConnectionId: numbers.length > 0 ? connectionId : null,
        conversionTagId,
        replyWindowDays,
      });
      toast.success(sendNow ? "Campanha enviada para a fila de envio." : "Campanha agendada.");
      // Enviando agora: abre o resultado para acompanhar o progresso
      navigate(sendNow ? `${CAMPAIGNS_PATH}/${savedId}` : CAMPAIGNS_PATH);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar a campanha.");
    }
  };

  const today = toDateInputValue(new Date());

  return (
    <PageShell
      title={existing ? "Editar campanha" : "Nova campanha"}
      subtitle="A mensagem sai pelo WhatsApp conectado por QR Code, uma conversa individual para cada cliente."
      badge={existing ? <MessageStatusBadge status={existing.status} /> : null}
    >
      <div className="space-y-6">
        <Card className="rounded-2xl border border-slate-200 p-5">
          <SectionTitle icon={MessageSquareTextIcon}>1. Campanha</SectionTitle>
          <label
            htmlFor="campaign-name"
            className="mt-4 block text-sm font-medium text-slate-800"
          >
            Nome da campanha
          </label>
          <input
            id="campaign-name"
            type="text"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Dia das Crianças - 50% de desconto"
            className={`${FIELD_CLASS} mt-1`}
          />
          <p className="mt-1 text-xs text-slate-500">
            Só a equipe vê o nome. Ele aparece na lista e na conversa do cliente
            que responder.
          </p>

          <label
            htmlFor="campaign-message"
            className="mt-5 block text-sm font-medium text-slate-800"
          >
            Mensagem
          </label>
          <textarea
            id="campaign-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={7}
            ref={messageRef}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Ex.: Olá {nome}! No Dia das Crianças todos os serviços estão com 50% de desconto. Responda esta mensagem para agendar."
            className={`${FIELD_CLASS} mt-1 resize-none leading-6`}
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

        <Card className="rounded-2xl border border-slate-200 p-5">
          <SectionTitle icon={TargetIcon}>2. Acompanhar o resultado</SectionTitle>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Quem responder aparece na fila de atendimento com o aviso da
            campanha, e o atendente marca com um clique quem aderiu.
          </p>

          <label
            htmlFor="campaign-conversion-tag"
            className="mt-4 block text-sm font-medium text-slate-800"
          >
            Etiqueta que conta como adesão{" "}
            <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <select
            id="campaign-conversion-tag"
            value={conversionTagId ?? ""}
            onChange={(event) => setConversionTagId(event.target.value || null)}
            className={`${FIELD_CLASS} mt-1 bg-white`}
          >
            <option value="">Nenhuma: só pelo botão "Aderiu"</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Se a equipe já etiqueta quem fecha (ex.: "Promo Crianças"),
            escolha a etiqueta aqui: colocar ela na conversa marca a adesão.
          </p>

          <label
            htmlFor="campaign-window"
            className="mt-4 block text-sm font-medium text-slate-800"
          >
            Acompanhar por
          </label>
          <select
            id="campaign-window"
            value={replyWindowDays}
            onChange={(event) => setReplyWindowDays(Number(event.target.value))}
            className={`${FIELD_CLASS} mt-1 bg-white`}
          >
            {REPLY_WINDOW_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} dias depois do envio
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Respostas e adesões dentro desse prazo contam para esta campanha.
          </p>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={UsersIcon}>3. Para quem</SectionTitle>
            <span className="text-xs text-slate-500">
              {recipients.length} de {MAX_RECIPIENTS}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
            {(
              [
                ["wallet", "Carteira"],
                ["tags", "Por etiqueta"],
                ["manual", "Outro número"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSource(key)}
                className={`rounded-lg px-2 py-1.5 transition ${
                  source === key
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {source === "wallet" && (
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
          )}

          {source === "tags" && (
            <AudienceByTag
              tags={tags}
              selected={audienceTagIds}
              onToggle={toggleAudienceTag}
              onClear={() => setAudienceTagIds([])}
              onAdd={addAudience}
              loading={audience.isPending}
              disabled={isFull}
            />
          )}

          {source === "manual" && (
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
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Selecionados
              </p>
              {recipients.length > 0 && (
                <button
                  type="button"
                  onClick={() => setRecipients([])}
                  className="text-xs font-medium text-slate-500 hover:text-red-600"
                >
                  Remover todos
                </button>
              )}
            </div>
            {recipients.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">
                Ninguém selecionado ainda.
              </p>
            ) : (
              <ul className="mt-2 flex max-h-48 flex-wrap gap-2 overflow-y-auto pr-1">
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

        <Card className="rounded-2xl border border-slate-200 p-5">
          <SectionTitle icon={CalendarClockIcon}>4. Quando</SectionTitle>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(
              [
                [true, "Enviar agora", SendIcon],
                [false, "Agendar", CalendarClockIcon],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={label}
                type="button"
                onClick={() => setSendNow(value)}
                aria-pressed={sendNow === value}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                  sendNow === value
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {!sendNow && (
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
          )}

          <div className="mt-4 flex gap-3 rounded-xl border border-green-200 bg-green-50 p-3 text-xs leading-5 text-green-800">
            <ShieldCheckIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              Para proteger o número, as mensagens saem uma de cada vez, com
              cerca de 30 segundos entre elas (umas 120 por hora).
              {recipients.length > 0 && (
                <>
                  {" "}
                  Com {plural(recipients.length, "destinatário", "destinatários")},
                  o envio leva cerca de <strong>{duration}</strong>.
                </>
              )}
            </p>
          </div>

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

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => navigate(CAMPAIGNS_PATH)}>
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
              : sendNow
                ? "Enviar campanha"
                : existing
                  ? "Salvar alterações"
                  : "Agendar campanha"}
          </Button>
        </div>
      </div>
    </PageShell>
  );
};

const AudienceByTag: React.FC<{
  tags: CampaignTag[];
  selected: string[];
  onToggle: (tagId: string) => void;
  onClear: () => void;
  onAdd: () => void;
  loading: boolean;
  disabled: boolean;
}> = ({ tags, selected, onToggle, onClear, onAdd, loading, disabled }) => {
  const everyone = selected.length === 0;

  return (
    <div className="mt-4">
      <p className="text-xs leading-5 text-slate-500">
        Entram os clientes que têm alguma conversa com uma das etiquetas
        marcadas. Sem etiqueta marcada, entram todos os clientes da carteira.
      </p>
      <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
        <button
          type="button"
          onClick={onClear}
          aria-pressed={everyone}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            everyone
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          <UsersIcon className="h-3.5 w-3.5" />
          Todos os clientes
        </button>
        {tags.map((tag) => {
          const active = selected.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => onToggle(tag.id)}
              aria-pressed={active}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-full border border-black/10"
                style={{ backgroundColor: tag.color ?? "#94a3b8" }}
              />
              {tag.name}
            </button>
          );
        })}
        {tags.length === 0 && (
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <TagIcon className="h-3.5 w-3.5" />
            Nenhuma etiqueta cadastrada.
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onAdd}
        disabled={loading || disabled}
        className="mt-3 border border-slate-200"
      >
        <span className="flex items-center gap-2">
          <PlusIcon className="h-4 w-4" />
          {loading
            ? "Buscando clientes..."
            : everyone
              ? "Adicionar todos os clientes"
              : "Adicionar clientes dessas etiquetas"}
        </span>
      </Button>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Resultado (já começou a ser enviada, foi finalizada ou cancelada)          */
/* -------------------------------------------------------------------------- */

type RecipientFilter = "all" | "replied" | "converted" | "unread" | "failed";

const RECIPIENT_FILTERS: {
  key: RecipientFilter;
  label: string;
  match: (r: ScheduledRecipient) => boolean;
}[] = [
  { key: "all", label: "Todos", match: () => true },
  { key: "replied", label: "Responderam", match: (r) => Boolean(r.repliedAt) },
  { key: "converted", label: "Aderiram", match: (r) => Boolean(r.convertedAt) },
  {
    key: "unread",
    label: "Não leram",
    match: (r) => r.status === "sent" && !r.readAt,
  },
  {
    key: "failed",
    label: "Com falha",
    match: (r) => r.status === "failed",
  },
];

const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

const Pill: React.FC<{ tone: string; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
  >
    {children}
  </span>
);

const CampaignResult: React.FC<{
  scheduledMessage: ScheduledMessage;
}> = ({ scheduledMessage }) => {
  const openConversation = useOpenConversation();
  const confirm = useConfirm();
  const { cancel, retry, acting } = useScheduledMessageActions();
  const stats = useMemo(
    () => campaignStats(scheduledMessage.recipients),
    [scheduledMessage.recipients],
  );
  const missing = useMemo(
    () => retrySummary(scheduledMessage.recipients),
    [scheduledMessage.recipients],
  );
  const { clinicId } = useClinic();
  const { numbers } = useQrWhatsappNumbers(clinicId);
  const { tags } = useCampaignTags(clinicId);
  const [filter, setFilter] = useState<RecipientFilter>("all");
  const status = effectiveStatus(scheduledMessage);

  const numberLabel =
    numbers.length > 1
      ? numbers.find((n) => n.id === scheduledMessage.channelConnectionId)
          ?.label
      : undefined;
  const conversionTag = tags.find((t) => t.id === scheduledMessage.conversionTagId);

  const visible = useMemo(() => {
    const match = RECIPIENT_FILTERS.find((f) => f.key === filter)?.match;
    return match ? scheduledMessage.recipients.filter(match) : scheduledMessage.recipients;
  }, [scheduledMessage.recipients, filter]);

  const handleCancel = async () => {
    const ok = await confirm({
      title: "Cancelar campanha?",
      description:
        "Os envios que ainda não saíram serão cancelados. Os que já foram enviados não são afetados.",
      confirmLabel: "Cancelar envios",
      cancelLabel: "Voltar",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await cancel(scheduledMessage.id);
      toast.success("Campanha cancelada.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível cancelar.");
    }
  };

  const handleRetry = async () => {
    const ok = await confirm({
      title: `Tentar de novo para ${plural(missing.toRetry, "cliente", "clientes")}?`,
      description: (
        <>
          A mesma mensagem volta para a fila de envio, no mesmo ritmo seguro
          (leva cerca de {formatDuration(estimateSendDurationMs(missing.toRetry))}).
          Antes, confira se o WhatsApp está conectado.
          {missing.permanent > 0 &&
            ` Os ${plural(missing.permanent, "número", "números")} sem WhatsApp ficam de fora.`}
        </>
      ),
      confirmLabel: "Tentar de novo",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    try {
      const count = await retry(scheduledMessage.id);
      toast.success(
        `${plural(count, "cliente voltou", "clientes voltaram")} para a fila de envio.`,
      );
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível tentar de novo.");
    }
  };

  const finished = status !== "processing" && status !== "scheduled";
  const showMissing =
    finished && missing.toRetry + missing.permanent + missing.uncertain > 0;

  return (
    <PageShell
      title={campaignTitle(scheduledMessage)}
      subtitle={`Envio a partir de ${formatScheduleDateTime(scheduledMessage.scheduledAt)}`}
      badge={<MessageStatusBadge status={status} />}
    >
      <Card className="rounded-2xl border border-slate-200 p-5 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon={MegaphoneIcon}>Resultado</SectionTitle>
          {isCancellable(scheduledMessage.status) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={acting}
              className="border border-amber-200"
            >
              <span className="flex items-center gap-2 text-amber-700">
                <BanIcon className="h-4 w-4" />
                Cancelar envios restantes
              </span>
            </Button>
          )}
        </div>
        <div className="mt-4">
          <CampaignProgress stats={stats} status={status} />
        </div>
        {showMissing && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 text-xs leading-5 text-amber-900">
              <p className="text-sm font-semibold">Quem não recebeu</p>
              {missing.retryable > 0 && (
                <p>
                  {plural(missing.retryable, "envio falhou", "envios falharam")} sem
                  a mensagem sair (WhatsApp desconectado ou recusa): dá para
                  tentar de novo.
                </p>
              )}
              {missing.cancelled > 0 && (
                <p>
                  {plural(missing.cancelled, "envio foi cancelado", "envios foram cancelados")}{" "}
                  antes de sair.
                </p>
              )}
              {missing.permanent > 0 && (
                <p>
                  {plural(missing.permanent, "número não tem", "números não têm")}{" "}
                  WhatsApp e {missing.permanent === 1 ? "fica" : "ficam"} de fora.
                </p>
              )}
              {missing.uncertain > 0 && (
                <p>
                  {plural(missing.uncertain, "envio não pôde", "envios não puderam")}{" "}
                  ser confirmado{missing.uncertain === 1 ? "" : "s"} e pode
                  {missing.uncertain === 1 ? "" : "m"} ter chegado. Para não
                  mandar em dobro, confira a conversa (filtro “Com falha”) e,
                  se precisar, responda pelo atendimento.
                </p>
              )}
            </div>
            {missing.toRetry > 0 && (
              <Button
                type="button"
                onClick={handleRetry}
                disabled={acting}
                className="flex-shrink-0 rounded-full"
              >
                <span className="flex items-center gap-2">
                  <RotateCcwIcon className="h-4 w-4" />
                  Tentar de novo ({missing.toRetry})
                </span>
              </Button>
            )}
          </div>
        )}
        <div className="mt-5">
          <CampaignFunnel stats={stats} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Respostas e adesões contam até {scheduledMessage.replyWindowDays} dias
          depois de cada envio.{" "}
          {conversionTag
            ? `Colocar a etiqueta “${conversionTag.name}” na conversa marca a adesão.`
            : "A adesão é marcada pelo botão “Aderiu” na conversa."}
        </p>
      </Card>

      <Card className="rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle icon={UsersIcon}>Clientes</SectionTitle>
          <span className="text-xs text-slate-500">
            {visible.length} de {stats.total}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {RECIPIENT_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                filter === key
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Ninguém neste filtro.
          </p>
        ) : (
          <ul className="mt-3 max-h-[32rem] divide-y divide-slate-100 overflow-y-auto pr-1">
            {visible.map((recipient) => (
              <li key={recipient.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {recipientLabel(recipient)}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {formatPhone(recipient.phone)}
                      {recipient.sentAt ? ` · ${shortDateTime(recipient.sentAt)}` : ""}
                    </p>
                  </div>
                  <RecipientStatusBadge status={recipient.status} />
                </div>
                {recipient.status === "sent" && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {recipient.readAt ? (
                      <Pill tone="bg-sky-50 text-sky-700">Lida</Pill>
                    ) : recipient.deliveredAt ? (
                      <Pill tone="bg-slate-100 text-slate-600">Entregue</Pill>
                    ) : null}
                    {recipient.repliedAt && (
                      <Pill tone="bg-blue-50 text-blue-700">
                        Respondeu {shortDateTime(recipient.repliedAt)}
                      </Pill>
                    )}
                    {recipient.convertedAt && (
                      <Pill tone="bg-green-50 text-green-700">
                        <CheckIcon className="h-3 w-3" />
                        Aderiu
                        {recipient.conversionValue
                          ? ` · ${formatCurrency(recipient.conversionValue)}`
                          : ""}
                        {recipient.convertedVia === "tag" ? " (etiqueta)" : ""}
                      </Pill>
                    )}
                  </div>
                )}
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
                    onClick={() => openConversation(recipient.conversationId!)}
                    className="mt-1.5 text-xs font-medium text-blue-600 hover:underline"
                  >
                    Abrir conversa
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

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
    </PageShell>
  );
};
