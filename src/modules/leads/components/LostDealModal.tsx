import React, { useState } from "react";
import { toast } from "react-toastify";
import { Button } from "../../../components/ui/Button";
import type { LossReason } from "../types/leads";
import { FIELD_CLASS, LABEL_CLASS, LeadModal } from "./LeadModal";

/** Pede o motivo antes de mover a negociação para uma etapa de perda. */
export const LostDealModal: React.FC<{
  dealTitle: string;
  reasons: LossReason[];
  onClose: () => void;
  onConfirm: (reasonId: string, note: string | null) => Promise<void> | void;
}> = ({ dealTitle, reasons, onClose, onConfirm }) => {
  const active = reasons.filter((r) => !r.archivedAt);
  const [reasonId, setReasonId] = useState(active[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reasonId) {
      toast.error("Escolha o motivo.");
      return;
    }
    setSaving(true);
    try {
      await onConfirm(reasonId, note.trim() || null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <LeadModal title="Marcar como perdida" subtitle={dealTitle} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <span className={LABEL_CLASS}>Por que não fechou?</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {active.map((reason) => (
              <button
                key={reason.id}
                type="button"
                onClick={() => setReasonId(reason.id)}
                aria-pressed={reasonId === reason.id}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  reasonId === reason.id
                    ? "border-red-300 bg-red-50 text-red-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {reason.name}
              </button>
            ))}
            {active.length === 0 && (
              <p className="text-sm text-slate-500">
                Nenhum motivo cadastrado. O administrador cadastra em "Configurar funil".
              </p>
            )}
          </div>
        </div>
        <div>
          <label htmlFor="lost-note" className={LABEL_CLASS}>
            Observação <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <textarea
            id="lost-note"
            value={note}
            maxLength={500}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ex.: achou o valor alto, pediu para falar de novo em março"
            className={`${FIELD_CLASS} mt-1 resize-none`}
          />
        </div>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button
            type="submit"
            disabled={saving || active.length === 0}
            className="rounded-full bg-red-600 hover:bg-red-700"
          >
            {saving ? "Salvando..." : "Marcar como perdida"}
          </Button>
        </div>
      </form>
    </LeadModal>
  );
};
