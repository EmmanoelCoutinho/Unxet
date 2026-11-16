import React, { useMemo, useState } from "react";
import { InfoIcon } from "lucide-react";
import { toast } from "react-toastify";
import { FIELD_CLASS, LABEL_CLASS, LeadModal } from "../../leads/components/LeadModal";
import { useUpdateContact } from "../hooks/useContacts";
import type { Contact } from "../types/contacts";
import { buildCountryPhone, DEFAULT_COUNTRY, splitCountryPhone } from "../utils/countryPhone";
import { CountryPhoneInput } from "./CountryPhoneInput";

const onlyDigits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");

/** Edita nome, telefone e e-mail do cliente (Carteira de clientes). */
export const EditContactModal: React.FC<{
  contact: Contact;
  onClose: () => void;
}> = ({ contact, onClose }) => {
  const { save, saving } = useUpdateContact();
  const [name, setName] = useState(contact.name ?? "");
  // Abre no país do número salvo, com o número local no campo
  const initial = useMemo(() => splitCountryPhone(contact.phone), [contact.phone]);
  const [country, setCountry] = useState(initial.iso);
  const [phone, setPhone] = useState(initial.local);
  const [email, setEmail] = useState(contact.email ?? "");

  const hasPhone = onlyDigits(phone) !== "";
  const fullPhone = hasPhone ? buildCountryPhone(phone, country) : null;
  const phoneChanged = hasPhone && fullPhone !== onlyDigits(contact.phone);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Informe o nome do cliente.");
      return;
    }
    if (hasPhone && !fullPhone) {
      toast.error(
        country === DEFAULT_COUNTRY
          ? "Telefone inválido. Use DDD + número, por exemplo (11) 98765-4321. Cliente de outro país? Troque o país ao lado."
          : "Telefone inválido. Confira o número do cliente.",
      );
      return;
    }
    try {
      // Com o +, o banco não confunde o código do país com DDD
      await save({ contactId: contact.id, name, phone: fullPhone ? `+${fullPhone}` : "", email });
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
          <CountryPhoneInput
            id="contact-edit-phone"
            country={country}
            onCountryChange={setCountry}
            value={phone}
            onChange={setPhone}
            className="mt-1.5"
          />
          <p className="mt-1 text-xs text-slate-500">
            {country === DEFAULT_COUNTRY
              ? "DDD + número. Cliente de outro país? Troque o país ao lado."
              : "Só o número, sem o código do país."}
          </p>
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
