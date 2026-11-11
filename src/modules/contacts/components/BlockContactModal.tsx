import React, { useState } from "react";
import { toast } from "react-toastify";
import { FIELD_CLASS, LABEL_CLASS, LeadModal } from "../../leads/components/LeadModal";
import { BLOCK_REASON_MAX_LENGTH, blockContact } from "../api/blocking";

/**
 * Bloqueia um contato. Com `contactId`, o cliente da conversa/carteira; sem
 * ele, pede um número (bloqueia até quem ainda não escreveu).
 */
export const BlockContactModal: React.FC<{
  contactId?: string;
  contactName?: string;
  onClose: () => void;
  onBlocked?: (contactId: string) => void;
}> = ({ contactId, contactName, onClose, onBlocked }) => {
  const byNumber = !contactId;
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (byNumber && phone.replace(/\D/g, "").length < 10) {
      toast.error("Informe o telefone com DDD.");
      return;
    }
    setSaving(true);
    try {
      const id = await blockContact({ contactId, phone, name, reason });
      toast.success("Contato bloqueado.");
      onBlocked?.(id);
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível bloquear o contato.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <LeadModal
      title={byNumber ? "Bloquear número" : "Bloquear contato"}
      subtitle={
        byNumber
          ? "Vale para todos os números de WhatsApp da empresa."
          : contactName
            ? `${contactName} não vai mais conseguir falar com a empresa.`
            : undefined
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        {byNumber && (
          <>
            <div>
              <label htmlFor="block-phone" className={LABEL_CLASS}>
                Telefone (WhatsApp)
              </label>
              <input
                id="block-phone"
                autoFocus
                type="tel"
                inputMode="tel"
                value={phone}
                maxLength={25}
                onChange={(event) => setPhone(event.target.value)}
                className={`${FIELD_CLASS} mt-1.5`}
                placeholder="Ex.: (11) 98765-4321"
              />
            </div>
            <div>
              <label htmlFor="block-name" className={LABEL_CLASS}>
                Nome <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                id="block-name"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                className={`${FIELD_CLASS} mt-1.5`}
                placeholder="Para você reconhecer na lista"
              />
            </div>
          </>
        )}

        <div>
          <label htmlFor="block-reason" className={LABEL_CLASS}>
            Motivo <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <textarea
            id="block-reason"
            autoFocus={!byNumber}
            value={reason}
            rows={2}
            maxLength={BLOCK_REASON_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
            className={`${FIELD_CLASS} mt-1.5 resize-none`}
            placeholder="Ex.: spam, ofensas, número de propaganda"
          />
        </div>

        <ul className="list-disc space-y-1 rounded-lg bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-800">
          <li>As mensagens dele deixam de chegar: não abrem conversa, não acionam bot nem IA.</li>
          <li>A empresa também não envia para ele (conversas, campanhas e agendamentos).</li>
          <li>Conversas abertas ou na fila são finalizadas, sem pesquisa de satisfação.</li>
          <li>O contato não é avisado e o histórico continua guardado.</li>
        </ul>

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
            className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
          >
            {saving ? "Bloqueando..." : "Bloquear"}
          </button>
        </div>
      </form>
    </LeadModal>
  );
};
