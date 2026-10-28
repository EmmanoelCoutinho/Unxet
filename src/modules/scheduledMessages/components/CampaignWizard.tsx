import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookUserIcon,
  CalendarClockIcon,
  CheckIcon,
  ChevronDownIcon,
  HashIcon,
  PencilIcon,
  PlusIcon,
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
import { useClinic } from "../../../contexts/ClinicContext";
import {
  useCampaignAudience,
  useCampaignTags,
  useQrWhatsappConnected,
  useQrWhatsappNumbers,
  useScheduledMessageActions,
  useWalletContactSearch,
} from "../hooks/useScheduledMessages";
import type {
  CampaignTag,
  RecipientDraft,
  ScheduledMessage,
  WalletContact,
} from "../types/scheduledMessages";
import {
  DEFAULT_REPLY_WINDOW_DAYS,
  MAX_MESSAGE_LENGTH,
  MAX_RECIPIENTS,
  MIN_LEAD_MS,
  REPLY_WINDOW_OPTIONS,
  combineDateAndTime,
  defaultScheduleDate,
  estimateSendDurationMs,
  formatDuration,
  formatPhone,
  formatScheduleDateTime,
  normalizeTypedPhone,
  onlyDigits,
  previewMessageText,
  recipientLabel,
  toDateInputValue,
  toTimeInputValue,
} from "../utils/schedule";
import { CAMPAIGNS_PATH } from "../paths";
import { WhatsappPreview } from "./WhatsappPreview";

const MAX_NAME_LENGTH = 120;

const FIELD =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100";
const LABEL = "block text-sm font-medium text-slate-800";
const HINT = "mt-1.5 text-xs leading-5 text-slate-500";

type StepKey = "message" | "audience" | "delivery" | "review";

const STEPS: { key: StepKey; label: string; description: string }[] = [
  { key: "message", label: "Mensagem", description: "O que os clientes vão receber" },
  { key: "audience", label: "Destinatários", description: "Quem vai receber" },
  { key: "delivery", label: "Envio", description: "Quando e por qual número" },
  { key: "review", label: "Revisão", description: "Confira antes de enviar" },
];

type Source = "all" | "tags" | "wallet" | "manual";

const SOURCES: {
  key: Source;
  label: string;
  description: string;
  icon: React.ElementType<{ className?: string }>;
}[] = [
  { key: "all", label: "Todos os clientes", description: "A carteira inteira, até 300", icon: UsersIcon },
  { key: "tags", label: "Por etiqueta", description: "Quem tem uma etiqueta", icon: TagIcon },
  { key: "wallet", label: "Escolher na carteira", description: "Busque e marque um a um", icon: BookUserIcon },
  { key: "manual", label: "Número avulso", description: "Quem não está na carteira", icon: HashIcon },
];

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/* -------------------------------------------------------------------------- */

export const CampaignWizard: React.FC<{ existing: ScheduledMessage | null }> = ({ existing }) => {
  const navigate = useNavigate();
  const { clinicId } = useClinic();
  const { save, saving } = useScheduledMessageActions();
  const qrConnected = useQrWhatsappConnected(clinicId);

  // Editando: todas as etapas já estão preenchidas e ficam liberadas
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(existing ? STEPS.length - 1 : 0);

  const initialDate = useRef(existing ? new Date(existing.scheduledAt) : defaultScheduleDate()).current;

  const [name, setName] = useState(existing?.name ?? "");
  const [message, setMessage] = useState(existing?.message ?? "");
  const [recipients, setRecipients] = useState<RecipientDraft[]>(() =>
    (existing?.recipients ?? []).map((r) => ({ contactId: r.contactId, name: r.name, phone: r.phone })),
  );
  const [sendNow, setSendNow] = useState(!existing);
  const [date, setDate] = useState(toDateInputValue(initialDate));
  const [time, setTime] = useState(toTimeInputValue(initialDate));
  const [conversionTagId, setConversionTagId] = useState<string | null>(existing?.conversionTagId ?? null);
  const [replyWindowDays, setReplyWindowDays] = useState(existing?.replyWindowDays ?? DEFAULT_REPLY_WINDOW_DAYS);

  const { numbers } = useQrWhatsappNumbers(clinicId);
  const [connectionId, setConnectionId] = useState<string | null>(existing?.channelConnectionId ?? null);
  useEffect(() => {
    if (numbers.length === 0) return;
    if (connectionId && numbers.some((n) => n.id === connectionId)) return;
    setConnectionId((numbers.find((n) => n.connected) ?? numbers[0]).id);
  }, [numbers, connectionId]);

  const { tags } = useCampaignTags(clinicId);

  const scheduledAt = sendNow ? null : combineDateAndTime(date, time);
  const duration = formatDuration(estimateSendDurationMs(recipients.length));
  const numberLabel = numbers.find((n) => n.id === connectionId)?.label ?? null;
  const conversionTag = tags.find((t) => t.id === conversionTagId) ?? null;

  /* ------------------------------- Validação ------------------------------ */

  const stepError = (index: number): string | null => {
    switch (STEPS[index].key) {
      case "message":
        if (!name.trim()) return "Dê um nome para a campanha.";
        if (!message.trim()) return "Escreva a mensagem.";
        return null;
      case "audience":
        return recipients.length === 0 ? "Adicione pelo menos um destinatário." : null;
      case "delivery":
        if (sendNow) return null;
        if (!scheduledAt) return "Informe a data e a hora do envio.";
        if (scheduledAt.getTime() < Date.now() + MIN_LEAD_MS) return "Escolha uma data e hora no futuro.";
        return null;
      default:
        return null;
    }
  };

  const goTo = (index: number) => {
    // Para avançar, as etapas anteriores precisam estar certas
    for (let i = 0; i < index; i++) {
      const error = stepError(i);
      if (error) {
        setStep(i);
        toast.error(error);
        return;
      }
    }
    setStep(index);
    setReached((r) => Math.max(r, index));
  };

  const submit = async () => {
    for (let i = 0; i < STEPS.length - 1; i++) {
      const error = stepError(i);
      if (error) {
        setStep(i);
        toast.error(error);
        return;
      }
    }
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

  // Cada etapa começa do topo
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  const isLast = step === STEPS.length - 1;
  // Sem espaço ao lado (abaixo de xl), a prévia só aparece onde ela ajuda
  const previewOnSmall = STEPS[step].key === "message" || STEPS[step].key === "review";
  const previewName = recipients.find((r) => /\p{L}/u.test(r.name ?? ""))?.name ?? "Maria";

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      {/* Cabeçalho + etapas */}
      <header className="border-b bg-white px-4 pt-4 sm:px-8 sm:pt-5">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(CAMPAIGNS_PATH)}
            className="rounded-full border border-slate-200 p-2 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            aria-label="Voltar para a lista de campanhas"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-slate-900">
              {existing ? "Editar campanha" : "Nova campanha"}
            </h1>
            <p className="text-sm text-slate-500">{STEPS[step].description}</p>
          </div>
        </div>
        <Stepper current={step} reached={reached} onSelect={goTo} />
      </header>

      {/* Etapa atual + prévia */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            {STEPS[step].key === "message" && (
              <MessageStep name={name} setName={setName} message={message} setMessage={setMessage} />
            )}
            {STEPS[step].key === "audience" && (
              <AudienceStep
                clinicId={clinicId}
                tags={tags}
                recipients={recipients}
                setRecipients={setRecipients}
              />
            )}
            {STEPS[step].key === "delivery" && (
              <DeliveryStep
                sendNow={sendNow}
                setSendNow={setSendNow}
                date={date}
                setDate={setDate}
                time={time}
                setTime={setTime}
                numbers={numbers}
                connectionId={connectionId}
                setConnectionId={setConnectionId}
                recipientsCount={recipients.length}
                duration={duration}
                tags={tags}
                conversionTagId={conversionTagId}
                setConversionTagId={setConversionTagId}
                replyWindowDays={replyWindowDays}
                setReplyWindowDays={setReplyWindowDays}
              />
            )}
            {STEPS[step].key === "review" && (
              <ReviewStep
                name={name}
                message={message}
                recipients={recipients}
                sendNow={sendNow}
                scheduledAt={scheduledAt}
                duration={duration}
                numberLabel={numbers.length > 1 ? numberLabel : null}
                conversionTag={conversionTag}
                replyWindowDays={replyWindowDays}
                qrConnected={qrConnected}
                onEdit={(key) => goTo(STEPS.findIndex((s) => s.key === key))}
              />
            )}
          </div>

          <aside className={`xl:sticky xl:top-0 xl:block ${previewOnSmall ? "" : "hidden"}`}>
            <MessagePreview
              text={previewMessageText(message, previewName)}
              recipientName={previewName}
              recipientsCount={recipients.length}
              sendNow={sendNow}
              scheduledAt={scheduledAt}
            />
          </aside>
        </div>
      </div>

      {/* Navegação entre etapas */}
      <footer className="border-t bg-white px-4 py-3 sm:px-8">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => (step === 0 ? navigate(CAMPAIGNS_PATH) : setStep(step - 1))}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            {step === 0 ? (
              "Cancelar"
            ) : (
              <>
                <ArrowLeftIcon className="h-4 w-4" />
                Voltar
              </>
            )}
          </button>
          <span className="hidden text-xs text-slate-400 sm:block">
            Etapa {step + 1} de {STEPS.length}
          </span>
          {isLast ? (
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
            >
              {sendNow ? <SendIcon className="h-4 w-4" /> : <CalendarClockIcon className="h-4 w-4" />}
              {saving
                ? "Salvando..."
                : sendNow
                  ? `Enviar para ${plural(recipients.length, "cliente", "clientes")}`
                  : existing
                    ? "Salvar alterações"
                    : "Agendar campanha"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                const error = stepError(step);
                if (error) {
                  toast.error(error);
                  return;
                }
                goTo(step + 1);
              }}
              className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Continuar
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
};

/* --------------------------------- Etapas -------------------------------- */

const Stepper: React.FC<{
  current: number;
  reached: number;
  onSelect: (index: number) => void;
}> = ({ current, reached, onSelect }) => (
  <nav aria-label="Etapas da campanha" className="mx-auto mt-4 w-full max-w-6xl">
    <ol className="flex gap-1 sm:gap-2">
      {STEPS.map((s, index) => {
        const done = index < current;
        const active = index === current;
        const enabled = index <= reached;
        return (
          <li key={s.key} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onSelect(index)}
              disabled={!enabled}
              aria-current={active ? "step" : undefined}
              aria-label={`Etapa ${index + 1}: ${s.label}`}
              className={`group flex w-full flex-col gap-2 pb-3 text-left transition disabled:cursor-not-allowed ${
                enabled ? "" : "opacity-60"
              }`}
            >
              <span
                className={`h-1 w-full rounded-full transition ${
                  active ? "bg-blue-600" : done ? "bg-blue-300" : "bg-slate-200"
                }`}
              />
              <span className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold transition ${
                    active
                      ? "bg-blue-600 text-white"
                      : done
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {done ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span
                  className={`truncate text-sm font-medium ${
                    active ? "text-slate-900" : "text-slate-500 group-enabled:group-hover:text-slate-700"
                  } ${active ? "" : "hidden sm:inline"}`}
                >
                  {s.label}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  </nav>
);

const StepCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
    {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    <div className="mt-5">{children}</div>
  </section>
);

/* 1. Mensagem */

const MessageStep: React.FC<{
  name: string;
  setName: (v: string) => void;
  message: string;
  setMessage: (v: string) => void;
}> = ({ name, setName, message, setMessage }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Onde o cursor fica depois de inserir {nome}: aplicado só depois que o
  // texto novo já está no campo (antes disso o navegador o joga para o fim)
  const pendingCursor = useRef<number | null>(null);

  useLayoutEffect(() => {
    const cursor = pendingCursor.current;
    const textarea = ref.current;
    if (cursor === null || !textarea) return;
    pendingCursor.current = null;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
  }, [message]);

  // Coloca {nome} onde está o cursor (ou no fim, se o campo nunca teve foco)
  const insertName = () => {
    const textarea = ref.current;
    const start = textarea?.selectionStart ?? message.length;
    const end = textarea?.selectionEnd ?? message.length;
    const next = message.slice(0, start) + "{nome}" + message.slice(end);
    if (next.length > MAX_MESSAGE_LENGTH) {
      toast.error("A mensagem já está no tamanho máximo.");
      return;
    }
    pendingCursor.current = start + "{nome}".length;
    setMessage(next);
  };

  return (
    <StepCard title="Escreva a mensagem" subtitle="Cada cliente recebe numa conversa individual, como se fosse só para ele.">
      <div className="space-y-5">
        <div>
          <label htmlFor="campaign-name" className={LABEL}>
            Nome da campanha
          </label>
          <input
            id="campaign-name"
            type="text"
            autoFocus
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Dia das Crianças - 50% de desconto"
            className={`${FIELD} mt-1.5`}
          />
          <p className={HINT}>Só a equipe vê. Ajuda a achar a campanha e aparece na conversa de quem responder.</p>
        </div>

        <div>
          <div className="flex items-end justify-between gap-3">
            <label htmlFor="campaign-message" className={LABEL}>
              Mensagem
            </label>
            <span className="text-xs text-slate-400">
              {message.length}/{MAX_MESSAGE_LENGTH}
            </span>
          </div>
          <textarea
            id="campaign-message"
            ref={ref}
            value={message}
            rows={8}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ex.: Olá {nome}! No Dia das Crianças todos os serviços estão com 50% de desconto. Responda esta mensagem para agendar."
            className={`${FIELD} mt-1.5 resize-y leading-6`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={insertName}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            >
              <UserPlusIcon className="h-3.5 w-3.5" />
              Inserir nome do cliente
            </button>
            <span className="text-xs text-slate-500">
              Vira o nome de quem recebe. Sem nome cadastrado, é retirado do texto.
            </span>
          </div>
        </div>
      </div>
    </StepCard>
  );
};

/* 2. Destinatários */

const AudienceStep: React.FC<{
  clinicId: string | null;
  tags: CampaignTag[];
  recipients: RecipientDraft[];
  setRecipients: React.Dispatch<React.SetStateAction<RecipientDraft[]>>;
}> = ({ clinicId, tags, recipients, setRecipients }) => {
  const [source, setSource] = useState<Source>("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const audience = useCampaignAudience();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { contacts, loading, error } = useWalletContactSearch(clinicId, debounced, source === "wallet");

  const selected = useMemo(() => new Set(recipients.map((r) => r.phone)), [recipients]);
  const isFull = recipients.length >= MAX_RECIPIENTS;

  const add = (recipient: RecipientDraft) => {
    if (selected.has(recipient.phone)) {
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
  const remove = (phone: string) => setRecipients((prev) => prev.filter((r) => r.phone !== phone));

  const toggleContact = (contact: WalletContact) => {
    const phone = onlyDigits(contact.phone);
    if (!phone) return;
    if (selected.has(phone)) remove(phone);
    else add({ contactId: contact.id, name: contact.name, phone });
  };

  const addAudience = async (ids: string[]) => {
    try {
      const found = await audience.mutateAsync(ids);
      const seen = new Set(selected);
      const fresh: RecipientDraft[] = [];
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
          `${plural(accepted.length, "cliente adicionado", "clientes adicionados")}. O limite é ${MAX_RECIPIENTS} por campanha: ${fresh.length - accepted.length} ficaram de fora.`,
        );
      } else {
        toast.success(plural(accepted.length, "cliente adicionado", "clientes adicionados"));
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível buscar os clientes.");
    }
  };

  const addManual = () => {
    const phone = normalizeTypedPhone(manualPhone);
    if (!phone) {
      toast.error("Informe o número com DDD. Ex.: (11) 99999-8888");
      return;
    }
    if (add({ contactId: null, name: manualName.trim() || null, phone })) {
      setManualName("");
      setManualPhone("");
    }
  };

  const percent = Math.round((recipients.length / MAX_RECIPIENTS) * 100);

  return (
    <div className="space-y-4">
      <StepCard title="Para quem vai a campanha?" subtitle="Combine as opções à vontade: tudo entra na mesma lista, sem repetir número.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SOURCES.map(({ key, label, description, icon: Icon }) => {
            const active = source === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSource(key)}
                aria-pressed={active}
                className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition ${
                  active
                    ? "border-blue-500 bg-blue-50/70 ring-4 ring-blue-100"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className={`block text-sm font-semibold ${active ? "text-blue-800" : "text-slate-800"}`}>
                    {label}
                  </span>
                  <span className="block text-xs leading-4 text-slate-500">{description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          {source === "all" && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Adiciona todos os clientes da carteira que têm WhatsApp, até completar {MAX_RECIPIENTS}.
              </p>
              <button
                type="button"
                onClick={() => addAudience([])}
                disabled={audience.isPending || isFull}
                className="inline-flex flex-shrink-0 items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                <PlusIcon className="h-4 w-4" />
                {audience.isPending ? "Buscando..." : "Adicionar todos"}
              </button>
            </div>
          )}

          {source === "tags" && (
            <div>
              {tags.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma etiqueta cadastrada.</p>
              ) : (
                <>
                  <p className="text-sm text-slate-600">
                    Marque as etiquetas. Entram os clientes com alguma conversa marcada com elas.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {tags.map((tag) => {
                      const active = tagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setTagIds((prev) =>
                              prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : [...prev, tag.id],
                            )
                          }
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                            active
                              ? "border-blue-500 bg-white text-blue-700 ring-2 ring-blue-100"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          }`}
                        >
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color ?? "#94a3b8" }} />
                          {tag.name}
                          {active && <CheckIcon className="h-3.5 w-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => addAudience(tagIds)}
                    disabled={tagIds.length === 0 || audience.isPending || isFull}
                    className="mt-3 inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    <PlusIcon className="h-4 w-4" />
                    {audience.isPending ? "Buscando..." : "Adicionar clientes dessas etiquetas"}
                  </button>
                </>
              )}
            </div>
          )}

          {source === "wallet" && (
            <div>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por nome ou telefone"
                  aria-label="Buscar cliente"
                  className={`${FIELD} pl-10`}
                />
              </div>
              <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
                {error ? (
                  <p className="py-6 text-center text-sm text-red-600">Não foi possível carregar a carteira.</p>
                ) : loading ? (
                  <p className="py-6 text-center text-sm text-slate-400">Carregando clientes...</p>
                ) : contacts.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">
                    {debounced ? "Nenhum cliente encontrado." : "A carteira ainda não tem clientes."}
                  </p>
                ) : (
                  contacts.map((contact) => {
                    const isSelected = selected.has(onlyDigits(contact.phone));
                    return (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => toggleContact(contact)}
                        aria-pressed={isSelected}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                          isSelected ? "border-blue-200 bg-white" : "border-transparent hover:bg-white"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-800">{recipientLabel(contact)}</span>
                          <span className="block truncate text-xs text-slate-500">{formatPhone(contact.phone)}</span>
                        </span>
                        <span
                          className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border transition ${
                            isSelected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-400"
                          }`}
                        >
                          {isSelected ? <CheckIcon className="h-3.5 w-3.5" /> : <PlusIcon className="h-3.5 w-3.5" />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {source === "manual" && (
            <form
              className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                addManual();
              }}
            >
              <div>
                <label htmlFor="manual-phone" className={LABEL}>
                  WhatsApp com DDD
                </label>
                <input
                  id="manual-phone"
                  type="tel"
                  inputMode="tel"
                  value={manualPhone}
                  onChange={(event) => setManualPhone(event.target.value)}
                  placeholder="(11) 99999-8888"
                  className={`${FIELD} mt-1.5`}
                />
              </div>
              <div>
                <label htmlFor="manual-name" className={LABEL}>
                  Nome <span className="font-normal text-slate-400">(opcional)</span>
                </label>
                <input
                  id="manual-name"
                  type="text"
                  value={manualName}
                  maxLength={80}
                  onChange={(event) => setManualName(event.target.value)}
                  placeholder="Como chamar a pessoa"
                  className={`${FIELD} mt-1.5`}
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                <PlusIcon className="h-4 w-4" />
                Adicionar
              </button>
            </form>
          )}
        </div>
      </StepCard>

      {/* Lista montada */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">
            {recipients.length === 0
              ? "Ninguém na lista ainda"
              : `${plural(recipients.length, "destinatário", "destinatários")}`}
            <span className="ml-1 font-normal text-slate-400">de {MAX_RECIPIENTS}</span>
          </h3>
          {recipients.length > 0 && (
            <button
              type="button"
              onClick={() => setRecipients([])}
              className="rounded-full px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600"
            >
              Remover todos
            </button>
          )}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${percent >= 100 ? "bg-amber-500" : "bg-blue-500"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {recipients.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">Escolha uma das opções acima para montar a lista.</p>
        ) : (
          <ul className="mt-4 flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
            {recipients.map((recipient) => (
              <li
                key={recipient.phone}
                className="flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-sm text-slate-700"
                title={formatPhone(recipient.phone)}
              >
                <span className="truncate">{recipientLabel(recipient)}</span>
                <button
                  type="button"
                  onClick={() => remove(recipient.phone)}
                  className="rounded-full p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                  aria-label={`Remover ${recipientLabel(recipient)}`}
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

/* 3. Envio */

const DeliveryStep: React.FC<{
  sendNow: boolean;
  setSendNow: (v: boolean) => void;
  date: string;
  setDate: (v: string) => void;
  time: string;
  setTime: (v: string) => void;
  numbers: { id: string; label: string; connected: boolean }[];
  connectionId: string | null;
  setConnectionId: (v: string | null) => void;
  recipientsCount: number;
  duration: string;
  tags: CampaignTag[];
  conversionTagId: string | null;
  setConversionTagId: (v: string | null) => void;
  replyWindowDays: number;
  setReplyWindowDays: (v: number) => void;
}> = (props) => {
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(props.conversionTagId));
  const today = toDateInputValue(new Date());

  const options = [
    {
      value: true,
      title: "Enviar agora",
      description: "Começa em até 1 minuto",
      icon: SendIcon,
    },
    {
      value: false,
      title: "Agendar",
      description: "Escolha o dia e a hora",
      icon: CalendarClockIcon,
    },
  ] as const;

  return (
    <div className="space-y-4">
      <StepCard title="Quando enviar?">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {options.map(({ value, title, description, icon: Icon }) => {
            const active = props.sendNow === value;
            return (
              <button
                key={title}
                type="button"
                onClick={() => props.setSendNow(value)}
                aria-pressed={active}
                className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${
                  active
                    ? "border-blue-500 bg-blue-50/70 ring-4 ring-blue-100"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                    active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className={`block text-sm font-semibold ${active ? "text-blue-800" : "text-slate-800"}`}>{title}</span>
                  <span className="block text-xs text-slate-500">{description}</span>
                </span>
              </button>
            );
          })}
        </div>

        {!props.sendNow && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="campaign-date" className={LABEL}>
                Data
              </label>
              <input
                id="campaign-date"
                type="date"
                value={props.date}
                min={today}
                onChange={(event) => props.setDate(event.target.value)}
                className={`${FIELD} mt-1.5`}
              />
            </div>
            <div>
              <label htmlFor="campaign-time" className={LABEL}>
                Hora
              </label>
              <input
                id="campaign-time"
                type="time"
                value={props.time}
                onChange={(event) => props.setTime(event.target.value)}
                className={`${FIELD} mt-1.5`}
              />
            </div>
            <p className="col-span-2 text-xs text-slate-500">Horário do seu computador.</p>
          </div>
        )}

        {props.numbers.length > 1 && (
          <div className="mt-5">
            <label htmlFor="campaign-number" className={LABEL}>
              Enviar pelo número
            </label>
            <select
              id="campaign-number"
              value={props.connectionId ?? ""}
              onChange={(event) => props.setConnectionId(event.target.value || null)}
              className={`${FIELD} mt-1.5`}
            >
              {props.numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.connected ? n.label : `${n.label} (desconectado)`}
                </option>
              ))}
            </select>
            <p className={HINT}>As respostas dos clientes chegam por esse mesmo número.</p>
          </div>
        )}

        <div className="mt-5 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <ShieldCheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" />
          <p className="leading-6">
            <span className="font-semibold">Envio seguro para o seu número.</span> As mensagens saem uma de cada
            vez, a cada ~30 segundos.
            {props.recipientsCount > 0 && (
              <>
                {" "}
                Para {plural(props.recipientsCount, "cliente", "clientes")}, leva cerca de{" "}
                <span className="font-semibold">{props.duration}</span>.
              </>
            )}
          </p>
        </div>
      </StepCard>

      {/* Opcional: como medir quem aderiu */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className="flex w-full items-center justify-between gap-3 rounded-2xl p-5 text-left transition hover:bg-slate-50 sm:px-6"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <TargetIcon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-slate-900">Acompanhar quem aderiu</span>
              <span className="block text-xs text-slate-500">
                Opcional · por padrão, a equipe marca "Aderiu" na conversa
              </span>
            </span>
          </span>
          <ChevronDownIcon className={`h-5 w-5 text-slate-400 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
        </button>
        {advancedOpen && (
          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 p-5 sm:grid-cols-2 sm:px-6">
            <div>
              <label htmlFor="campaign-tag" className={LABEL}>
                Etiqueta que conta como adesão
              </label>
              <select
                id="campaign-tag"
                value={props.conversionTagId ?? ""}
                onChange={(event) => props.setConversionTagId(event.target.value || null)}
                className={`${FIELD} mt-1.5`}
              >
                <option value="">Nenhuma: só o botão "Aderiu"</option>
                {props.tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <p className={HINT}>Colocar essa etiqueta na conversa marca a adesão sozinha.</p>
            </div>
            <div>
              <label htmlFor="campaign-window" className={LABEL}>
                Acompanhar por
              </label>
              <select
                id="campaign-window"
                value={props.replyWindowDays}
                onChange={(event) => props.setReplyWindowDays(Number(event.target.value))}
                className={`${FIELD} mt-1.5`}
              >
                {REPLY_WINDOW_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days} dias depois do envio
                  </option>
                ))}
              </select>
              <p className={HINT}>Respostas e adesões nesse prazo contam para esta campanha.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

/* 4. Revisão */

const ReviewRow: React.FC<{
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}> = ({ label, onEdit, children }) => (
  <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-1 text-sm text-slate-800">{children}</div>
    </div>
    <button
      type="button"
      onClick={onEdit}
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-50"
    >
      <PencilIcon className="h-3 w-3" />
      Editar
    </button>
  </div>
);

const ReviewStep: React.FC<{
  name: string;
  message: string;
  recipients: RecipientDraft[];
  sendNow: boolean;
  scheduledAt: Date | null;
  duration: string;
  numberLabel: string | null;
  conversionTag: CampaignTag | null;
  replyWindowDays: number;
  qrConnected: boolean;
  onEdit: (key: StepKey) => void;
}> = (props) => {
  const names = props.recipients.slice(0, 3).map(recipientLabel);
  const rest = props.recipients.length - names.length;

  return (
    <div className="space-y-4">
      {!props.qrConnected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          O WhatsApp por QR Code da empresa está desconectado. A campanha só sai se ele estiver conectado no
          horário do envio.
        </div>
      )}
      <StepCard title="Tudo certo?" subtitle="Confira os detalhes. Você pode cancelar enquanto estiver enviando.">
        <div className="divide-y divide-slate-100">
          <ReviewRow label="Campanha" onEdit={() => props.onEdit("message")}>
            <p className="font-semibold">{props.name}</p>
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-slate-600">{props.message}</p>
          </ReviewRow>
          <ReviewRow label="Destinatários" onEdit={() => props.onEdit("audience")}>
            <p className="font-semibold">{plural(props.recipients.length, "cliente", "clientes")}</p>
            <p className="mt-1 text-slate-600">
              {names.join(", ")}
              {rest > 0 ? ` e mais ${rest}` : ""}
            </p>
          </ReviewRow>
          <ReviewRow label="Envio" onEdit={() => props.onEdit("delivery")}>
            <p className="font-semibold">
              {props.sendNow
                ? "Agora"
                : props.scheduledAt
                  ? formatScheduleDateTime(props.scheduledAt.toISOString())
                  : "-"}
            </p>
            <p className="mt-1 text-slate-600">
              Leva cerca de {props.duration}
              {props.numberLabel ? ` · pelo número ${props.numberLabel}` : ""}
            </p>
          </ReviewRow>
          <ReviewRow label="Adesão" onEdit={() => props.onEdit("delivery")}>
            <p className="text-slate-600">
              {props.conversionTag
                ? `Etiqueta “${props.conversionTag.name}” ou botão “Aderiu”`
                : "Botão “Aderiu” na conversa"}
              {` · ${props.replyWindowDays} dias`}
            </p>
          </ReviewRow>
        </div>
      </StepCard>
    </div>
  );
};

/* ------------------------------ Prévia ----------------------------------- */

const MessagePreview: React.FC<{
  text: string;
  recipientName: string;
  recipientsCount: number;
  sendNow: boolean;
  scheduledAt: Date | null;
}> = ({ text, recipientName, recipientsCount, sendNow, scheduledAt }) => {
  const time = (sendNow || !scheduledAt ? new Date() : scheduledAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <WhatsappPreview
      title="Prévia"
      meta={recipientsCount > 0 ? plural(recipientsCount, "destinatário", "destinatários") : "Sem destinatários"}
      recipientName={recipientName}
      text={text}
      time={time}
    />
  );
};
