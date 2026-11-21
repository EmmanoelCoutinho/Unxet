import { describe, expect, it } from "vitest";
import {
  buildReplyPreview,
  evolutionQuoted,
  evolutionQuotedId,
  evolutionReaction,
  metaReaction,
  normalizeReaction,
} from "./messageReply";

describe("normalizeReaction", () => {
  it("aceita emoji e trata vazio como remover", () => {
    expect(normalizeReaction("👍")).toBe("👍");
    expect(normalizeReaction("❤️")).toBe("❤️");
    expect(normalizeReaction("")).toBeNull();
    expect(normalizeReaction(null)).toBeNull();
  });

  it("recusa texto comum", () => {
    expect(normalizeReaction("ok")).toBeNull();
    expect(normalizeReaction("x".repeat(40))).toBeNull();
  });
});

describe("buildReplyPreview", () => {
  it("resume texto do cliente", () => {
    expect(buildReplyPreview({ direction: "inbound", type: "text", text: " oi " })).toEqual({
      author: "cliente",
      type: "text",
      text: "oi",
    });
  });

  it("usa rótulo para mídia sem legenda e guarda o nome do atendente", () => {
    expect(
      buildReplyPreview({ direction: "outbound", type: "audio", text: "", sender_name: "Ana" }),
    ).toEqual({ author: "atendente", type: "audio", text: "🎤 Áudio", senderName: "Ana" });
  });

  it("no grupo, guarda o nome de quem escreveu", () => {
    expect(
      buildReplyPreview({ direction: "inbound", type: "text", text: "oi", sender_name: "Maria" }),
    ).toEqual({ author: "cliente", type: "text", text: "oi", senderName: "Maria" });
  });

  it("vídeo gravado como documento aparece como vídeo", () => {
    expect(
      buildReplyPreview({ direction: "inbound", type: "document", text: "", media_mime_type: "video/mp4" }),
    ).toEqual({ author: "cliente", type: "video", text: "🎥 Vídeo" });
    expect(
      buildReplyPreview({ direction: "inbound", type: "document", text: "", filename: "aula.MP4" }),
    ).toMatchObject({ type: "video", text: "🎥 Vídeo" });
    expect(
      buildReplyPreview({ direction: "inbound", type: "document", text: "", media_mime_type: "application/pdf" }),
    ).toMatchObject({ type: "document", text: "📄 Documento" });
  });

  it("corta textos longos", () => {
    expect(buildReplyPreview({ direction: "inbound", text: "a".repeat(500) }).text).toHaveLength(200);
  });
});

describe("evolutionQuotedId", () => {
  it("lê o stanzaId do texto respondido", () => {
    expect(
      evolutionQuotedId({ message: { extendedTextMessage: { text: "sim", contextInfo: { stanzaId: "ABC" } } } }),
    ).toBe("ABC");
  });

  it("lê de mídia e do contextInfo do data", () => {
    expect(evolutionQuotedId({ message: { imageMessage: { contextInfo: { stanzaId: "IMG" } } } })).toBe("IMG");
    expect(evolutionQuotedId({ contextInfo: { stanzaId: "TOP" }, message: { conversation: "oi" } })).toBe("TOP");
  });

  it("sem citação devolve null", () => {
    expect(evolutionQuotedId({ message: { conversation: "oi" } })).toBeNull();
  });
});

describe("reações recebidas", () => {
  it("Evolution: emoji e remoção", () => {
    expect(evolutionReaction({ message: { reactionMessage: { key: { id: "M1" }, text: "😂" } } })).toEqual({
      targetId: "M1",
      emoji: "😂",
    });
    expect(evolutionReaction({ message: { reactionMessage: { key: { id: "M1" }, text: "" } } })).toEqual({
      targetId: "M1",
      emoji: null,
    });
    expect(evolutionReaction({ message: { conversation: "oi" } })).toBeNull();
  });

  it("WhatsApp oficial", () => {
    expect(metaReaction({ type: "reaction", reaction: { message_id: "wamid.1", emoji: "🙏" } })).toEqual({
      targetId: "wamid.1",
      emoji: "🙏",
    });
    expect(metaReaction({ type: "text" })).toBeNull();
  });
});

describe("evolutionQuoted", () => {
  it("monta a key com o remoteJid do payload e fromMe pela direção", () => {
    const quoted = evolutionQuoted(
      {
        id: "u1",
        conversation_id: "c1",
        direction: "inbound",
        type: "text",
        text: "qual o preço?",
        meta_message_id: "WA1",
        sender_name: null,
        deleted_at: null,
        payload: { data: { key: { remoteJid: "123@lid" } } },
      },
      "5511999998888@s.whatsapp.net",
    );
    expect(quoted).toEqual({
      key: { id: "WA1", remoteJid: "123@lid", fromMe: false },
      message: { conversation: "qual o preço?" },
    });
  });
});
