import { describe, expect, it } from "vitest";
import { detectEnvironment } from "./environment";

describe("detectEnvironment", () => {
  it("produção só com o projeto da produção", () => {
    expect(
      detectEnvironment("https://karmtrldanuxqisgzlhk.supabase.co"),
    ).toBe("production");
  });

  it("develop para qualquer outro projeto ou valor vazio", () => {
    expect(detectEnvironment("https://ketolvqnptmdczkzrqba.supabase.co")).toBe(
      "develop",
    );
    expect(detectEnvironment(undefined)).toBe("develop");
  });

  it("local para o Supabase da máquina", () => {
    expect(detectEnvironment("http://127.0.0.1:54321")).toBe("local");
    expect(detectEnvironment("http://localhost:54321")).toBe("local");
  });
});
