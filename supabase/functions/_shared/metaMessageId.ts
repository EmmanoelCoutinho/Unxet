// IDs de mensagem do Instagram vêm em base64 com escapes da Meta ("ZA" = "Z",
// "ZD" = "="), e a mesma mensagem chega com prefixos diferentes: o envio devolve
// "new_ig_dm_item:1:IGMessageID:..." e o eco do webhook "ig_dm_item:1:IGMessageID:...".
// Para saber se são a mesma mensagem, compara-se a parte a partir de "IGMessageID:".

const IG_MARKER = "IGMessageID:";

/** Chave estável de um id de mensagem da Meta (o próprio id quando não é do Instagram) */
export function metaMessageKey(mid: unknown): string {
  const raw = String(mid ?? "").trim();
  if (!raw) return "";
  try {
    const base64 = raw.replace(/Z([AD])/g, (_m, c) => (c === "A" ? "Z" : "="));
    const decoded = atob(base64);
    const at = decoded.indexOf(IG_MARKER);
    if (at >= 0) return decoded.slice(at);
  } catch {
    // Não é base64 (ex.: ids "m_..." do Messenger): usa como veio
  }
  return raw;
}

type MessagesClient = {
  from: (table: string) => any;
};

/**
 * Procura, na conversa, a mensagem enviada que tem o mesmo id da Meta (exato ou
 * pela chave do Instagram). Usado para não gravar duas vezes a mensagem enviada
 * e o eco que a Meta devolve pelo webhook.
 */
export async function findOutboundByMetaId(
  supabase: MessagesClient,
  opts: { conversationId: string; mid: string; withinMinutes?: number },
): Promise<string | null> {
  const mid = String(opts.mid ?? "").trim();
  if (!mid || !opts.conversationId) return null;

  const { data: exact } = await supabase
    .from("messages")
    .select("id")
    .eq("meta_message_id", mid)
    .limit(1)
    .maybeSingle();
  if (exact?.id) return exact.id;

  const key = metaMessageKey(mid);
  if (key === mid) return null;

  const since = new Date(Date.now() - (opts.withinMinutes ?? 30) * 60_000).toISOString();
  const { data: recent } = await supabase
    .from("messages")
    .select("id, meta_message_id")
    .eq("conversation_id", opts.conversationId)
    .eq("direction", "outbound")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);
  for (const row of recent ?? []) {
    if (metaMessageKey(row.meta_message_id) === key) return row.id;
  }
  return null;
}
