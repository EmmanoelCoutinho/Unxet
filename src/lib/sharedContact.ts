// Contato (vCard) enviado no chat do WhatsApp. Mesmas regras de
// supabase/functions/_shared/contactCard.ts: a edge function valida de novo
// e grava a mensagem como texto neste formato.

export type SharedContact = {
  name: string;
  // só dígitos, com DDI
  phone: string;
};

const MAX_NAME_LENGTH = 100;

// Começando com "+", o DDI já veio junto; sem "+", número brasileiro sem
// o 55 (DDD + 8 ou 9 dígitos) ganha o DDI
export function normalizeContactPhone(raw: string): string | null {
  const value = raw.trim();
  const digits = value.replace(/\D/g, "");
  if (value.startsWith("+")) {
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  }
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  // sem "+", só número brasileiro (já com o 55)
  return /^55\d{10,11}$/.test(digits) ? digits : null;
}

export function buildSharedContact(
  name: string,
  phone: string,
): SharedContact | null {
  const cleanName = name.trim().slice(0, MAX_NAME_LENGTH);
  const cleanPhone = normalizeContactPhone(phone);
  if (!cleanName || !cleanPhone) return null;
  return { name: cleanName, phone: cleanPhone };
}

export function sharedContactText(contact: SharedContact): string {
  return `👤 Contato: ${contact.name} - +${contact.phone}`;
}
