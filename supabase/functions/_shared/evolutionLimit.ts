// deno-lint-ignore-file
// @ts-nocheck
// Número QR Code escaneado que o banco recusou.
//
// O gatilho enforce_whatsapp_connected_limit recusa a passagem para
// "connected" quando a empresa está no limite de números (hint
// 'whatsapp_number_limit') ou quando o mesmo celular já está conectado em
// outra conexão (hint 'whatsapp_number_duplicate'). Quem recebe a recusa
// desloga a instância na Evolution, para o número não ficar ligado sem
// aparecer no sistema, e grava o motivo para a tela de Integrações explicar.

const REASON_BY_HINT = {
  whatsapp_number_limit: "plan_limit",
  whatsapp_number_duplicate: "duplicate_number"
};

/** Motivo da recusa ('plan_limit' | 'duplicate_number') ou null se não for uma. */
export const connectionRejectionReason = (error) => REASON_BY_HINT[error?.hint] ?? null;

export async function rejectConnection(supabase, connection, apiUrl, apiKey, reason) {
  const baseUrl = String(apiUrl ?? "").replace(/\/$/, "");
  if (baseUrl && apiKey && connection.session_name) {
    try {
      const response = await fetch(`${baseUrl}/instance/logout/${connection.session_name}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey
        }
      });
      console.log("[WHATSAPP_REJECTED_LOGOUT]", {
        connectionId: connection.id,
        reason,
        status: response.status
      });
    } catch (err) {
      console.error("[WHATSAPP_REJECTED_LOGOUT_ERROR]", connection.id, err);
    }
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("channel_connections").update({
    status: "disconnected",
    qr_code: null,
    disconnect_reason: reason,
    last_disconnection_at: now,
    updated_at: now
  }).eq("id", connection.id);
  if (error) console.error("[WHATSAPP_REJECTED_UPDATE_ERROR]", connection.id, error);
}
