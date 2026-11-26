import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BellIcon,
  CheckCircle2Icon,
  CheckIcon,
  ClockIcon,
  MessageCircleIcon,
  RotateCcwIcon,
  SearchIcon,
  SparklesIcon,
  UserXIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "../../../components/ui/Button";
import { useWalletContactSearch } from "../../scheduledMessages/hooks/useScheduledMessages";
import { formatPhone, recipientLabel } from "../../scheduledMessages/utils/schedule";
import { agendaErrorMessage } from "../api/agenda";
import { useAgendaActions, useAppointmentReminder, useFreeSlots } from "../hooks/useAgenda";
import type { AgendaService, Appointment, AppointmentStatus, Professional } from "../types";
import {
  STATUS_LABEL,
  formatDayLabel,
  formatDuration,
  formatTime,
  fromInputs,
  isActiveStatus,
  toDateInput,
  toTimeInput,
} from "../utils/calendar";
import { AgendaModal, FIELD_CLASS, LABEL_CLASS } from "./AgendaModal";

type PickedContact = { id: string; name: string | null; phone: string | null };

const STATUS_TONE: Record<AppointmentStatus, string> = {
  scheduled: "bg-blue-50 text-blue-700",
  confirmed: "bg-green-50 text-green-700",
  completed: "bg-slate-100 text-slate-700",
  no_show: "bg-amber-50 text-amber-700",
  cancelled: "bg-red-50 text-red-700",
};

const reminderText = (reminder: ReturnType<typeof useAppointmentReminder>) => {
  if (!reminder) return null;
  const when = new Date(reminder.scheduledAt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (reminder.recipientStatus === "sent") return `Lembrete enviado em ${when}.`;
  if (reminder.recipientStatus === "failed") return `O lembrete não saiu: ${reminder.error ?? "falha no envio"}`;
  if (reminder.status === "scheduled") return `Lembrete programado para ${when}.`;
  return null;
};

export const AppointmentModal: React.FC<{
  clinicId: string | null;
  professionals: Professional[];
  services: AgendaService[];
  appointment: Appointment | null;
  defaultStart?: Date | null;
  defaultProfessionalId?: string | null;
  presetContact?: PickedContact | null;
  canSeeReminder?: boolean;
  onClose: () => void;
}> = ({
  clinicId,
  professionals,
  services,
  appointment,
  defaultStart,
  defaultProfessionalId,
  presetContact,
  canSeeReminder = false,
  onClose,
}) => {
  const actions = useAgendaActions(clinicId);
  const editing = Boolean(appointment);
  const active = !appointment || isActiveStatus(appointment.status);

  const activeServices = services.filter((s) => s.active || s.id === appointment?.serviceId);
  const activeProfessionals = professionals.filter((p) => p.active || p.id === appointment?.professionalId);

  const initialStart = appointment ? new Date(appointment.startsAt) : defaultStart ?? null;
  const initialDuration = appointment
    ? Math.round((new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime()) / 60000)
    : activeServices[0]?.durationMinutes ?? 30;

  const [contact, setContact] = useState<PickedContact | null>(
    appointment
      ? { id: appointment.contactId, name: appointment.contactName, phone: appointment.contactPhone }
      : presetContact ?? null,
  );
  const [serviceId, setServiceId] = useState<string>(appointment?.serviceId ?? activeServices[0]?.id ?? "");
  const [professionalId, setProfessionalId] = useState<string>(
    appointment?.professionalId ??
      defaultProfessionalId ??
      activeProfessionals.find((p) => !serviceId || p.serviceIds.includes(serviceId))?.id ??
      activeProfessionals[0]?.id ??
      "",
  );
  const [date, setDate] = useState(initialStart ? toDateInput(initialStart) : toDateInput(new Date()));
  const [time, setTime] = useState(initialStart ? toTimeInput(initialStart) : "");
  const [duration, setDuration] = useState(initialDuration);
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const pickingContact = !appointment && !presetContact;
  const { contacts, loading: loadingContacts } = useWalletContactSearch(clinicId, debounced, pickingContact);

  const service = activeServices.find((s) => s.id === serviceId) ?? null;
  const professional = activeProfessionals.find((p) => p.id === professionalId) ?? null;
  const doesService = !service || !professional || professional.serviceIds.includes(service.id);

  const changeService = (id: string) => {
    setServiceId(id);
    const next = activeServices.find((s) => s.id === id);
    if (next) setDuration(next.durationMinutes);
    // Troca para quem faz o serviço, se o escolhido não faz
    if (next && professional && !professional.serviceIds.includes(next.id)) {
      const doer = activeProfessionals.find((p) => p.active && p.serviceIds.includes(next.id));
      if (doer) setProfessionalId(doer.id);
    }
  };

  const { slots, loading: loadingSlots } = useFreeSlots({
    clinicId,
    serviceId: serviceId || null,
    professionalId: professionalId || null,
    date,
    enabled: active,
  });
  const slotOptions = useMemo(() => slots.slice(0, 40), [slots]);

  const reminder = useAppointmentReminder(appointment?.id ?? null, canSeeReminder && editing);
  const reminderLine = reminderText(reminder);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!contact) return toast.error("Escolha o cliente.");
    if (!professionalId) return toast.error("Escolha o profissional.");
    const start = fromInputs(date, time);
    if (!start) return toast.error("Escolha o dia e a hora.");
    const minutes = Math.round(Number(duration));
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 720) {
      return toast.error("A duração precisa ficar entre 5 minutos e 12 horas.");
    }
    const end = new Date(start.getTime() + minutes * 60000);
    const input = {
      professionalId,
      serviceId: serviceId || null,
      contactId: contact.id,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      notes: notes.trim() || null,
    };
    try {
      if (appointment) {
        await actions.updateAppointment({ id: appointment.id, input });
        toast.success("Agendamento atualizado.");
      } else {
        await actions.createAppointment(input);
        toast.success("Horário marcado.");
      }
      onClose();
    } catch (err) {
      toast.error(agendaErrorMessage(err, "Não foi possível salvar o agendamento."));
    }
  };

  const changeStatus = async (status: AppointmentStatus, reason?: string) => {
    if (!appointment) return;
    try {
      await actions.setStatus({ id: appointment.id, status, reason });
      const messages: Record<AppointmentStatus, string> = {
        scheduled: "Agendamento reaberto.",
        confirmed: "Presença confirmada.",
        completed: "Marcado como atendido.",
        no_show: "Marcado como falta.",
        cancelled: "Horário cancelado.",
      };
      toast.success(messages[status]);
      onClose();
    } catch (err) {
      toast.error(agendaErrorMessage(err, "Não foi possível alterar o agendamento."));
    }
  };

  const title = appointment ? (active ? "Agendamento" : STATUS_LABEL[appointment.status]) : "Novo agendamento";
  const subtitle = appointment ? (
    <span className="flex flex-wrap items-center gap-2">
      <span>
        {formatDayLabel(new Date(appointment.startsAt))}, {formatTime(appointment.startsAt)} às{" "}
        {formatTime(appointment.endsAt)}
      </span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[appointment.status]}`}>
        {STATUS_LABEL[appointment.status]}
      </span>
      {appointment.source === "ai" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
          <SparklesIcon className="h-3 w-3" />
          Marcado pela IA
        </span>
      )}
    </span>
  ) : undefined;

  return (
    <AgendaModal title={title} subtitle={subtitle} onClose={onClose} width="max-w-xl">
      <form id="appointment-form" onSubmit={submit} className="space-y-4">
        <div>
          <span className={LABEL_CLASS}>Cliente</span>
          {!pickingContact ? (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-800">
              <span className="min-w-0">
                <span className="font-medium">
                  {recipientLabel({ name: contact?.name ?? null, phone: contact?.phone ?? "" })}
                </span>
                <span className="ml-2 text-xs text-slate-500">{formatPhone(contact?.phone ?? null)}</span>
              </span>
              {appointment?.conversationId && (
                <Link
                  to={`/inbox/chat/${appointment.conversationId}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                  <MessageCircleIcon className="h-3.5 w-3.5" />
                  Abrir conversa
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="relative mt-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar na carteira por nome ou telefone"
                  className={`${FIELD_CLASS} pl-9`}
                  aria-label="Buscar cliente"
                />
              </div>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
                {loadingContacts ? (
                  <p className="py-3 text-center text-xs text-slate-400">Carregando...</p>
                ) : contacts.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-400">Nenhum cliente encontrado.</p>
                ) : (
                  contacts.map((c) => {
                    const selected = contact?.id === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setContact(c)}
                        aria-pressed={selected}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                          selected ? "border-blue-200 bg-blue-50/60" : "border-transparent hover:bg-slate-50"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-800">{recipientLabel(c)}</span>
                          <span className="block truncate text-xs text-slate-500">{formatPhone(c.phone)}</span>
                        </span>
                        {selected && <CheckIcon className="h-4 w-4 flex-shrink-0 text-blue-600" />}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="appt-service" className={LABEL_CLASS}>
              Serviço
            </label>
            <select
              id="appt-service"
              value={serviceId}
              disabled={!active}
              onChange={(event) => changeService(event.target.value)}
              className={`${FIELD_CLASS} mt-1`}
            >
              <option value="">Sem serviço</option>
              {activeServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({formatDuration(s.durationMinutes)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="appt-professional" className={LABEL_CLASS}>
              Profissional
            </label>
            <select
              id="appt-professional"
              value={professionalId}
              disabled={!active}
              onChange={(event) => setProfessionalId(event.target.value)}
              className={`${FIELD_CLASS} mt-1`}
            >
              {activeProfessionals.length === 0 && <option value="">Cadastre um profissional</option>}
              {activeProfessionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {service && !p.serviceIds.includes(service.id) ? " (não faz este serviço)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!doesService && active && (
          <p className="-mt-2 text-xs text-amber-700">
            {professional?.name} não está cadastrado para este serviço. Dá para marcar assim mesmo.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="appt-date" className={LABEL_CLASS}>
              Dia
            </label>
            <input
              id="appt-date"
              type="date"
              value={date}
              disabled={!active}
              onChange={(event) => setDate(event.target.value)}
              className={`${FIELD_CLASS} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="appt-time" className={LABEL_CLASS}>
              Hora
            </label>
            <input
              id="appt-time"
              type="time"
              value={time}
              step={300}
              disabled={!active}
              onChange={(event) => setTime(event.target.value)}
              className={`${FIELD_CLASS} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="appt-duration" className={LABEL_CLASS}>
              Duração (min)
            </label>
            <input
              id="appt-duration"
              type="number"
              min={5}
              max={720}
              step={5}
              value={duration}
              disabled={!active}
              onChange={(event) => setDuration(Number(event.target.value))}
              className={`${FIELD_CLASS} mt-1`}
            />
          </div>
        </div>

        {active && serviceId && (
          <div>
            <p className="text-xs font-medium text-slate-600">
              Horários livres {professional ? `de ${professional.name}` : ""} neste dia
            </p>
            {loadingSlots ? (
              <p className="mt-2 text-xs text-slate-400">Procurando horários...</p>
            ) : slotOptions.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">
                Nenhum horário livre no expediente deste dia. Você ainda pode escolher a hora à mão.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {slotOptions.map((slot) => {
                  const value = formatTime(slot.startsAt);
                  const selected = value === time && slot.professionalId === professionalId;
                  return (
                    <button
                      key={`${slot.professionalId}-${slot.startsAt}`}
                      type="button"
                      onClick={() => {
                        setTime(value);
                        setProfessionalId(slot.professionalId);
                      }}
                      aria-pressed={selected}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                        selected
                          ? "border-blue-500 bg-blue-600 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700"
                      }`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div>
          <label htmlFor="appt-notes" className={LABEL_CLASS}>
            Observações <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <textarea
            id="appt-notes"
            rows={2}
            maxLength={1000}
            value={notes}
            disabled={!active}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ex.: primeira consulta, trazer exames"
            className={`${FIELD_CLASS} mt-1 resize-y`}
          />
        </div>

        {appointment?.status === "cancelled" && appointment.cancelReason && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Motivo: {appointment.cancelReason}</p>
        )}
        {reminderLine && (
          <p className="flex items-start gap-2 text-xs text-slate-500">
            <BellIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            {reminderLine}
          </p>
        )}
      </form>

      {appointment && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          {cancelling ? (
            <div className="space-y-2">
              <label htmlFor="appt-cancel-reason" className={LABEL_CLASS}>
                Motivo do cancelamento <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                id="appt-cancel-reason"
                type="text"
                autoFocus
                maxLength={300}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="Ex.: cliente pediu para remarcar"
                className={FIELD_CLASS}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setCancelling(false)}>
                  Voltar
                </Button>
                <Button
                  type="button"
                  disabled={actions.changingStatus}
                  onClick={() => changeStatus("cancelled", cancelReason)}
                  className="rounded-full bg-red-600 hover:bg-red-700"
                >
                  Cancelar horário
                </Button>
              </div>
            </div>
          ) : appointment.status === "cancelled" ? (
            <button
              type="button"
              onClick={() => changeStatus("scheduled")}
              disabled={actions.changingStatus}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-60"
            >
              <RotateCcwIcon className="h-4 w-4" />
              Reabrir agendamento
            </button>
          ) : (
            <div>
              <span className={LABEL_CLASS}>Situação</span>
              <div
                role="radiogroup"
                aria-label="Situação do agendamento"
                className="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 sm:grid-cols-4"
              >
                {STATUS_STEPS.map((step) => {
                  const current = appointment.status === step.status;
                  const Icon = step.icon;
                  return (
                    <button
                      key={step.status}
                      type="button"
                      role="radio"
                      aria-checked={current}
                      disabled={actions.changingStatus}
                      onClick={() => !current && changeStatus(step.status)}
                      className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-sm font-medium transition disabled:opacity-60 ${
                        current ? `${step.active} shadow-sm` : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                      }`}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      {step.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setCancelling(true)}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-600 transition hover:text-red-700 hover:underline"
              >
                <XCircleIcon className="h-4 w-4" />
                Cancelar horário
              </button>
            </div>
          )}
        </div>
      )}

      {active && !cancelling && (
        <div className="mt-5 flex justify-end gap-3">
          {/* Editando, fecha pelo X do cabeçalho */}
          {!editing && (
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          )}
          <Button type="submit" form="appointment-form" disabled={actions.savingAppointment} className="rounded-full">
            {actions.savingAppointment ? "Salvando..." : editing ? "Salvar alterações" : "Marcar horário"}
          </Button>
        </div>
      )}
    </AgendaModal>
  );
};

// Situação do horário, na ordem do atendimento (cancelar fica à parte)
const STATUS_STEPS: {
  status: AppointmentStatus;
  label: string;
  icon: React.ElementType<{ className?: string }>;
  active: string;
}[] = [
  { status: "scheduled", label: "Marcado", icon: ClockIcon, active: "bg-white text-blue-700" },
  { status: "confirmed", label: "Confirmado", icon: CheckCircle2Icon, active: "bg-green-600 text-white" },
  { status: "completed", label: "Atendido", icon: CheckIcon, active: "bg-slate-800 text-white" },
  { status: "no_show", label: "Faltou", icon: UserXIcon, active: "bg-amber-500 text-white" },
];
