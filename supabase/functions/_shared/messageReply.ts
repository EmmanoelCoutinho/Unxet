// Responder citando e reagir a mensagens (menu da setinha no balão).
//
// O id da mensagem no WhatsApp fica em messages.meta_message_id (Evolution e
// WhatsApp oficial). A citação guarda um resumo da original (reply_preview)
// para aparecer mesmo quando a original não está carregada na tela.

type Client = { from: (table: string) => any };

export type ReplyPreview = {
  author: "cliente" | "atendente";
  type: string;
  text: string;
  senderName?: string;
};

export type ReplyTarget = {
  id: string;
  conversation_id: string;
  direction: string | null;
  type: string | null;
  text: string | null;
  meta_message_id: string | null;
  sender_name: string | null;
  deleted_at: string | null;
  payload?: unknown;
};

const PREVIEW_MAX = 200;

/** Emojis de reação: no máximo um "caractere visível" curto. Vazio = remover. */
export function normalizeReaction(value: unknown): string | null {
  const emoji = String(value ?? "").trim();
  if (!emoji) return null;
  if (emoji.length > 32) return null;
  // Precisa ter algum símbolo/emoji; texto comum não vale como reação
  if (/^[\p{L}\p{N}\s]+$/u.test(emoji)) return null;
  return emoji;
}

const MEDIA_LABELS: Record<string, string> = {
  image: "📷 Foto",
  audio: "🎤 Áudio",
  video: "🎥 Vídeo",
  document: "📄 Documento",
  sticker: "Figurinha",
};

/** Resumo da mensagem citada, gravado na resposta. */
export function buildReplyPreview(target: {
  direction?: string | null;
  type?: string | null;
  text?: string | null;
  sender_name?: string | null;
}): ReplyPreview {
  const type = String(target.type ?? "text") || "text";
  const raw = String(target.text ?? "").trim();
  const text = (raw || MEDIA_LABELS[type] || "Mensagem").slice(0, PREVIEW_MAX);
  const author = target.direction === "inbound" ? "cliente" : "atendente";
  const preview: ReplyPreview = { author, type, text };
  const senderName = String(target.sender_name ?? "").trim();
  // Atendente; ou, no grupo, quem escreveu (só a recebida de grupo tem nome)
  if (senderName) preview.senderName = senderName;
  return preview;
}

const TARGET_COLUMNS =
  "id, conversation_id, direction, type, text, meta_message_id, sender_name, deleted_at, payload";

/**
 * Mensagem que o atendente quer responder: precisa ser da mesma conversa,
 * não apagada e com id no WhatsApp. Sem isso a resposta sai sem citação.
 */
export async function loadReplyTarget(
  supabase: Client,
  conversationId: string,
  replyToMessageId: unknown,
): Promise<ReplyTarget | null> {
  const id = String(replyToMessageId ?? "").trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase
    .from("messages")
    .select(TARGET_COLUMNS)
    .eq("id", id)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.deleted_at || !data.meta_message_id) return null;
  return data as ReplyTarget;
}

/** Mensagem da conversa com aquele id do WhatsApp (citação recebida). */
export async function findByProviderId(
  supabase: Client,
  conversationId: string,
  providerId: unknown,
): Promise<ReplyTarget | null> {
  const mid = String(providerId ?? "").trim();
  if (!mid || !conversationId) return null;
  const { data, error } = await supabase
    .from("messages")
    .select(TARGET_COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("meta_message_id", mid)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as ReplyTarget;
}

/** Colunas da resposta que apontam para a citada. */
export function replyColumns(target: ReplyTarget | null) {
  if (!target) return {};
  return {
    reply_to_message_id: target.id,
    reply_preview: buildReplyPreview(target),
  };
}

const parsePayload = (raw: unknown): any => {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw ?? {};
};

/**
 * "quoted" da Evolution (sendText/sendMedia/...). A Evolution procura a
 * mensagem pela key; o texto vai junto para o caso de ela não ter guardado.
 */
export function evolutionQuoted(target: ReplyTarget, remoteJid: string) {
  const payload = parsePayload(target.payload);
  // Recebida pela Evolution: o payload é o webhook (data.key); enviada: a resposta do envio (key)
  const key = payload?.data?.key ?? payload?.key ?? {};
  return {
    key: {
      id: target.meta_message_id,
      remoteJid: key.remoteJid ?? remoteJid,
      fromMe: target.direction !== "inbound",
      // Grupo: o WhatsApp precisa saber de quem é a mensagem citada/reagida
      ...(typeof key.participant === "string" && key.participant ? { participant: key.participant } : {}),
    },
    message: { conversation: String(target.text ?? "") },
  };
}

/** Campos que trazem contextInfo numa mensagem da Evolution/Baileys. */
const CONTEXT_HOLDERS = [
  "extendedTextMessage",
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "pttMessage",
  "documentMessage",
  "stickerMessage",
  "contactMessage",
  "locationMessage",
];

/** Id da mensagem citada numa mensagem recebida pela Evolution. */
export function evolutionQuotedId(data: any): string | null {
  const message = data?.message ?? {};
  const candidates = [
    data?.contextInfo,
    message?.messageContextInfo?.stanzaId ? message.messageContextInfo : null,
    ...CONTEXT_HOLDERS.map((k) => message?.[k]?.contextInfo),
    message?.documentWithCaptionMessage?.message?.documentMessage?.contextInfo,
  ];
  for (const ctx of candidates) {
    const id = String(ctx?.stanzaId ?? "").trim();
    if (id) return id;
  }
  return null;
}

/** Reação recebida pela Evolution: { targetId, emoji (null = removida) }. */
export function evolutionReaction(data: any): { targetId: string; emoji: string | null } | null {
  const reaction = data?.message?.reactionMessage;
  if (!reaction) return null;
  const targetId = String(reaction.key?.id ?? "").trim();
  if (!targetId) return null;
  return { targetId, emoji: normalizeReaction(reaction.text) };
}

/** Reação recebida pelo WhatsApp oficial (message.type === "reaction"). */
export function metaReaction(message: any): { targetId: string; emoji: string | null } | null {
  if (message?.type !== "reaction") return null;
  const targetId = String(message.reaction?.message_id ?? "").trim();
  if (!targetId) return null;
  return { targetId, emoji: normalizeReaction(message.reaction?.emoji) };
}

/**
 * Grava a reação na mensagem de destino. side "client": reação do cliente;
 * "agent": da empresa (feita pelo celular da empresa ou pelo Unxet).
 */
export async function applyReaction(
  supabase: Client,
  opts: { targetProviderId: string; emoji: string | null; side: "client" | "agent"; userId?: string | null },
): Promise<boolean> {
  // userId undefined (eco pelo webhook): mantém quem reagiu pelo Unxet
  const update: Record<string, unknown> =
    opts.side === "client" ? { client_reaction: opts.emoji } : { agent_reaction: opts.emoji };
  if (opts.side === "agent" && (opts.userId !== undefined || !opts.emoji)) {
    update.agent_reaction_by = opts.emoji ? opts.userId ?? null : null;
  }
  const { data, error } = await supabase
    .from("messages")
    .update(update)
    .eq("meta_message_id", opts.targetProviderId)
    .select("id");
  if (error) {
    console.error("[REACTION_UPDATE_ERROR]", error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
