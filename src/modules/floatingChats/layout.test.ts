import { describe, expect, it } from "vitest";
import {
  BOX_GAP,
  BOX_WIDTH,
  MAX_BOXES,
  MINIMIZED_WIDTH,
  OVERFLOW_WIDTH,
  layoutBoxes,
  openBox,
  parseStoredBoxes,
  type FloatingBox,
} from "./layout";

const box = (id: string, minimized = false): FloatingBox => ({
  id,
  minimized,
  title: id,
});

describe("layoutBoxes", () => {
  it("mostra todas quando cabem", () => {
    const boxes = [box("a"), box("b", true)];
    const { visible, overflow } = layoutBoxes(
      boxes,
      BOX_WIDTH + BOX_GAP + MINIMIZED_WIDTH,
    );
    expect(visible.map((b) => b.id)).toEqual(["a", "b"]);
    expect(overflow).toEqual([]);
  });

  it("manda as que não cabem para o +N, reservando o botão", () => {
    const boxes = [box("a"), box("b"), box("c")];
    // Cabem duas caixas, mas não duas caixas + o botão
    const width = BOX_WIDTH * 2 + BOX_GAP;
    const { visible, overflow } = layoutBoxes(boxes, width);
    expect(visible.map((b) => b.id)).toEqual(["a"]);
    expect(overflow.map((b) => b.id)).toEqual(["b", "c"]);

    const wider = layoutBoxes(boxes, width + BOX_GAP + OVERFLOW_WIDTH);
    expect(wider.visible.map((b) => b.id)).toEqual(["a", "b"]);
    expect(wider.overflow.map((b) => b.id)).toEqual(["c"]);
  });

  it("sempre mostra a primeira caixa", () => {
    const { visible } = layoutBoxes([box("a"), box("b")], 100);
    expect(visible.map((b) => b.id)).toEqual(["a"]);
  });
});

describe("openBox", () => {
  it("coloca a conversa no canto, expandida, sem duplicar", () => {
    const boxes = [box("a"), box("b", true)];
    const next = openBox(boxes, "b", "");
    expect(next.map((b) => [b.id, b.minimized])).toEqual([
      ["b", false],
      ["a", false],
    ]);
    expect(next[0].title).toBe("b");
  });

  it("fecha a mais antiga acima do limite", () => {
    let boxes: FloatingBox[] = [];
    for (let i = 0; i < MAX_BOXES + 2; i++) boxes = openBox(boxes, `c${i}`, "");
    expect(boxes).toHaveLength(MAX_BOXES);
    expect(boxes[0].id).toBe(`c${MAX_BOXES + 1}`);
    expect(boxes.some((b) => b.id === "c0")).toBe(false);
  });
});

describe("parseStoredBoxes", () => {
  it("ignora lixo e duplicadas", () => {
    expect(parseStoredBoxes("x")).toEqual([]);
    expect(
      parseStoredBoxes([
        { id: "a", minimized: true, title: "Ana" },
        { id: "a" },
        null,
        { id: 3 },
        { id: "b" },
      ]),
    ).toEqual([
      { id: "a", minimized: true, title: "Ana" },
      { id: "b", minimized: false, title: "" },
    ]);
  });
});
