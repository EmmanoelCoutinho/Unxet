// Como mostrar um número de WhatsApp conectado (Integrações, atendimento,
// bots e mensagens programadas).

export type WhatsappConnectionLabelSource = {
  display_name?: string | null;
  connected_phone?: string | null;
  connected_name?: string | null;
};

/** "5511987654321@s.whatsapp.net" → "+55 (11) 98765-4321". */
export const formatConnectionPhone = (value?: string | null) => {
  const rawValue = value?.trim();
  if (!rawValue) return null;

  const identifier = rawValue.includes("@")
    ? rawValue.split("@")[0].trim()
    : rawValue;
  const digits = identifier.replace(/\D/g, "");

  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return identifier || null;
};

/** Apelido do número; sem apelido, o telefone; sem telefone, o nome do perfil. */
export const whatsappConnectionLabel = (
  connection?: WhatsappConnectionLabelSource | null,
  fallback = "WhatsApp",
) => {
  const displayName = connection?.display_name?.trim();
  if (displayName) return displayName;

  const phone = formatConnectionPhone(connection?.connected_phone);
  if (phone) return phone;

  const profileName = connection?.connected_name?.trim();
  if (profileName) return profileName;

  return fallback;
};
