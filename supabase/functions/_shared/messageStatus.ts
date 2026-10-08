/**
 * Status de entrega das mensagens enviadas (ticks do WhatsApp).
 *
 *  ✓   enviada     → linha existe (sent_at)
 *  ✓✓  entregue    → delivered_at
 *  ✓✓  lida (verde)→ read_at
 *
 * Os provedores (Evolution / Meta Cloud) avisam via webhook usando o id da
 * mensagem no provedor, que gravamos em messages.meta_message_id.
 * Os campos só avançam: nunca apagamos nem sobrescrevemos um timestamp.
 */ export type ProviderMessageStatus = "delivered" | "read";

const FIND_ATTEMPTS = 3;
const FIND_RETRY_DELAY_MS = 1500;

const sleep = (ms: number)=>new Promise((resolve)=>setTimeout(resolve, ms));

// O webhook de status pode chegar antes de a função de envio gravar a linha
// (a Evolution confirma a entrega em milissegundos), então tentamos de novo.
async function findOutboundMessage(supabase: any, providerMessageId: string) {
  for(let attempt = 0; attempt < FIND_ATTEMPTS; attempt++){
    const { data, error } = await supabase.from("messages").select("id, delivered_at, read_at").eq("meta_message_id", providerMessageId).eq("direction", "outbound").maybeSingle();
    if (error) throw error;
    if (data) return data;
    if (attempt < FIND_ATTEMPTS - 1) await sleep(FIND_RETRY_DELAY_MS);
  }
  return null;
}

export async function applyMessageStatus(supabase: any, providerMessageId: string, status: ProviderMessageStatus, atIso: string) {
  if (!providerMessageId) return "ignored";
  const row = await findOutboundMessage(supabase, providerMessageId);
  if (!row) return "not_found";
  const patch: Record<string, string> = {};
  // Lida implica entregue (às vezes o "read" chega sem o "delivered").
  if (!row.delivered_at) patch.delivered_at = atIso;
  if (status === "read" && !row.read_at) patch.read_at = atIso;
  if (Object.keys(patch).length === 0) return "unchanged";
  const { error } = await supabase.from("messages").update(patch).eq("id", row.id);
  if (error) throw error;
  return "updated";
}
