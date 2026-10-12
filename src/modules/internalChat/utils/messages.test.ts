import { describe, expect, it } from "vitest";
import type { InternalMessage } from "../types/internalChat";
import {
  mergeLatestPage,
  sortInternalMessages,
  upsertInternalMessage,
} from "./messages";

const msg = (
  id: string,
  minute: number,
  extra: Partial<InternalMessage> = {},
): InternalMessage => ({
  id,
  threadId: "t1",
  senderId: "u1",
  body: id,
  createdAt: new Date(Date.UTC(2026, 9, 12, 10, minute)).toISOString(),
  ...extra,
});

const ids = (list: InternalMessage[]) => list.map((m) => m.id);

describe("sortInternalMessages", () => {
  it("ordena por horário e deixa os envios pendentes no fim", () => {
    const sorted = sortInternalMessages([
      msg("local", 0, { pending: true }),
      msg("b", 2),
      msg("a", 1),
    ]);
    expect(ids(sorted)).toEqual(["a", "b", "local"]);
  });
});

describe("upsertInternalMessage", () => {
  it("substitui o envio pendente pela mensagem confirmada", () => {
    const list = [msg("a", 1), msg("x", 5, { pending: true })];
    const next = upsertInternalMessage(list, msg("x", 2));
    expect(ids(next)).toEqual(["a", "x"]);
    expect(next[1].pending).toBeUndefined();
  });

  it("acrescenta mensagem nova", () => {
    expect(ids(upsertInternalMessage([msg("a", 1)], msg("b", 2)))).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("mergeLatestPage", () => {
  it("usa a página quando não havia nada", () => {
    const page = { messages: [msg("a", 1)], hasMore: false };
    expect(mergeLatestPage(undefined, page)).toBe(page);
  });

  it("mantém páginas antigas e envios não confirmados", () => {
    const prev = {
      messages: [msg("old", 0), msg("a", 1), msg("p", 9, { pending: true })],
      hasMore: false,
    };
    const page = { messages: [msg("a", 1), msg("b", 2)], hasMore: true };
    const merged = mergeLatestPage(prev, page);
    expect(ids(merged.messages)).toEqual(["old", "a", "b", "p"]);
    expect(merged.hasMore).toBe(false);
  });

  it("descarta o envio local que já voltou do banco", () => {
    const prev = { messages: [msg("p", 9, { pending: true })], hasMore: false };
    const page = { messages: [msg("p", 1)], hasMore: false };
    const merged = mergeLatestPage(prev, page);
    expect(ids(merged.messages)).toEqual(["p"]);
    expect(merged.messages[0].pending).toBeUndefined();
  });

  it("não emenda páginas sem mensagem em comum", () => {
    const prev = { messages: [msg("old", 0)], hasMore: false };
    const page = { messages: [msg("x", 30), msg("y", 31)], hasMore: true };
    const merged = mergeLatestPage(prev, page);
    expect(ids(merged.messages)).toEqual(["x", "y"]);
    expect(merged.hasMore).toBe(true);
  });
});
