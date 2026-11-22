import { describe, expect, it } from "vitest";
import {
  decryptPollVote,
  extractPollUpdate,
  normalizeJids,
  pollDefinition,
  pollVoteAad,
  pollVoteKey,
} from "./pollVote.ts";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** PollVoteMessage com os hashes das opções (campo 1 repetido). */
async function encodeVote(options: string[]): Promise<Uint8Array> {
  const parts: number[] = [];
  for (const option of options) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(option)));
    parts.push(0x0a, hash.length, ...hash);
  }
  return Uint8Array.from(parts);
}

async function encryptVote(params: {
  secret: Uint8Array;
  pollId: string;
  creatorJid: string;
  voterJid: string;
  options: string[];
}) {
  const key = await pollVoteKey(params.secret, params.pollId, params.creatorJid, params.voterJid);
  const aesKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: pollVoteAad(params.pollId, params.voterJid) },
      aesKey,
      await encodeVote(params.options),
    ),
  );
  return { encPayload: b64(enc), encIv: b64(iv) };
}

it("voto em enquete: acha o par de JIDs e devolve as opções", async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const vote = await encryptVote({
    secret,
    pollId: "3EB0POLL",
    creatorJid: "5511999990000@s.whatsapp.net",
    voterJid: "8899340062832@lid",
    options: ["Sim"],
  });
  const update = extractPollUpdate({
    pollUpdateMessage: {
      pollCreationMessageKey: { id: "3EB0POLL", fromMe: true, remoteJid: "8899340062832@lid" },
      vote,
      senderTimestampMs: "1763800000000",
    },
  })!;
  expect(update.pollId).toEqual("3EB0POLL");
  expect(update.timestampMs).toEqual(1763800000000);

  const jids = normalizeJids(["5511999990000:12@s.whatsapp.net", "8899340062832@lid", "5585988887777"]);
  const result = await decryptPollVote({
    update,
    messageSecret: secret,
    options: ["Sim", "Não", "Talvez"],
    creatorJids: jids,
    voterJids: jids,
  });
  expect(result?.options).toEqual(["Sim"]);
  expect(result?.voterJid).toEqual("8899340062832@lid");
  expect(result?.creatorJid).toEqual("5511999990000@s.whatsapp.net");
});

it("voto em enquete: voto retirado vira lista vazia", async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const vote = await encryptVote({
    secret,
    pollId: "P2",
    creatorJid: "1@lid",
    voterJid: "2@lid",
    options: [],
  });
  const update = extractPollUpdate({ pollUpdateMessage: { pollCreationMessageKey: { id: "P2" }, vote } })!;
  const result = await decryptPollVote({
    update,
    messageSecret: secret,
    options: ["A", "B"],
    creatorJids: ["1@lid", "2@lid"],
    voterJids: ["1@lid", "2@lid"],
  });
  expect(result?.options).toEqual([]);
});

it("voto em enquete: chave errada devolve null", async () => {
  const vote = await encryptVote({
    secret: crypto.getRandomValues(new Uint8Array(32)),
    pollId: "P3",
    creatorJid: "1@lid",
    voterJid: "2@lid",
    options: ["A"],
  });
  const update = extractPollUpdate({ pollUpdateMessage: { pollCreationMessageKey: { id: "P3" }, vote } })!;
  const result = await decryptPollVote({
    update,
    messageSecret: crypto.getRandomValues(new Uint8Array(32)),
    options: ["A"],
    creatorJids: ["1@lid"],
    voterJids: ["2@lid"],
  });
  expect(result).toEqual(null);
});

it("enquete: lê nome, opções e se aceita várias", () => {
  expect(
    pollDefinition({
      ephemeralMessage: {
        message: {
          pollCreationMessageV3: {
            name: "Melhor horário?",
            options: [{ optionName: "Manhã" }, { optionName: "Tarde" }],
            selectableOptionsCount: 1,
          },
        },
      },
    }),
  ).toEqual({ name: "Melhor horário?", options: ["Manhã", "Tarde"], selectableCount: 1 });
  expect(extractPollUpdate({ conversation: "oi" })).toEqual(null);
});
