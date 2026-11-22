// Voto em enquete do WhatsApp (Evolution).
//
// O voto chega como pollUpdateMessage, criptografado: só quem tem o
// messageSecret da enquete (gravado no payload dela no banco) consegue ler.
// A chave segue o mesmo desenho da edição (_shared/messageEdit.ts):
//   prk = HMAC-SHA256(32 zeros, messageSecret)
//   chave = HMAC-SHA256(prk, id da enquete + JID de quem criou + JID de quem
//           votou + "Poll Vote" + 0x01)
//   AES-256-GCM com dados adicionais "id da enquete\0JID de quem votou".
// O conteúdo é um PollVoteMessage (protobuf): campo 1 repetido com o
// SHA-256 do nome de cada opção escolhida. Lista vazia = tirou o voto.
// O WhatsApp troca telefone por LID: tentamos cada par de JIDs possível, e o
// GCM recusa a chave errada.

import { toBytes } from "./messageEdit.ts";

export interface PollUpdate {
  pollId: string;
  encPayload: Uint8Array | null;
  encIv: Uint8Array | null;
  /** Algumas versões da Evolution já mandam o voto aberto (nomes das opções). */
  plainOptions: string[] | null;
  /** Hora do voto (ms), quando vier. */
  timestampMs: number | null;
}

export interface PollVote {
  /** Opções escolhidas (nomes). Vazia: a pessoa tirou o voto. */
  options: string[];
  at: string;
  name?: string | null;
  fromMe?: boolean;
}

/** Votos gravados em messages.poll_votes: por JID de quem votou. */
export type PollVotes = Record<string, PollVote>;

const clean = (value: unknown) => String(value ?? "").trim();
const encoder = new TextEncoder();

/** Mensagem dentro dos embrulhos mais comuns (temporária, futureProof...). */
function innerMessage(message: any): any {
  let current = message ?? {};
  for (let depth = 0; depth < 5; depth++) {
    const wrapper = ["ephemeralMessage", "futureProofMessage", "deviceSentMessage"].find(
      (key) => current?.[key]?.message,
    );
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current ?? {};
}

/** Voto em enquete. null se a mensagem não for voto. */
export function extractPollUpdate(message: any): PollUpdate | null {
  const update = innerMessage(message)?.pollUpdateMessage;
  if (!update) return null;
  const pollId = clean(update.pollCreationMessageKey?.id);
  if (!pollId) return null;
  const vote = update.vote ?? {};
  const plain = Array.isArray(vote.selectedOptions) &&
      vote.selectedOptions.every((o: unknown) => typeof o === "string" && !/^[A-Za-z0-9+/]{43}=$/.test(o))
    ? vote.selectedOptions.map(clean).filter(Boolean)
    : null;
  const ts = Number(update.senderTimestampMs?.low ?? update.senderTimestampMs);
  return {
    pollId,
    encPayload: toBytes(vote.encPayload),
    encIv: toBytes(vote.encIv),
    plainOptions: plain,
    timestampMs: Number.isFinite(ts) && ts > 0 ? ts : null,
  };
}

export interface PollDefinition {
  name: string;
  options: string[];
  /** 1 = uma opção só; 0 (ou mais de 1) = várias. */
  selectableCount: number;
}

/** Enquete dentro de um Message (formato JSON da Evolution). */
export function pollDefinition(message: any): PollDefinition | null {
  const msg = innerMessage(message);
  const poll = msg.pollCreationMessage ?? msg.pollCreationMessageV2 ?? msg.pollCreationMessageV3 ??
    msg.pollCreationMessageV5;
  if (!poll) return null;
  return {
    name: clean(poll.name),
    options: (poll.options ?? []).map((o: any) => clean(o?.optionName)).filter(Boolean),
    selectableCount: Number(poll.selectableOptionsCount ?? 0) || 0,
  };
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function pollVoteKey(
  messageSecret: Uint8Array,
  pollId: string,
  creatorJid: string,
  voterJid: string,
): Promise<Uint8Array> {
  const prk = await hmacSha256(new Uint8Array(32), messageSecret);
  const info = concat(
    encoder.encode(pollId),
    encoder.encode(creatorJid),
    encoder.encode(voterJid),
    encoder.encode("Poll Vote"),
    Uint8Array.of(1),
  );
  return await hmacSha256(prk, info);
}

export const pollVoteAad = (pollId: string, voterJid: string) => encoder.encode(`${pollId}\u0000${voterJid}`);

/** Hashes das opções escolhidas (campo 1 repetido do PollVoteMessage). */
export function decodePollVote(buf: Uint8Array): Uint8Array[] {
  const hashes: Uint8Array[] = [];
  let pos = 0;
  const varint = (): number => {
    let result = 0;
    let shift = 0;
    while (pos < buf.length) {
      const byte = buf[pos++];
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
    throw new Error("varint incompleto");
  };
  while (pos < buf.length) {
    const tag = varint();
    const wire = tag & 7;
    if (wire === 0) varint();
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else if (wire === 2) {
      const len = varint();
      if (pos + len > buf.length) throw new Error("campo além do fim");
      if (Math.floor(tag / 8) === 1) hashes.push(buf.subarray(pos, pos + len));
      pos += len;
    } else throw new Error(`wire type ${wire} não suportado`);
  }
  return hashes;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function optionHash(option: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(option))));
}

/** Nomes das opções a partir dos hashes do voto (ignora hash desconhecido). */
export async function optionsFromHashes(hashes: Uint8Array[], options: string[]): Promise<string[]> {
  const byHash = new Map<string, string>();
  for (const option of options) byHash.set(await optionHash(option), option);
  return hashes.map((h) => byHash.get(hex(h))).filter((o): o is string => !!o);
}

/**
 * Decifra o voto tentando cada par (quem criou, quem votou). Devolve as
 * opções escolhidas e o JID de quem votou, ou null.
 */
export async function decryptPollVote(params: {
  update: PollUpdate;
  messageSecret: Uint8Array;
  options: string[];
  creatorJids: string[];
  voterJids: string[];
}): Promise<{ options: string[]; voterJid: string; creatorJid: string } | null> {
  const { update, messageSecret } = params;
  if (!update.encPayload || !update.encIv) return null;
  const uniq = (list: string[]) => [...new Set(list.map(clean).filter(Boolean))];
  for (const creatorJid of uniq(params.creatorJids)) {
    for (const voterJid of uniq(params.voterJids)) {
      try {
        const key = await pollVoteKey(messageSecret, update.pollId, creatorJid, voterJid);
        const aesKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
        const plain = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: update.encIv, additionalData: pollVoteAad(update.pollId, voterJid) },
            aesKey,
            update.encPayload,
          ),
        );
        return { options: await optionsFromHashes(decodePollVote(plain), params.options), voterJid, creatorJid };
      } catch {
        // Par errado (o GCM recusa): tenta o próximo
      }
    }
  }
  return null;
}

/** JIDs sem o ":dispositivo" e telefone solto com @s.whatsapp.net. */
export function normalizeJids(values: unknown[]): string[] {
  const jids = values
    .map(clean)
    .filter(Boolean)
    .map((v) => (v.includes("@") ? v : /^\d{8,}$/.test(v) ? `${v}@s.whatsapp.net` : ""))
    .filter(Boolean)
    .map((v) => v.replace(/:\d+@/, "@"));
  const unique = [...new Set(jids)];
  return [...unique.filter((j) => j.endsWith("@lid")), ...unique.filter((j) => !j.endsWith("@lid"))];
}
