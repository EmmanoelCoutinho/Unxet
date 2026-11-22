import { describe, expect, it } from "vitest";
import {
  decodeEditPayload,
  decryptSecretEdit,
  editKey,
  extractMessageEdit,
  extractSecretEdit,
  originalMessageSecret,
  senderJidCandidates,
  toBytes,
} from "./messageEdit";

// ── protobuf para montar o conteúdo de teste ──────────────────────────────
const enc = new TextEncoder();
const varint = (n: number) => {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const bytesField = (field: number, value: Uint8Array | string) => {
  const data = typeof value === "string" ? enc.encode(value) : value;
  return Uint8Array.from([...varint(field * 8 + 2), ...varint(data.length), ...data]);
};
const intField = (field: number, value: number) => Uint8Array.from([...varint(field * 8), ...varint(value)]);
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));

/** Message { protocolMessage { key, type: MESSAGE_EDIT, editedMessage } } */
const editProto = (edited: Uint8Array) =>
  bytesField(
    12,
    join(
      bytesField(1, join(bytesField(1, "100571608572142@lid"), intField(2, 1), bytesField(3, "3EB0ORIGINAL"))),
      intField(2, 14),
      bytesField(14, edited),
    ),
  );

const asJsonBytes = (bytes: Uint8Array) => Object.fromEntries([...bytes].map((b, i) => [String(i), b]));

async function encryptEdit(secret: Uint8Array, id: string, jid: string, plain: Uint8Array) {
  const key = await editKey(secret, id, jid);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const payload = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, plain));
  return { encIv: asJsonBytes(iv), encPayload: asJsonBytes(payload) };
}

describe("extractMessageEdit (edição aberta)", () => {
  it("texto, nos dois formatos", () => {
    expect(extractMessageEdit({
      editedMessage: { message: { protocolMessage: { key: { id: "A" }, editedMessage: { conversation: "novo" } } } },
    })).toEqual({ originalId: "A", text: "novo" });
    expect(extractMessageEdit({
      protocolMessage: { type: 14, key: { id: "B" }, editedMessage: { extendedTextMessage: { text: "outro" } } },
    })).toEqual({ originalId: "B", text: "outro" });
  });

  it("legenda de foto, vídeo e documento", () => {
    const edit = (editedMessage: any) => extractMessageEdit({ protocolMessage: { key: { id: "C" }, editedMessage } });
    expect(edit({ imageMessage: { caption: "foto" } })?.text).toBe("foto");
    expect(edit({ videoMessage: { caption: "vídeo" } })?.text).toBe("vídeo");
    expect(edit({ documentMessage: { caption: "doc" } })?.text).toBe("doc");
  });

  it("mensagem que não é edição", () => {
    expect(extractMessageEdit({ conversation: "oi" })).toBeNull();
    expect(extractMessageEdit({ protocolMessage: { type: 0, key: { id: "D" } } })).toBeNull();
  });
});

describe("toBytes", () => {
  it("objeto com índices, lista, Buffer e base64", () => {
    expect([...toBytes({ "1": 2, "0": 1, "10": 11, "2": 3 })!]).toEqual([1, 2, 3, 11]);
    expect([...toBytes([4, 5])!]).toEqual([4, 5]);
    expect([...toBytes({ type: "Buffer", data: [6] })!]).toEqual([6]);
    expect([...toBytes("AQI=")!]).toEqual([1, 2]);
    expect(toBytes(null)).toBeNull();
  });
});

describe("edição criptografada", () => {
  const secret = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
  const lid = "8899340062832@lid";
  const id = "3EB0ORIGINAL";

  it("decifra com o LID de quem escreveu e lê o texto", async () => {
    const plain = editProto(bytesField(6, bytesField(1, "ele não me responde para iniciarmos")));
    const sec = { secretEncType: 2, targetMessageKey: { id, fromMe: true }, ...(await encryptEdit(secret, id, lid, plain)) };
    const edit = extractSecretEdit({ secretEncryptedMessage: sec })!;
    expect(edit.originalId).toBe(id);

    const result = await decryptSecretEdit({
      edit,
      messageSecret: originalMessageSecret({ data: { message: { messageContextInfo: { messageSecret: asJsonBytes(secret) } } } })!,
      senderJids: ["559185341558@s.whatsapp.net", lid],
    });
    expect(result).toEqual({ text: "ele não me responde para iniciarmos", senderJid: lid });
  });

  it("sem o JID certo devolve null", async () => {
    const plain = editProto(bytesField(1, "texto"));
    const sec = { secretEncType: 2, targetMessageKey: { id }, ...(await encryptEdit(secret, id, lid, plain)) };
    const result = await decryptSecretEdit({
      edit: extractSecretEdit({ secretEncryptedMessage: sec })!,
      messageSecret: secret,
      senderJids: ["559185341558@s.whatsapp.net"],
    });
    expect(result).toBeNull();
  });

  it("edição de evento (tipo 1) não é tratada", () => {
    expect(extractSecretEdit({ secretEncryptedMessage: { secretEncType: 1, targetMessageKey: { id }, encIv: [1], encPayload: [1] } }))
      .toBeNull();
  });
});

describe("decodeEditPayload", () => {
  it("texto simples, texto estendido e legendas", () => {
    expect(decodeEditPayload(editProto(bytesField(1, "Bom dia")))).toBe("Bom dia");
    expect(decodeEditPayload(editProto(bytesField(3, join(bytesField(2, "image/jpeg"), bytesField(3, "foto nova"))))))
      .toBe("foto nova");
    expect(decodeEditPayload(editProto(bytesField(9, join(intField(5, 12), bytesField(7, "vídeo novo"))))))
      .toBe("vídeo novo");
    expect(decodeEditPayload(editProto(bytesField(7, join(bytesField(8, "a.pdf"), bytesField(20, "doc novo"))))))
      .toBe("doc novo");
  });
});

describe("senderJidCandidates", () => {
  it("LID primeiro, sem repetidos, sem vazios e sem o aparelho", () => {
    expect(senderJidCandidates([
      "559185341558@s.whatsapp.net",
      "",
      null,
      "8899340062832:12@lid",
      "8899340062832@lid",
      "559185341558@s.whatsapp.net",
    ])).toEqual(["8899340062832@lid", "559185341558@s.whatsapp.net"]);
  });
});
