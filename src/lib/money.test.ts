import { describe, expect, it } from "vitest";
import { moneyInput, parseMoney } from "./money";

describe("parseMoney", () => {
  it("aceita os formatos brasileiros e o ponto decimal", () => {
    expect(parseMoney("199,90")).toBe(199.9);
    expect(parseMoney("1.299,90")).toBe(1299.9);
    expect(parseMoney("199.90")).toBe(199.9);
    expect(parseMoney("R$ 50")).toBe(50);
    expect(parseMoney("1.299")).toBe(1299);
    expect(parseMoney("12.000.000")).toBe(12000000);
    expect(parseMoney("1.5")).toBe(1.5);
    expect(parseMoney("  ")).toBeNull();
    expect(parseMoney("abc")).toBeNaN();
  });
});

describe("moneyInput", () => {
  it("volta para vírgula", () => {
    expect(moneyInput(199.9)).toBe("199,90");
    expect(moneyInput(1299.9)).toBe("1.299,90");
    expect(parseMoney(moneyInput(1299.9))).toBe(1299.9);
    expect(moneyInput(null)).toBe("");
  });
});
