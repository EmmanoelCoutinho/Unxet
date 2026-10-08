// URL pública do app usada nos links enviados por e-mail (convite, redefinição de senha).
// Defina VITE_APP_URL em produção (ex: https://app.unxet.com.br) para que os links
// nunca apontem para localhost quando a ação for disparada de um ambiente local.
const configuredAppUrl = (import.meta.env.VITE_APP_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, "");

export const getAppUrl = () => configuredAppUrl || window.location.origin;

export const getAuthCallbackUrl = () => `${getAppUrl()}/auth/callback`;
