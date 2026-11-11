// deno-lint-ignore-file
// @ts-nocheck
// Helpers do start-conversation (sem dependência de Deno: testados no Vitest).

export const onlyDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

/**
 * Número digitado -> dígitos com DDI, ou null se não parecer um telefone.
 * DDD + número (10 ou 11 dígitos) é tratado como Brasil e recebe o 55.
 * Mesma regra do normalizeTypedPhone da tela de Campanhas.
 */
export const normalizeTypedPhone = (input: unknown): string | null => {
  const digits = onlyDigits(input).replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length === 12 || digits.length === 13) return digits;
  return null;
};

/**
 * O mesmo celular brasileiro com e sem o 9 da frente. O WhatsApp de alguns
 * DDDs ainda usa o número antigo (sem o 9), então o cliente pode já estar na
 * carteira de um jeito e ser digitado do outro.
 */
export const brazilianPhoneVariants = (phone: string): string[] => {
  const variants = new Set([phone]);
  if (phone.startsWith("55")) {
    const ddd = phone.slice(2, 4);
    const rest = phone.slice(4);
    if (rest.length === 9 && rest.startsWith("9")) variants.add(`55${ddd}${rest.slice(1)}`);
    if (rest.length === 8 && /^[6-9]/.test(rest)) variants.add(`55${ddd}9${rest}`);
  }
  return [...variants];
};

/** Nome sem nenhuma letra (contato criado pelo WhatsApp sem nome de perfil). */
export const isPlaceholderName = (name: unknown) => !/\p{L}/u.test(String(name ?? ""));

/**
 * Resposta do /chat/whatsappNumbers da Evolution -> número com WhatsApp
 * (só dígitos), false se o número não tem WhatsApp, null se não deu para saber.
 */
export const parseWhatsappNumbersResponse = (json: unknown): string | false | null => {
  const entry = Array.isArray(json) ? json[0] : null;
  if (!entry || typeof entry !== "object") return null;
  if (entry.exists === false) return false;
  const fromJid = onlyDigits(String(entry.jid ?? "").split("@")[0]);
  if (/^\d{10,13}$/.test(fromJid)) return fromJid;
  const fromNumber = onlyDigits(entry.number);
  if (/^\d{10,13}$/.test(fromNumber)) return fromNumber;
  return null;
};
