// deno-lint-ignore-file
// @ts-nocheck
// Helpers do embedded signup do WhatsApp oficial (Meta Cloud API).
//
// Depois de trocar o code por token, a Meta não devolve o WABA nem o número:
// eles aparecem nos granular_scopes do debug_token (target_ids) e em
// /{waba_id}/phone_numbers.

// IDs de WABA concedidos ao token, na ordem em que a Meta devolve.
// whatsapp_business_management vem primeiro; messaging é fallback.
export const extractWabaIds = (debugData: unknown): string[] => {
  const scopes = Array.isArray(debugData?.granular_scopes)
    ? debugData.granular_scopes
    : [];

  const idsFor = (scope: string) =>
    scopes
      .filter((s) => s?.scope === scope)
      .flatMap((s) => (Array.isArray(s?.target_ids) ? s.target_ids : []))
      .map((id) => String(id ?? "").trim())
      .filter(Boolean);

  const ids = [
    ...idsFor("whatsapp_business_management"),
    ...idsFor("whatsapp_business_messaging"),
  ];
  return [...new Set(ids)];
};

export type WabaPhoneNumber = {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
};

// Normaliza a resposta de /{waba_id}/phone_numbers.
export const parsePhoneNumbers = (body: unknown): WabaPhoneNumber[] => {
  const list = Array.isArray(body?.data) ? body.data : [];
  return list
    .map((n) => ({
      id: String(n?.id ?? "").trim(),
      displayPhoneNumber: String(n?.display_phone_number ?? "").trim(),
      verifiedName: String(n?.verified_name ?? "").trim(),
    }))
    .filter((n) => n.id && n.displayPhoneNumber);
};

// Mensagem legível a partir do erro da Graph API ({ error: { message } }).
export const metaErrorMessage = (body: unknown): string => {
  const message = body?.error?.error_user_msg ?? body?.error?.message;
  return typeof message === "string" && message.trim() ? message.trim() : "";
};
