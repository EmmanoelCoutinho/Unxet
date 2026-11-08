import { describe, expect, it } from "vitest";
import { aiUsageLevel, aiWarningThreshold } from "../lib/aiUsage";

describe("aiUsageLevel", () => {
  it("avisa a partir de 80% e marca esgotado no limite", () => {
    expect(aiUsageLevel(799, 1000)).toBe("ok");
    expect(aiUsageLevel(800, 1000)).toBe("warning");
    expect(aiUsageLevel(999, 1000)).toBe("warning");
    expect(aiUsageLevel(1000, 1000)).toBe("exhausted");
    // Limite aumentado no meio do mês: volta a ficar ok
    expect(aiUsageLevel(1000, 5000)).toBe("ok");
  });

  it("arredonda o aviso para cima, como no banco", () => {
    expect(aiWarningThreshold(50)).toBe(40);
    expect(aiWarningThreshold(55)).toBe(44);
  });
});
