import React, { useState } from "react";
import { InfoIcon } from "lucide-react";
import { toast } from "react-toastify";
import { FIELD_CLASS, LABEL_CLASS, LeadModal } from "../../leads/components/LeadModal";
import { useUpdateContact } from "../hooks/useContacts";
import type { Contact } from "../types/contacts";

const onlyDigits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");

/** Edita nome, telefone e e-mail do cliente (Carteira de clientes). */
export const EditContactModal: React.FC<{
  contact: Contact;
  onClose: () => void;
}> = ({ contact, onClose }) => {
  const { save, saving } = useUpdateContact();
  const [name, setName] = useState(contact.name ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");

  const phoneChanged = onlyDigits(phone) !== onlyDigits(contact.phone);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Informe o nome do cliente.");
      return;
    }
    try {
      await save({ contactId: contact.id, name, phone, email });
      toast.success("Cliente atualizado.");
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar o cliente.");
    }
  };

  return (
    <LeadModal title="Editar cliente" subtitle="As mudanças valem para toda a equipe." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="contact-edit-name" className={LABEL_CLASS}>
            Nome
          </label>
          <input
            id="contact-edit-name"
            autoFocus
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            className={`${FIELD_CLASS} mt-1.5`}
            placeholder="Nome do cliente"
          />
        </div>

        <div>
          <label htmlFor="contact-edit-phone" className={LABEL_CLASS}>
            Telefone (WhatsApp)
          </label>
          <input
            id="contact-edit-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            maxLength={25}
            onChange={(event) => setPhone(event.target.value)}
            className={`${FIELD_CLASS} mt-1.5`}
            placeholder="Ex.: (11) 98765-4321"
          />
          {phoneChanged && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              As próximas mensagens e agendamentos vão para o número novo. As conversas antigas continuam no
              histórico.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="contact-edit-email" className={LABEL_CLASS}>
            E-mail <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <input
            id="contact-edit-email"
            type="email"
            value={email}
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
            className={`${FIELD_CLASS} mt-1.5`}
            placeholder="cliente@email.com"
          />
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
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </LeadModal>
  );
};
