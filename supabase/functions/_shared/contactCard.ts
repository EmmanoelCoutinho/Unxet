/**
 * Contato compartilhado (vCard) no WhatsApp.
 *
 * O banco não tem um tipo de mensagem próprio para contato: tanto o envio
 * quanto o recebimento gravam como texto, no formato
 * "👤 Contato: Nome - +5511999999999" (o mesmo que o evolution-in já usa).
 */ export type SharedContact = {
  name: string;
  // só dígitos, com DDI
  phone: string;
};

const MAX_NAME_LENGTH = 100;

// Telefone em dígitos com DDI. Começando com "+", o DDI já veio junto;
// sem "+", número brasileiro sem o 55 (DDD + 8 ou 9 dígitos) ganha o DDI.
export function normalizeContactPhone(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  const digits = value.replace(/\D/g, "");
  if (value.startsWith("+")) {
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  }
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  // sem "+", só número brasileiro (já com o 55)
  return /^55\d{10,11}$/.test(digits) ? digits : null;
}

export function parseSharedContact(raw: unknown): SharedContact | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const name = String(obj.name ?? "").trim().slice(0, MAX_NAME_LENGTH);
  const phone = normalizeContactPhone(obj.phone);
  if (!name || !phone) return null;
  return {
    name,
    phone
  };
}

export function formatContactText(contacts: Array<{
  name?: string | null;
  phone?: string | null;
}>): string {
  return contacts.map((c)=>{
    const name = String(c?.name ?? "").trim() || "sem nome";
    const phone = String(c?.phone ?? "").trim();
    return `👤 Contato: ${name}` + (phone ? ` - ${phone}` : "");
  }).join("\n") || "👤 Contato compartilhado";
}

export function sharedContactText(contact: SharedContact): string {
  return formatContactText([
    {
      name: contact.name,
      phone: `+${contact.phone}`
    }
  ]);
}

// Corpo do POST /message/sendContact/{instância} da Evolution
export function toEvolutionContact(contact: SharedContact) {
  return {
    fullName: contact.name,
    wuid: contact.phone,
    phoneNumber: `+${contact.phone}`
  };
}

// Item de "contacts" da Cloud API (formatted_name + ao menos um campo de nome)
export function toMetaContact(contact: SharedContact) {
  const [firstName, ...rest] = contact.name.split(/\s+/);
  return {
    name: {
      formatted_name: contact.name,
      first_name: firstName,
      ...rest.length ? {
        last_name: rest.join(" ")
      } : {}
    },
    phones: [
      {
        phone: `+${contact.phone}`,
        wa_id: contact.phone,
        type: "CELL"
      }
    ]
  };
}

// Texto de uma mensagem "contacts" recebida pela Cloud API
export function metaContactsText(message: any): string {
  const contacts = Array.isArray(message?.contacts) ? message.contacts : [];
  return formatContactText(contacts.map((c: any)=>{
    const phones = Array.isArray(c?.phones) ? c.phones : [];
    const first = phones.find((p: any)=>p?.phone || p?.wa_id);
    return {
      name: c?.name?.formatted_name ?? [
        c?.name?.first_name,
        c?.name?.last_name
      ].filter(Boolean).join(" "),
      phone: first?.phone ?? (first?.wa_id ? `+${first.wa_id}` : "")
    };
  }));
}
