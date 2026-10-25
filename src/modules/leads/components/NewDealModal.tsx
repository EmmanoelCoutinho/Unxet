import React, { useEffect, useMemo, useState } from "react";
import { CheckIcon, SearchIcon } from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "../../../components/ui/Button";
import { useWalletContactSearch } from "../../scheduledMessages/hooks/useScheduledMessages";
import { formatPhone, parseMoneyInput, recipientLabel } from "../../scheduledMessages/utils/schedule";
import { useLeadActions } from "../hooks/useLeads";
import type { DealSource, Pipeline } from "../types/leads";
import { FIELD_CLASS, LABEL_CLASS, LeadModal } from "./LeadModal";

export type OwnerOption = { id: string | null; label: string };

type PickedContact = { id: string; name: string | null; phone: string | null };

export const NewDealModal: React.FC<{
  clinicId: string | null;
  pipeline: Pipeline;
  defaultStageId?: string;
  // Vindo da conversa: cliente já escolhido
  presetContact?: PickedContact;
  source?: DealSource;
  sourceConversationId?: string | null;
  ownerOptions: OwnerOption[];
  defaultOwnerId: string | null;
  topPositionFor: (stageId: string) => number;
  onClose: () => void;
  onCreated: (dealId: string) => void;
}> = ({
  clinicId,
  pipeline,
  defaultStageId,
  presetContact,
  source = "manual",
  sourceConversationId = null,
  ownerOptions,
  defaultOwnerId,
  topPositionFor,
  onClose,
  onCreated,
}) => {
  const { createDeal, creating } = useLeadActions();
  const openStages = pipeline.stages.filter((s) => s.kind === "open");
  const [contact, setContact] = useState<PickedContact | null>(presetContact ?? null);
  const [title, setTitle] = useState(
    presetContact ? recipientLabel({ name: presetContact.name, phone: presetContact.phone ?? "" }) : "",
  );
  const [titleTouched, setTitleTouched] = useState(false);
  const [value, setValue] = useState("");
  const [stageId, setStageId] = useState(defaultStageId ?? openStages[0]?.id ?? "");
  const [ownerId, setOwnerId] = useState<string | null>(defaultOwnerId);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { contacts, loading } = useWalletContactSearch(clinicId, debounced, !presetContact);

  const pick = (picked: PickedContact) => {
    setContact(picked);
    // Título sugerido = nome do cliente, enquanto a pessoa não mexer nele
    if (!titleTouched) setTitle(recipientLabel({ name: picked.name, phone: picked.phone ?? "" }));
  };

  const stageOptions = useMemo(() => pipeline.stages, [pipeline.stages]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!contact) {
      toast.error("Escolha o cliente.");
      return;
    }
    if (!title.trim()) {
      toast.error("Dê um título para a negociação.");
      return;
    }
    const parsed = parseMoneyInput(value);
    if (parsed !== null && Number.isNaN(parsed)) {
      toast.error("Valor inválido. Ex.: 150 ou 1.500,00");
      return;
    }
    try {
      const id = await createDeal({
        stageId,
        contactId: contact.id,
        title,
        value: parsed,
        ownerUserId: ownerId,
        source,
        sourceConversationId,
        position: topPositionFor(stageId),
      });
      toast.success("Negociação criada.");
      onCreated(id);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível criar a negociação.");
    }
  };

  return (
    <LeadModal title="Nova negociação" subtitle={pipeline.name} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <span className={LABEL_CLASS}>Cliente</span>
          {presetContact ? (
            <p className="mt-1 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-800">
              {recipientLabel({ name: presetContact.name, phone: presetContact.phone ?? "" })}
              <span className="ml-2 text-xs text-slate-500">{formatPhone(presetContact.phone)}</span>
            </p>
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
              <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
                {loading ? (
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
                        onClick={() => pick(c)}
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

        <div>
          <label htmlFor="deal-title" className={LABEL_CLASS}>
            Título
          </label>
          <input
            id="deal-title"
            type="text"
            value={title}
            maxLength={120}
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleTouched(true);
            }}
            placeholder="Ex.: Ana - clareamento"
            className={`${FIELD_CLASS} mt-1`}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="deal-value" className={LABEL_CLASS}>
              Valor <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="deal-value"
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="R$ 0,00"
              className={`${FIELD_CLASS} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="deal-stage" className={LABEL_CLASS}>
              Etapa
            </label>
            <select
              id="deal-stage"
              value={stageId}
              onChange={(event) => setStageId(event.target.value)}
              className={`${FIELD_CLASS} mt-1`}
            >
              {stageOptions.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="deal-owner" className={LABEL_CLASS}>
            Responsável
          </label>
          <select
            id="deal-owner"
            value={ownerId ?? ""}
            onChange={(event) => setOwnerId(event.target.value || null)}
            className={`${FIELD_CLASS} mt-1`}
          >
            {ownerOptions.map((option) => (
              <option key={option.id ?? "none"} value={option.id ?? ""}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={creating} className="rounded-full">
            {creating ? "Criando..." : "Criar negociação"}
          </Button>
        </div>
      </form>
    </LeadModal>
  );
};
