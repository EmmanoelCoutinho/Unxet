import type { Session } from "@supabase/supabase-js";

// A tela de definir senha só deve ser usada logo após abrir um link enviado por
// e-mail (convite ou "esqueci a senha"), nunca por uma sessão comum já logada.
const GRANT_KEY = "unxet.setPasswordGrant";
const MAX_AGE_MS = 15 * 60 * 1000;

// Métodos de autenticação (claim "amr" do JWT) gerados por links de e-mail
const EMAIL_LINK_METHODS = new Set([
  "recovery",
  "invite",
  "otp",
  "magiclink",
  "email/signup",
  "email_change",
]);

/** Chamado pelo /auth/callback depois de validar um link de e-mail. */
export const grantSetPassword = () => {
  try {
    window.sessionStorage.setItem(GRANT_KEY, String(Date.now()));
  } catch {
    // sessionStorage indisponível: a checagem pelo token ainda funciona
  }
};

export const clearSetPasswordGrant = () => {
  try {
    window.sessionStorage.removeItem(GRANT_KEY);
  } catch {
    // ignore
  }
};

const hasRecentGrant = () => {
  try {
    const raw = window.sessionStorage.getItem(GRANT_KEY);
    const grantedAt = raw ? Number(raw) : NaN;
    return Number.isFinite(grantedAt) && Date.now() - grantedAt <= MAX_AGE_MS;
  } catch {
    return false;
  }
};

type AmrEntry = { method?: string; timestamp?: number };

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

/** A sessão foi criada por um link de e-mail há pouco tempo? (claim assinada) */
export const sessionFromRecentEmailLink = (session: Session) => {
  const payload = decodeJwtPayload(session.access_token);
  const amr = Array.isArray(payload?.amr) ? (payload?.amr as AmrEntry[]) : [];
  const nowSec = Date.now() / 1000;

  return amr.some(
    (entry) =>
      !!entry.method &&
      EMAIL_LINK_METHODS.has(entry.method) &&
      typeof entry.timestamp === "number" &&
      nowSec - entry.timestamp <= MAX_AGE_MS / 1000,
  );
};

export const canSetPassword = (session: Session | null) =>
  !!session && (hasRecentGrant() || sessionFromRecentEmailLink(session));
