import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarClockIcon, RepeatIcon, SendIcon, UserPlusIcon } from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../../../contexts/ClinicContext";
import { LeadModal } from "../../leads/components/LeadModal";
import { useQrWhatsappNumbers } from "../hooks/useScheduledMessages";
import { useContactScheduledActions } from "../hooks/useContactScheduledMessages";
import type { ContactScheduledMessage } from "../api/recurring";
import {
  WEEKDAYS,
  describeRecurrence,
  upcomingRuns,
  type Frequency,
  type RecurrenceDraft,
} from "../utils/recurrence";
import { MAX_MESSAGE_LENGTH, defaultScheduleDate, toDateInputValue, toTimeInputValue } from "../utils/schedule";

const FIELD =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100";
const LABEL = "block text-sm font-medium text-slate-800";

const FREQUENCIES: { key: Frequency; label: string }[] = [
  { key: "once", label: "Uma vez" },
  { key: "daily", label: "Todo dia" },
  { key: "weekly", label: "Toda semana" },
  { key: "monthly", label: "Todo mês" },
];

type EndMode = "never" | "date" | "count";

const formatRun = (date: Date) =>
  date.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const ScheduleContactMessageModal: React.FC<{
  contactId: string;
  contactName: string;
  existing: ContactScheduledMessage | null;
  onClose: () => void;
}> = ({ contactId, contactName, existing, onClose }) => {
  const { clinicId } = useClinic();
  const { numbers } = useQrWhatsappNumbers(clinicId);
  const { save, saving } = useContactScheduledActions(contactId);
  const initial = useMemo(() => defaultScheduleDate(), []);

  const [message, setMessage] = useState(existing?.message ?? "");
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? "once");
  const [sendNow, setSendNow] = useState(false);
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? toDateInputValue(initial));
  const [sendTime, setSendTime] = useState(existing?.sendTime ?? toTimeInputValue(initial));
  const [weekdays, setWeekdays] = useState<number[]>(
    existing?.weekdays?.length ? existing.weekdays : [initial.getDay()],
  );
  const [monthDay, setMonthDay] = useState(existing?.monthDay ?? initial.getDate());
  const [endMode, setEndMode] = useState<EndMode>(
    existing?.maxRuns ? "count" : existing?.endsOn ? "date" : "never",
  );
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? "");
  const [maxRuns, setMaxRuns] = useState(existing?.maxRuns ?? 6);
  const [connectionId, setConnectionId] = useState<string | null>(existing?.channelConnectionId ?? null);

  useEffect(() => {
    if (numbers.length === 0) return;
    if (connectionId && numbers.some((n) => n.id === connectionId)) return;
    setConnectionId((numbers.find((n) => n.connected) ?? numbers[0]).id);
  }, [numbers, connectionId]);

  // Inserir {nome} onde está o cursor (aplicado depois que o texto atualiza)
  const textRef = useRef<HTMLTextAreaElement>(null);
  const pendingCursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const cursor = pendingCursor.current;
    if (cursor === null || !textRef.current) return;
    pendingCursor.current = null;
    textRef.current.focus();
    textRef.current.setSelectionRange(cursor, cursor);
  }, [message]);
  const insertName = () => {
    const el = textRef.current;
    const start = el?.selectionStart ?? message.length;
    const end = el?.selectionEnd ?? message.length;
    const next = message.slice(0, start) + "{nome}" + message.slice(end);
    if (next.length > MAX_MESSAGE_LENGTH) return;
    pendingCursor.current = start + "{nome}".length;
    setMessage(next);
  };

  const recurring = frequency !== "once";
  const draft: RecurrenceDraft = {
    frequency,
    weekdays,
    monthDay,
    sendTime,
    startsOn,
    endsOn: recurring && endMode === "date" && endsOn ? endsOn : null,
    maxRuns: recurring && endMode === "count" ? maxRuns : null,
  };
  const now = new Date();
  const runs = frequency === "once" && sendNow ? [] : upcomingRuns(draft, now, 3);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim()) {
      toast.error("Escreva a mensagem.");
      return;
    }
    if (frequency === "weekly" && weekdays.length === 0) {
      toast.error("Escolha pelo menos um dia da semana.");
      return;
    }
    if (!(frequency === "once" && sendNow) && runs.length === 0) {
      toast.error("Com essas datas não sobra nenhum envio no futuro.");
      return;
    }
    try {
      await save({
        ...draft,
        id: existing?.id ?? null,
        contactId,
        message,
        sendNow: frequency === "once" && sendNow,
        channelConnectionId: numbers.length > 0 ? connectionId : null,
      });
      toast.success(
        frequency === "once" && sendNow
          ? "Mensagem a caminho (sai em até 2 minutos)."
          : recurring
            ? "Mensagem recorrente agendada."
            : "Mensagem agendada.",
      );
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível agendar.");
    }
  };

  return (
    <LeadModal
      title={existing ? "Editar mensagem agendada" : "Agendar mensagem"}
      subtitle={`Para ${contactName}, pelo WhatsApp`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-5">
        {/* Mensagem */}
        <div>
          <div className="flex items-end justify-between">
            <label htmlFor="contact-msg" className={LABEL}>
              Mensagem
            </label>
            <span className="text-xs text-slate-400">
              {message.length}/{MAX_MESSAGE_LENGTH}
            </span>
          </div>
          <textarea
            id="contact-msg"
            ref={textRef}
            autoFocus
            rows={4}
            value={message}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ex.: Oi {nome}! Passando para lembrar do seu horário amanhã às 14h."
            className={`${FIELD} mt-1.5 resize-y leading-6`}
          />
          <button
            type="button"
            onClick={insertName}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          >
            <UserPlusIcon className="h-3.5 w-3.5" />
            Inserir nome do cliente
          </button>
        </div>

        {/* Repetição */}
        <div>
          <span className={LABEL}>Quando enviar</span>
          <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-4">
            {FREQUENCIES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFrequency(key)}
                aria-pressed={frequency === key}
                className={`rounded-lg px-2 py-1.5 text-sm font-medium transition ${
                  frequency === key ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {frequency === "once" && (
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                [true, "Enviar agora", SendIcon],
                [false, "Escolher data", CalendarClockIcon],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={label}
                type="button"
                onClick={() => setSendNow(value)}
                aria-pressed={sendNow === value}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                  sendNow === value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        )}

        {frequency === "weekly" && (
          <div>
            <span className={LABEL}>Dias da semana</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => {
                const active = weekdays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={active}
                    aria-label={d.long}
                    onClick={() =>
                      setWeekdays((prev) =>
                        prev.includes(d.value) ? prev.filter((x) => x !== d.value) : [...prev, d.value],
                      )
                    }
                    className={`h-10 w-12 rounded-xl border text-sm font-medium transition ${
                      active ? "border-blue-500 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!(frequency === "once" && sendNow) && (
          <div className="grid grid-cols-2 gap-3">
            {frequency === "monthly" ? (
              <div>
                <label htmlFor="contact-month-day" className={LABEL}>
                  Dia do mês
                </label>
                <select
                  id="contact-month-day"
                  value={monthDay}
                  onChange={(event) => setMonthDay(Number(event.target.value))}
                  className={`${FIELD} mt-1.5`}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Dia {d}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label htmlFor="contact-start" className={LABEL}>
                  {frequency === "once" ? "Data" : "A partir de"}
                </label>
                <input
                  id="contact-start"
                  type="date"
                  value={startsOn}
                  min={toDateInputValue(new Date())}
                  onChange={(event) => setStartsOn(event.target.value)}
                  className={`${FIELD} mt-1.5`}
                />
              </div>
            )}
            <div>
              <label htmlFor="contact-time" className={LABEL}>
                Horário
              </label>
              <input
                id="contact-time"
                type="time"
                value={sendTime}
                onChange={(event) => setSendTime(event.target.value)}
                className={`${FIELD} mt-1.5`}
              />
            </div>
            {frequency === "monthly" && monthDay > 28 && (
              <p className="col-span-2 text-xs text-slate-500">
                Em meses com menos dias, a mensagem sai no último dia do mês.
              </p>
            )}
          </div>
        )}

        {recurring && (
          <div>
            <span className={LABEL}>Termina</span>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {(
                [
                  ["never", "Nunca"],
                  ["date", "Em uma data"],
                  ["count", "Depois de"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEndMode(key)}
                  aria-pressed={endMode === key}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    endMode === key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
              {endMode === "date" && (
                <input
                  type="date"
                  value={endsOn}
                  min={startsOn}
                  onChange={(event) => setEndsOn(event.target.value)}
                  className={`${FIELD} w-auto`}
                  aria-label="Data final"
                />
              )}
              {endMode === "count" && (
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={maxRuns}
                    onChange={(event) => setMaxRuns(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))}
                    className={`${FIELD} w-20`}
                    aria-label="Quantidade de envios"
                  />
                  envios
                </span>
              )}
            </div>
          </div>
        )}

        {numbers.length > 1 && (
          <div>
            <label htmlFor="contact-number" className={LABEL}>
              Enviar pelo número
            </label>
            <select
              id="contact-number"
              value={connectionId ?? ""}
              onChange={(event) => setConnectionId(event.target.value || null)}
              className={`${FIELD} mt-1.5`}
            >
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.connected ? n.label : `${n.label} (desconectado)`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Resumo */}
        <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-sm text-blue-900">
          <p className="flex items-center gap-2 font-semibold">
            {recurring ? <RepeatIcon className="h-4 w-4" /> : <CalendarClockIcon className="h-4 w-4" />}
            {frequency === "once" && sendNow ? "Envio imediato (em até 2 minutos)" : describeRecurrence(draft)}
          </p>
          {runs.length > 0 && (
            <p className="mt-1 text-xs text-blue-800">
              {recurring ? "Próximos envios: " : "Envio: "}
              {runs.map(formatRun).join(" · ")}
            </p>
          )}
          {!(frequency === "once" && sendNow) && runs.length === 0 && (
            <p className="mt-1 text-xs text-red-700">Com essas datas não sobra nenhum envio no futuro.</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
          >
            {saving
              ? "Salvando..."
              : existing
                ? "Salvar alterações"
                : frequency === "once" && sendNow
                  ? "Enviar agora"
                  : "Agendar"}
          </button>
        </div>
      </form>
    </LeadModal>
  );
};
