import React, { useMemo, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "../../../components/ui/Button";
import { Toggle } from "../../../components/ui/Toggle";
import { agendaErrorMessage } from "../api/agenda";
import { useAgendaActions, useTimeOff } from "../hooks/useAgenda";
import type { AgendaService, Professional, WorkingHour } from "../types";
import {
  PROFESSIONAL_COLORS,
  WEEKDAY_LONG,
  addDays,
  defaultHours,
  fromInputs,
  startOfDay,
  toDateInput,
  validateHours,
} from "../utils/calendar";
import { AgendaModal, FIELD_CLASS, LABEL_CLASS } from "./AgendaModal";

// Segunda primeiro, domingo no fim
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const ProfessionalModal: React.FC<{
  clinicId: string | null;
  professional: Professional | null;
  services: AgendaService[];
  users: { id: string; label: string }[];
  nextPosition: number;
  usedColors: string[];
  onClose: () => void;
}> = ({ clinicId, professional, services, users, nextPosition, usedColors, onClose }) => {
  const actions = useAgendaActions(clinicId);
  const [name, setName] = useState(professional?.name ?? "");
  const [specialty, setSpecialty] = useState(professional?.specialty ?? "");
  const [color, setColor] = useState(
    professional?.color ?? PROFESSIONAL_COLORS.find((c) => !usedColors.includes(c)) ?? PROFESSIONAL_COLORS[0],
  );
  const [userId, setUserId] = useState<string>(professional?.userId ?? "");
  const [active, setActive] = useState(professional?.active ?? true);
  const [serviceIds, setServiceIds] = useState<string[]>(
    professional?.serviceIds ?? services.filter((s) => s.active).map((s) => s.id),
  );
  const [hours, setHours] = useState<WorkingHour[]>(professional?.hours ?? defaultHours());

  const toggleService = (id: string) =>
    setServiceIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const setDay = (weekday: number, on: boolean) =>
    setHours((list) =>
      on
        ? [...list, { weekday, start: "08:00", end: "18:00" }]
        : list.filter((h) => h.weekday !== weekday),
    );

  const updateRange = (index: number, patch: Partial<WorkingHour>) =>
    setHours((list) => list.map((h, i) => (i === index ? { ...h, ...patch } : h)));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!clinicId) return;
    if (!name.trim()) return toast.error("Escreva o nome do profissional.");
    const hoursError = validateHours(hours);
    if (hoursError) return toast.error(hoursError);
    try {
      await actions.saveProfessional({
        id: professional?.id ?? null,
        position: professional?.position ?? nextPosition,
        input: {
          name,
          specialty: specialty || null,
          color,
          userId: userId || null,
          active,
          serviceIds,
          hours,
        },
      });
      toast.success(professional ? "Profissional atualizado." : "Profissional cadastrado.");
      onClose();
    } catch (err) {
      toast.error(agendaErrorMessage(err, "Não foi possível salvar o profissional."));
    }
  };

  return (
    <AgendaModal
      title={professional ? "Editar profissional" : "Novo profissional"}
      subtitle="Quem atende e em quais horários. Não precisa ter acesso ao Unxet."
      onClose={onClose}
      width="max-w-2xl"
    >
      <form id="professional-form" onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="pro-name" className={LABEL_CLASS}>
              Nome
            </label>
            <input
              id="pro-name"
              type="text"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Dra. Ana Souza"
              className={`${FIELD_CLASS} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="pro-specialty" className={LABEL_CLASS}>
              Especialidade ou função <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="pro-specialty"
              type="text"
              maxLength={80}
              value={specialty}
              onChange={(event) => setSpecialty(event.target.value)}
              placeholder="Ex.: Dermatologista"
              className={`${FIELD_CLASS} mt-1`}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className={LABEL_CLASS}>Cor na agenda</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {PROFESSIONAL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Cor ${c}`}
                  aria-pressed={color === c}
                  className={`h-7 w-7 rounded-full border-2 transition ${
                    color === c ? "border-slate-900 ring-2 ring-slate-200" : "border-white"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="pro-user" className={LABEL_CLASS}>
              Atendente ligado <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <select
              id="pro-user"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              className={`${FIELD_CLASS} mt-1`}
            >
              <option value="">Nenhum</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <span className={LABEL_CLASS}>Serviços que faz</span>
          {services.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">Cadastre os serviços na aba Serviços e volte aqui.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {services
                .filter((s) => s.active || serviceIds.includes(s.id))
                .map((s) => {
                  const on = serviceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleService(s.id)}
                      aria-pressed={on}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                        on
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {s.name}
                    </button>
                  );
                })}
            </div>
          )}
        </div>

        <div>
          <span className={LABEL_CLASS}>Horários de trabalho</span>
          <p className="mt-0.5 text-xs text-slate-500">
            A IA só oferece horários dentro destas faixas. Use duas faixas para ter intervalo de almoço.
          </p>
          <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {WEEK_ORDER.map((weekday) => {
              const ranges = hours
                .map((h, index) => ({ h, index }))
                .filter(({ h }) => h.weekday === weekday);
              const on = ranges.length > 0;
              return (
                <div key={weekday} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <label className="flex w-36 items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(event) => setDay(weekday, event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {WEEKDAY_LONG[weekday]}
                  </label>
                  {on ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      {ranges.map(({ h, index }) => (
                        <span key={index} className="inline-flex items-center gap-1">
                          <input
                            type="time"
                            value={h.start}
                            onChange={(event) => updateRange(index, { start: event.target.value })}
                            aria-label={`${WEEKDAY_LONG[weekday]}: início`}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                          />
                          <span className="text-xs text-slate-400">às</span>
                          <input
                            type="time"
                            value={h.end}
                            onChange={(event) => updateRange(index, { end: event.target.value })}
                            aria-label={`${WEEKDAY_LONG[weekday]}: fim`}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                          />
                          {ranges.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setHours((list) => list.filter((_, i) => i !== index))}
                              className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              aria-label="Remover faixa"
                            >
                              <Trash2Icon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </span>
                      ))}
                      {ranges.length < 3 && (
                        <button
                          type="button"
                          onClick={() => setHours((list) => [...list, { weekday, start: "13:00", end: "18:00" }])}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                        >
                          <PlusIcon className="h-3 w-3" />
                          Faixa
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Não atende</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Toggle
          checked={active}
          onChange={setActive}
          label="Atende pela agenda"
          helper="Desligado, some da agenda e a IA não marca com este profissional. Os horários já marcados continuam."
        />
      </form>

      {professional && <TimeOffSection clinicId={clinicId} professionalId={professional.id} />}

      <div className="mt-5 flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" form="professional-form" disabled={actions.savingProfessional} className="rounded-full">
          {actions.savingProfessional ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </AgendaModal>
  );
};

/** Folgas, férias e bloqueios do profissional (próximos 12 meses). */
const TimeOffSection: React.FC<{ clinicId: string | null; professionalId: string }> = ({
  clinicId,
  professionalId,
}) => {
  const actions = useAgendaActions(clinicId);
  const range = useMemo(() => {
    const from = startOfDay(new Date());
    return { from, to: addDays(from, 366) };
  }, []);
  const { timeOff } = useTimeOff(clinicId, range.from, range.to);
  const mine = timeOff.filter((t) => t.professionalId === professionalId);

  const today = toDateInput(new Date());
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState(today);
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    // Sem hora = o dia inteiro
    const start = fromInputs(startDate, startTime || "00:00");
    const end = endTime ? fromInputs(endDate, endTime) : fromInputs(toDateInput(addDays(new Date(`${endDate}T00:00`), 1)), "00:00");
    if (!start || !end) return toast.error("Escolha o início e o fim.");
    if (end <= start) return toast.error("O fim precisa ser depois do início.");
    setSaving(true);
    try {
      await actions.createTimeOff({
        professionalId,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        reason: reason || null,
      });
      setReason("");
      setStartTime("");
      setEndTime("");
      toast.success("Bloqueio adicionado.");
    } catch (err) {
      toast.error(agendaErrorMessage(err, "Não foi possível adicionar o bloqueio."));
    } finally {
      setSaving(false);
    }
  };

  const formatRange = (startsAt: string, endsAt: string) => {
    const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };
    return `${new Date(startsAt).toLocaleString("pt-BR", opts)} até ${new Date(endsAt).toLocaleString("pt-BR", opts)}`;
  };

  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <span className={LABEL_CLASS}>Folgas e bloqueios</span>
      <p className="mt-0.5 text-xs text-slate-500">
        Férias, feriados ou um horário que ficou indisponível. Sem hora, vale o dia inteiro. Agendamentos já marcados
        no período não são cancelados.
      </p>
      {mine.length > 0 && (
        <ul className="mt-2 space-y-1">
          {mine.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
              <span className="min-w-0 truncate text-slate-700">
                {formatRange(t.startsAt, t.endsAt)}
                {t.reason ? ` · ${t.reason}` : ""}
              </span>
              <button
                type="button"
                onClick={() => actions.deleteTimeOff(t.id).catch(() => toast.error("Não foi possível remover."))}
                className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Remover bloqueio"
              >
                <Trash2Icon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Início: dia" className={FIELD_CLASS} />
        <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label="Início: hora" className={FIELD_CLASS} />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="Fim: dia" className={FIELD_CLASS} />
        <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="Fim: hora" className={FIELD_CLASS} />
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={reason}
          maxLength={120}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (opcional): Férias, Congresso..."
          className={FIELD_CLASS}
        />
        <Button type="button" variant="ghost" onClick={add} disabled={saving} className="flex-shrink-0 border border-slate-200">
          Adicionar
        </Button>
      </div>
    </div>
  );
};
