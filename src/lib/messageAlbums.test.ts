import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { groupAlbums } from "./messageAlbums";
import { pollFromPayload, tallyPoll } from "./whatsappPoll";

const photo = (id: string, second: number, extra: Partial<Message> = {}): Message =>
  ({
    id,
    conversationId: "c1",
    direction: "inbound",
    author: "cliente",
    type: "image",
    text: "",
    mediaUrl: `https://x/${id}.jpg`,
    createdAt: new Date(Date.UTC(2026, 10, 22, 11, 6, second)).toISOString(),
    ...extra,
  }) as Message;

const items = (messages: Message[]) => messages.map((message) => ({ kind: "message" as const, message }));

describe("groupAlbums", () => {
  it("4 ou mais fotos seguidas viram um álbum", () => {
    const out = groupAlbums(items([photo("a", 0), photo("b", 1), photo("c", 2), photo("d", 3), photo("e", 4)]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "album" });
    expect((out[0] as { messages: Message[] }).messages.map((m) => m.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("3 fotos ficam soltas", () => {
    const out = groupAlbums(items([photo("a", 0), photo("b", 1), photo("c", 2)]));
    expect(out.map((i) => i.kind)).toEqual(["message", "message", "message"]);
  });

  it("legenda, outra pessoa ou intervalo grande quebram o álbum", () => {
    const list = [
      photo("a", 0),
      photo("b", 1),
      photo("c", 2, { text: "olha essa" }),
      photo("d", 3),
      photo("e", 4, { direction: "outbound", author: "atendente" }),
    ];
    expect(groupAlbums(items(list)).every((i) => i.kind === "message")).toBe(true);

    const late = [photo("a", 0), photo("b", 1), photo("c", 2), { ...photo("d", 0), createdAt: "2026-11-22T11:20:00.000Z" }];
    expect(groupAlbums(items(late)).every((i) => i.kind === "message")).toBe(true);
  });

  it("evento no meio separa as fotos", () => {
    const list = [
      ...items([photo("a", 0), photo("b", 1)]),
      { kind: "event" as const },
      ...items([photo("c", 2), photo("d", 3)]),
    ];
    expect(groupAlbums(list).map((i) => i.kind)).toEqual(["message", "message", "event", "message", "message"]);
  });
});

describe("enquete", () => {
  const payload = {
    data: {
      message: {
        messageContextInfo: { messageSecret: "x" },
        pollCreationMessageV3: {
          name: "Qual dia?",
          options: [{ optionName: "Segunda" }, { optionName: "Terça" }],
          selectableOptionsCount: 0,
        },
      },
    },
  };

  it("lê a enquete do payload", () => {
    expect(pollFromPayload(payload)).toEqual({ name: "Qual dia?", options: ["Segunda", "Terça"], multiple: true });
    expect(pollFromPayload({ data: { message: { conversation: "oi" } } })).toBeNull();
  });

  it("conta os votos e ignora voto retirado", () => {
    const poll = pollFromPayload(payload)!;
    const tally = tallyPoll(poll, {
      "1@lid": { options: ["Segunda", "Terça"], name: "Ana" },
      "2@lid": { options: ["Terça"] },
      "3@lid": { options: [] },
    });
    expect(tally.totalVoters).toBe(2);
    expect(tally.maxVotes).toBe(2);
    expect(tally.options.map((o) => o.voters.length)).toEqual([1, 2]);
  });
});
