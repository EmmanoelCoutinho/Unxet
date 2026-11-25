import { describe, expect, it } from "vitest";
import {
  DOCK_EXPANDED_WIDTH,
  DOCK_GAP,
  DOCK_MINIMIZED_WIDTH,
  internalDockWidth,
  parseStoredDock,
} from "./dockStore";

describe("parseStoredDock", () => {
  it("volta minimizada sem conversa quando não há nada salvo", () => {
    expect(parseStoredDock(null)).toEqual({ expanded: false, threadId: null });
    expect(parseStoredDock("lixo")).toEqual({ expanded: false, threadId: null });
  });

  it("aceita só valores válidos", () => {
    expect(parseStoredDock({ expanded: true, threadId: "t1" })).toEqual({
      expanded: true,
      threadId: "t1",
    });
    expect(parseStoredDock({ expanded: "sim", threadId: 42 })).toEqual({
      expanded: false,
      threadId: null,
    });
    expect(parseStoredDock({ expanded: true, threadId: "" })).toEqual({
      expanded: true,
      threadId: null,
    });
  });
});

describe("internalDockWidth", () => {
  it("não ocupa espaço fora da tela", () => {
    expect(
      internalDockWidth({ available: false, expanded: true, threadId: null }),
    ).toBe(0);
  });

  it("reserva a largura da aba ou da janela aberta, com o espaço entre as caixas", () => {
    expect(
      internalDockWidth({ available: true, expanded: false, threadId: null }),
    ).toBe(DOCK_MINIMIZED_WIDTH + DOCK_GAP);
    expect(
      internalDockWidth({ available: true, expanded: true, threadId: "t1" }),
    ).toBe(DOCK_EXPANDED_WIDTH + DOCK_GAP);
  });
});
