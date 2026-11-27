import React, { useState } from "react";
import { toast } from "react-toastify";
import { Button } from "../../../components/ui/Button";
import { Toggle } from "../../../components/ui/Toggle";
import { parseMoneyInput } from "../../scheduledMessages/utils/schedule";
import { agendaErrorMessage } from "../api/agenda";
import { useAgendaActions } from "../hooks/useAgenda";
import type { AgendaService, Professional } from "../types";
import { formatDuration } from "../utils/calendar";
import { AgendaModal, FIELD_CLASS, LABEL_CLASS } from "./AgendaModal";

const DURATIONS = [10, 15, 20, 30, 40, 45, 50, 60, 75, 90, 120, 150, 180, 240];

const priceText = (value: number | null) =>
  value === null ? "" : value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ServiceModal: React.FC<{
  clinicId: string | null;
  service: AgendaService | null;
  professionals: Professional[];
  nextPosition: number;
  onClose: () => void;
}> = ({ clinicId, service, professionals, nextPosition, onClose }) => {
  const actions = useAgendaActions(clinicId);
  const [name, setName] = useState(service?.name ?? "");
  const [duration, setDuration] = useState(service?.durationMinutes ?? 30);
  const [price, setPrice] = useState(priceText(service?.price ?? null));
  const [description, setDescription] = useState(service?.description ?? "");
  const [active, setActive] = useState(service?.active ?? true);
  const [professionalIds, setProfessionalIds] = useState<string[]>(
    service
      ? professionals.filter((p) => p.serviceIds.includes(service.id)).map((p) => p.id)
      : professionals.filter((p) => p.active).map((p) => p.id),
  );

  const durations = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b);

  const toggle = (id: string) =>
    setProfessionalIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return toast.error("Escreva o nome do serviço.");
    const parsed = parseMoneyInput(price);
    if (parsed !== null && Number.isNaN(parsed)) return toast.error("Preço inválido. Ex.: 150 ou 1.500,00");
    try {
      await actions.saveService({
        id: service?.id ?? null,
        position: service?.position ?? nextPosition,
        input: {
          name,
          durationMinutes: duration,
          price: parsed,
          description: description || null,
          active,
          professionalIds,
        },
      });
      toast.success(service ? "Serviço atualizado." : "Serviço cadastrado.");
      onClose();
    } catch (err) {
      toast.error(agendaErrorMessage(err, "Não foi possível salvar o serviço."));
    }
  };

  return (
    <AgendaModal
      title={service ? "Editar serviço" : "Novo serviço"}
      subtitle="O que o cliente marca. A duração define o tamanho do horário."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="svc-name" className={LABEL_CLASS}>
            Nome
          </label>
          <input
            id="svc-name"
            type="text"
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Consulta"
            className={`${FIELD_CLASS} mt-1`}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="svc-duration" className={LABEL_CLASS}>
              Duração
            </label>
            <select
              id="svc-duration"
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
              className={`${FIELD_CLASS} mt-1`}
            >
              {durations.map((d) => (
                <option key={d} value={d}>
                  {formatDuration(d)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="svc-price" className={LABEL_CLASS}>
              Preço <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="svc-price"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="R$ 0,00"
              className={`${FIELD_CLASS} mt-1`}
            />
          </div>
        </div>
        <div>
          <label htmlFor="svc-description" className={LABEL_CLASS}>
            Descrição para a IA <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <textarea
            id="svc-description"
            rows={2}
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ex.: Primeira consulta, inclui avaliação. Trazer exames recentes."
            className={`${FIELD_CLASS} mt-1 resize-y`}
          />
          <p className="mt-1 text-xs text-slate-500">Com preço, a IA pode informar o valor ao cliente.</p>
        </div>
        <div>
          <span className={LABEL_CLASS}>Quem faz</span>
          {professionals.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">Cadastre os profissionais na aba Profissionais.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {professionals
                .filter((p) => p.active || professionalIds.includes(p.id))
                .map((p) => {
                  const on = professionalIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggle(p.id)}
                      aria-pressed={on}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                        on
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                      {p.name}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
        <Toggle
          checked={active}
          onChange={setActive}
          label="Disponível para marcar"
          helper="Desligado, a IA não oferece este serviço."
        />
        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={actions.savingService} className="rounded-full">
            {actions.savingService ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </form>
    </AgendaModal>
  );
};
