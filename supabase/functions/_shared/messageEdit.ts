// Edição de mensagem no WhatsApp (Evolution).
//
// O WhatsApp manda a edição de dois jeitos:
//  1. Aberta: protocolMessage (type MESSAGE_EDIT) com editedMessage, às vezes
//     dentro de editedMessage.message. Pode ser texto ou legenda de foto,
//     vídeo ou documento.
//  2. Criptografada: secretEncryptedMessage (secretEncType 2 = MESSAGE_EDIT).
//     A Evolution não abre. A chave sai do messageSecret da mensagem original
//     (que fica no payload dela no banco), do id dela e do JID de quem
//     escreveu, que é o LID do cliente (ex.: 8899340062832@lid). Conferido com
//     as edições reais da produção em 20/11/2026: HKDF-SHA256 sem salt, info
//     = id + JID + JID + "Message Edit" e AES-256-GCM sem dados adicionais. O
//     GCM confere a chave, então tentar um JID errado só falha.
//     O conteúdo é um Message (protobuf) com protocolMessage.editedMessage.

export interface MessageEdit {
  originalId: string;
  text: string;
}

export interface SecretEdit {
  originalId: string;
  encPayload: Uint8Array;
  encIv: Uint8Array;
}

const SECRET_ENC_MESSAGE_EDIT = 2;

const clean = (value: unknown) => String(value ?? "").trim();

/** Texto ou legenda de um Message (formato JSON da Evolution). */
function editedText(message: any): string {
  return clean(
    message?.conversation ??
      message?.extendedTextMessage?.text ??
      message?.imageMessage?.caption ??
      message?.videoMessage?.caption ??
      message?.documentMessage?.caption ??
      message?.documentWithCaptionMessage?.message?.documentMessage?.caption,
  );
}

/** Edição aberta (texto ou legenda). null se não for edição. */
export function extractMessageEdit(message: any): MessageEdit | null {
  const protocol =
    message?.editedMessage?.message?.protocolMessage ??
    (message?.protocolMessage?.editedMessage ? message.protocolMessage : null);
  if (!protocol) return null;
  return {
    originalId: clean(protocol.key?.id),
    text: editedText(protocol.editedMessage),
  };
}

/** Bytes que a Evolution manda como {"0": 12, "1": 34}, lista ou base64. */
export function toBytes(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (typeof value === "string") {
    try {
      const bin = atob(value);
      return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.type === "Buffer" && Array.isArray(obj.data)) return Uint8Array.from(obj.data as number[]);
    const keys = Object.keys(obj).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
    if (!keys.length) return null;
    return Uint8Array.from(keys.map((k) => Number(obj[k])));
  }
  return null;
}

/** Edição criptografada. null se não for (ou se for edição de evento). */
export function extractSecretEdit(message: any): SecretEdit | null {
  const secret = message?.secretEncryptedMessage;
  if (!secret || Number(secret.secretEncType) !== SECRET_ENC_MESSAGE_EDIT) return null;
  const originalId = clean(secret.targetMessageKey?.id);
  const encPayload = toBytes(secret.encPayload);
  const encIv = toBytes(secret.encIv);
  if (!originalId || !encPayload || !encIv) return null;
  return { originalId, encPayload, encIv };
}

/** messageSecret gravado no payload da mensagem original. */
export function originalMessageSecret(payload: any): Uint8Array | null {
  const message = payload?.data?.message ?? payload?.message;
  return toBytes(message?.messageContextInfo?.messageSecret);
}

// ── Protobuf mínimo (só o caminho até o texto editado) ────────────────────

type ProtoFields = Map<number, Uint8Array[]>;

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    if (shift < 49) result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7;
  }
  throw new Error("varint incompleto");
}

/** Campos "length-delimited" de uma mensagem protobuf (os outros são pulados). */
function readFields(buf: Uint8Array): ProtoFields {
  const fields: ProtoFields = new Map();
  let pos = 0;
  while (pos < buf.length) {
    const [tag, afterTag] = readVarint(buf, pos);
    pos = afterTag;
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) {
      pos = readVarint(buf, pos)[1];
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else if (wire === 2) {
      const [len, afterLen] = readVarint(buf, pos);
      const end = afterLen + len;
      if (end > buf.length) throw new Error("campo além do fim");
      const list = fields.get(field) ?? [];
      list.push(buf.subarray(afterLen, end));
      fields.set(field, list);
      pos = end;
    } else {
      throw new Error(`wire type ${wire} não suportado`);
    }
  }
  return fields;
}

const first = (fields: ProtoFields, n: number) => fields.get(n)?.[0];
const utf8 = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : "");

// Números dos campos no WAProto
const MESSAGE = {
  conversation: 1,
  imageMessage: 3,
  extendedTextMessage: 6,
  documentMessage: 7,
  videoMessage: 9,
  protocolMessage: 12,
  documentWithCaptionMessage: 53,
};
const PROTOCOL_EDITED_MESSAGE = 14;
const EXTENDED_TEXT = 1;
const IMAGE_CAPTION = 3;
const VIDEO_CAPTION = 7;
const DOCUMENT_CAPTION = 20;
const FUTURE_PROOF_MESSAGE = 1;

/** Texto/legenda de um Message em protobuf. */
function protoMessageText(buf: Uint8Array, depth = 0): string {
  const msg = readFields(buf);
  const conversation = first(msg, MESSAGE.conversation);
  if (conversation) return utf8(conversation);
  const ext = first(msg, MESSAGE.extendedTextMessage);
  if (ext) return utf8(first(readFields(ext), EXTENDED_TEXT));
  const image = first(msg, MESSAGE.imageMessage);
  if (image) return utf8(first(readFields(image), IMAGE_CAPTION));
  const video = first(msg, MESSAGE.videoMessage);
  if (video) return utf8(first(readFields(video), VIDEO_CAPTION));
  const doc = first(msg, MESSAGE.documentMessage);
  if (doc) return utf8(first(readFields(doc), DOCUMENT_CAPTION));
  const docWithCaption = first(msg, MESSAGE.documentWithCaptionMessage);
  if (docWithCaption && depth < 3) {
    const inner = first(readFields(docWithCaption), FUTURE_PROOF_MESSAGE);
    if (inner) return protoMessageText(inner, depth + 1);
  }
  return "";
}

/** Texto editado do conteúdo decifrado (Message com protocolMessage.editedMessage). */
export function decodeEditPayload(plain: Uint8Array): string {
  const root = readFields(plain);
  const protocol = first(root, MESSAGE.protocolMessage);
  const edited = protocol ? first(readFields(protocol), PROTOCOL_EDITED_MESSAGE) : undefined;
  return clean(protoMessageText(edited ?? plain));
}

// ── Chave e decifragem ────────────────────────────────────────────────────

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

/** Chave de uma edição: HKDF-SHA256 (sem salt) do messageSecret. */
export async function editKey(messageSecret: Uint8Array, originalId: string, senderJid: string): Promise<Uint8Array> {
  const prk = await hmacSha256(new Uint8Array(32), messageSecret);
  const info = concat(
    encoder.encode(originalId),
    encoder.encode(senderJid),
    encoder.encode(senderJid),
    encoder.encode("Message Edit"),
    Uint8Array.of(1),
  );
  return await hmacSha256(prk, info);
}

/**
 * Decifra a edição tentando cada JID possível de quem escreveu (LID e
 * telefone). Devolve o texto novo e o JID que serviu, ou null.
 */
export async function decryptSecretEdit(params: {
  edit: SecretEdit;
  messageSecret: Uint8Array;
  senderJids: string[];
}): Promise<{ text: string; senderJid: string } | null> {
  const { edit, messageSecret } = params;
  const jids = [...new Set(params.senderJids.map(clean).filter(Boolean))];
  for (const senderJid of jids) {
    try {
      const key = await editKey(messageSecret, edit.originalId, senderJid);
      const aesKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
      const plain = new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-GCM", iv: edit.encIv }, aesKey, edit.encPayload),
      );
      return { text: decodeEditPayload(plain), senderJid };
    } catch {
      // Chave errada (o GCM recusa) ou conteúdo inesperado: tenta o próximo
    }
  }
  return null;
}

/** JIDs de quem escreveu, para tentar a chave: LIDs primeiro, depois telefones. */
export function senderJidCandidates(values: unknown[]): string[] {
  const jids = values
    .map(clean)
    .filter((v) => v.includes("@"))
    .map((v) => v.replace(/:\d+@/, "@"));
  const unique = [...new Set(jids)];
  return [...unique.filter((j) => j.endsWith("@lid")), ...unique.filter((j) => !j.endsWith("@lid"))];
}
