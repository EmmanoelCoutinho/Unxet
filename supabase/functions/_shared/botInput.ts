/**
 * Regras para o que o cliente manda enquanto o bot espera uma opção do menu.
 *
 * Quando nenhuma mensagem bate com uma opção, o bot decide entre:
 *  - "media":     áudio, foto, vídeo ou documento → passa para um atendente
 *  - "free_text": frase de verdade (o cliente explicando algo, ou outra
 *                 empresa mandando texto pronto) → passa para um atendente
 *  - "invalid":   resposta curta que não é opção ("ok", "?", "oi") →
 *                 "Não entendi" + menu, como antes
 */

export type UnmatchedInputKind = "media" | "free_text" | "invalid";

export interface InboundSnapshot {
  type?: string | null;
  text?: string | null;
}

const MEDIA_TYPES = new Set(["image", "audio", "document", "video", "sticker"]);

// A partir daqui a mensagem é tratada como frase, não como tentativa de opção
export const FREE_TEXT_MIN_WORDS = 4;
export const FREE_TEXT_MIN_CHARS = 30;

// Palavras de cumprimento/confirmação: "Boa tarde, tudo bem?" não é uma frase
// que precise de atendente, é só o cliente puxando conversa.
const SMALL_TALK_WORDS = new Set([
  "oi", "oii", "oiii", "ola", "opa", "eai", "eae", "ei", "hey",
  "bom", "boa", "dia", "tarde", "noite", "tudo", "bem", "td", "tb", "tbm",
  "e", "ai", "com", "voce", "voces", "vc", "vcs", "como", "vai", "esta", "ta",
  "blz", "beleza", "tranquilo", "ok", "okay", "oky", "certo", "sim", "nao",
  "obrigado", "obrigada", "obg", "valeu", "vlw", "por", "favor", "pf", "pfv",
]);

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function isMediaMessageType(type: unknown): boolean {
  return MEDIA_TYPES.has(String(type ?? "").toLowerCase());
}

/** Frase com conteúdo (não cumprimento, não "ok", não número solto). */
export function isFreeText(text: unknown): boolean {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;
  const tokens = words(trimmed);
  if (tokens.length === 0) return false;
  if (tokens.every((word) => SMALL_TALK_WORDS.has(word))) return false;
  return tokens.length >= FREE_TEXT_MIN_WORDS || trimmed.length >= FREE_TEXT_MIN_CHARS;
}

/**
 * Decide o que fazer com as mensagens do cliente que não bateram com nenhuma
 * opção. Mídia tem prioridade: o atendente precisa ver o arquivo ou ouvir o áudio.
 */
export function classifyUnmatchedInput(messages: InboundSnapshot[]): UnmatchedInputKind {
  if (messages.some((msg) => isMediaMessageType(msg.type))) return "media";
  if (messages.some((msg) => isFreeText(msg.text))) return "free_text";
  return "invalid";
}
