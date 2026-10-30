// Contas extras do onboarding: além do primeiro administrador, a empresa já
// nasce com as outras contas pedidas pelo cliente. O total respeita o limite
// de atendentes do plano (o servidor e o banco conferem de novo).

export type ExtraAccountRole = "admin" | "agent";

export type ExtraAccountDraft = {
  key: string;
  name: string;
  email: string;
  role: ExtraAccountRole;
};

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Quantas contas extras ainda cabem no plano. null = ilimitado.
export const remainingExtraSlots = (
  maxAttendants: number | null,
  extraCount: number,
) => (maxAttendants === null ? null : Math.max(0, maxAttendants - 1 - extraCount));

// Primeiro problema encontrado na lista, ou null se está tudo certo
export const validateExtraAccounts = (
  firstEmail: string,
  extras: Pick<ExtraAccountDraft, "name" | "email">[],
  plan: { name: string; max_attendants: number | null } | null,
): string | null => {
  if (plan?.max_attendants != null && 1 + extras.length > plan.max_attendants) {
    return `O plano ${plan.name} permite até ${plan.max_attendants} contas, contando o primeiro usuário. Remova ${1 + extras.length - plan.max_attendants} ou escolha outro plano.`;
  }

  const seen = new Set([firstEmail.trim().toLowerCase()]);
  for (const [index, extra] of extras.entries()) {
    const label = `Conta ${index + 2}`;
    const email = extra.email.trim().toLowerCase();
    if (!extra.name.trim()) return `${label}: informe o nome.`;
    if (!isValidEmail(email)) return `${label}: informe um e-mail válido.`;
    if (seen.has(email)) return `${label}: o e-mail ${email} já está na lista.`;
    seen.add(email);
  }
  return null;
};
