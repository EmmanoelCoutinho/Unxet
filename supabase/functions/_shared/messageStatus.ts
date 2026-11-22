/**
 * Status de entrega das mensagens enviadas (ticks do WhatsApp).
 *
 *  ✓   enviada     → linha existe (sent_at)
 *  ✓✓  entregue    → delivered_at
 *  ✓✓  lida (verde)→ read_at
 *  !   não entregue→ failed_at (o provedor avisou que não entregou)
 *
 * Os provedores (Evolution / Meta Cloud) avisam via webhook usando o id da
 * mensagem no provedor, que gravamos em messages.meta_message_id.
 * Os campos só avançam: nunca apagamos nem sobrescrevemos um timestamp.
 * Falha depois de entregue é ignorada (a entrega prevalece).
 */ export type ProviderMessageStatus = "delivered" | "read" | "failed";

const FIND_ATTEMPTS = 3;
const FIND_RETRY_DELAY_MS = 1500;
const FAILURE_REASON_MAX = 300;

const sleep = (ms: number)=>new Promise((resolve)=>setTimeout(resolve, ms));

// O webhook de status pode chegar antes de a função de envio gravar a linha
// (a Evolution confirma a entrega em milissegundos), então tentamos de novo.
async function findOutboundMessage(supabase: any, providerMessageId: string) {
  for(let attempt = 0; attempt < FIND_ATTEMPTS; attempt++){
    const { data, error } = await supabase.from("messages").select("id, delivered_at, read_at, failed_at").eq("meta_message_id", providerMessageId).eq("direction", "outbound").maybeSingle();
    if (error) throw error;
    if (data) return data;
    if (attempt < FIND_ATTEMPTS - 1) await sleep(FIND_RETRY_DELAY_MS);
  }
  return null;
}

/** O que gravar na linha para o status recebido (sem dependências, testável). */
export function statusPatch(
  row: { delivered_at?: string | null; read_at?: string | null; failed_at?: string | null },
  status: ProviderMessageStatus,
  atIso: string,
  reason?: string | null,
) {
  const patch: Record<string, string | null> = {};
  if (status === "failed") {
    // Já entregue (ou já marcada como falha): nada muda
    if (row.delivered_at || row.read_at || row.failed_at) return patch;
    patch.failed_at = atIso;
    const text = String(reason ?? "").trim();
    if (text) patch.failure_reason = text.slice(0, FAILURE_REASON_MAX);
    return patch;
  }
  // Lida implica entregue (às vezes o "read" chega sem o "delivered").
  if (!row.delivered_at) patch.delivered_at = atIso;
  if (status === "read" && !row.read_at) patch.read_at = atIso;
  // Entregue depois de um aviso de falha: a entrega prevalece
  if (row.failed_at) {
    patch.failed_at = null;
    patch.failure_reason = null;
  }
  return patch;
}

export async function applyMessageStatus(
  supabase: any,
  providerMessageId: string,
  status: ProviderMessageStatus,
  atIso: string,
  reason?: string | null,
) {
  if (!providerMessageId) return "ignored";
  const row = await findOutboundMessage(supabase, providerMessageId);
  if (!row) return "not_found";
  const patch = statusPatch(row, status, atIso, reason);
  if (Object.keys(patch).length === 0) return "unchanged";
  const { error } = await supabase.from("messages").update(patch).eq("id", row.id);
  if (error) throw error;
  return "updated";
}
