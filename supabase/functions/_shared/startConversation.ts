// deno-lint-ignore-file
// @ts-nocheck
// Helpers do start-conversation (sem dependência de Deno: testados no Vitest).

export const onlyDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

/**
 * Número digitado -> dígitos com DDI, ou null se não parecer um telefone.
 *  - Começou com + : já vem com o código do país (8 a 15 dígitos).
 *  - DDD + número (10 dígitos, ou 11 com o 9 do celular) é Brasil e recebe o 55.
 *  - 11 dígitos sem o 9 depois do DDD não é celular brasileiro: é número de
 *    outro país com o código na frente (ex.: França 33 7 45 51 36 37).
 *  - 12 ou 13 dígitos: já vem com o código do país.
 */
export const normalizeTypedPhone = (input: unknown): string | null => {
  const raw = String(input ?? "").trim();
  const digits = onlyDigits(raw).replace(/^0+/, "");
  if (raw.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? digits : null;
  if (digits.length === 10) return `55${digits}`;
  if (digits.length === 11) return digits[2] === "9" ? `55${digits}` : digits;
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

/**
 * Entre os contatos achados pelas duas formas do número, fica o que tem o
 * telefone exatamente igual; sem ele, o mais antigo (o da carteira).
 */
export const pickContactByPhone = (rows: any[] | null | undefined, phone: string) => {
  const list = rows ?? [];
  return list.find((row) => row?.phone === phone) ?? list[0] ?? null;
};

/**
 * Contato da empresa por telefone, aceitando o celular brasileiro com e sem
 * o 9. Sem isso, o cliente salvo com o 9 que responde pelo número antigo
 * (sem o 9) virava um contato novo, com a conversa separada do histórico.
 * Devolve { contact, error }.
 */
export async function findContactByPhone(supabase, clinicId: string, phone: string, columns = "*") {
  const { data, error } = await supabase
    .from("contacts")
    .select(columns)
    .eq("clinic_id", clinicId)
    .in("phone", brazilianPhoneVariants(phone))
    .order("created_at", { ascending: true })
    .limit(10);
  return { contact: error ? null : pickContactByPhone(data, phone), error };
}

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
  if (/^\d{8,15}$/.test(fromJid)) return fromJid;
  const fromNumber = onlyDigits(entry.number);
  if (/^\d{8,15}$/.test(fromNumber)) return fromNumber;
  return null;
};
