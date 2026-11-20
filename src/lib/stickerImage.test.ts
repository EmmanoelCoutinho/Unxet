import { describe, expect, it } from "vitest";
import { fitInSquare } from "./stickerImage";

describe("fitInSquare", () => {
  it("imagem larga fica centralizada na altura", () => {
    expect(fitInSquare(1024, 512)).toEqual({ x: 0, y: 128, width: 512, height: 256 });
  });

  it("imagem alta fica centralizada na largura", () => {
    expect(fitInSquare(300, 600)).toEqual({ x: 128, y: 0, width: 256, height: 512 });
  });

  it("imagem pequena cresce até o quadrado", () => {
    expect(fitInSquare(100, 100)).toEqual({ x: 0, y: 0, width: 512, height: 512 });
  });

  it("tamanho inválido ocupa o quadrado", () => {
    expect(fitInSquare(0, 0)).toEqual({ x: 0, y: 0, width: 512, height: 512 });
  });
});
