// O Supabase Auth devolve mensagens em inglês. Traduzimos pelo `code` (quando existe)
// e, como fallback, pela mensagem original.
type AuthErrorLike = { code?: string; error_code?: string; message?: string } | null | undefined;

const BY_CODE: Record<string, string> = {
  same_password: "A nova senha precisa ser diferente da senha atual.",
  weak_password: "Senha muito fraca. Use uma senha mais forte.",
  invalid_credentials: "E-mail ou senha inválidos.",
  email_not_confirmed: "E-mail ainda não confirmado. Verifique sua caixa de entrada.",
  user_not_found: "Usuário não encontrado.",
  user_banned: "Este usuário está bloqueado.",
  otp_expired: "Este link expirou (ou já foi usado). Solicite um novo link.",
  otp_disabled: "Este tipo de link está desativado.",
  flow_state_expired: "Este link expirou. Solicite um novo link.",
  flow_state_not_found: "Link inválido ou já utilizado. Solicite um novo link.",
  bad_code_verifier:
    "Abra o link no mesmo navegador em que a solicitação foi feita, ou solicite um novo link.",
  session_not_found: "Sua sessão expirou. Solicite um novo link.",
  session_expired: "Sua sessão expirou. Solicite um novo link.",
  refresh_token_not_found: "Sua sessão expirou. Faça login novamente.",
  reauthentication_needed: "Por segurança, faça login novamente para alterar a senha.",
  over_email_send_rate_limit:
    "Muitos e-mails enviados em pouco tempo. Aguarde alguns minutos e tente novamente.",
  over_request_rate_limit: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  email_address_invalid: "E-mail inválido.",
  email_address_not_authorized: "Este e-mail não está autorizado a receber mensagens.",
  validation_failed: "Dados inválidos. Verifique as informações e tente novamente.",
};

const BY_MESSAGE: Array<[RegExp, string]> = [
  [/should be different from the old password/i, BY_CODE.same_password],
  [/password should be at least (\d+) characters/i, "A senha precisa ter pelo menos $1 caracteres."],
  [/password is known to be weak|weak password/i, BY_CODE.weak_password],
  [/password should contain/i, "A senha precisa conter letras maiúsculas, minúsculas, números e símbolos."],
  [/invalid login credentials/i, BY_CODE.invalid_credentials],
  [/email not confirmed/i, BY_CODE.email_not_confirmed],
  [/email link is invalid or has expired|token has expired or is invalid/i, BY_CODE.otp_expired],
  [/auth session missing/i, BY_CODE.session_not_found],
  [/for security purposes, you can only request this after (\d+) seconds?/i,
    "Por segurança, aguarde $1 segundos antes de solicitar novamente."],
  [/rate limit/i, BY_CODE.over_request_rate_limit],
  [/unable to validate email address|invalid format/i, BY_CODE.email_address_invalid],
  [/user not found/i, BY_CODE.user_not_found],
  [/failed to fetch|network/i, "Falha de conexão. Verifique sua internet e tente novamente."],
];

export const translateAuthError = (error: AuthErrorLike, fallback: string) => {
  const code = error?.code ?? error?.error_code;
  if (code && BY_CODE[code]) return BY_CODE[code];

  const message = error?.message?.trim() ?? "";
  for (const [pattern, translation] of BY_MESSAGE) {
    const match = message.match(pattern);
    if (match) return translation.replace("$1", match[1] ?? "");
  }

  return fallback;
};
