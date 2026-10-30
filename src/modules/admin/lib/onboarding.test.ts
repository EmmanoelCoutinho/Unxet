import { describe, expect, it } from "vitest";
import { remainingExtraSlots, validateExtraAccounts } from "./onboarding";

const essencial = { name: "Essencial", max_attendants: 3 };
const empresarial = { name: "Empresarial", max_attendants: null };

describe("remainingExtraSlots", () => {
  it("desconta o primeiro usuário e as contas já adicionadas", () => {
    expect(remainingExtraSlots(3, 0)).toBe(2);
    expect(remainingExtraSlots(3, 2)).toBe(0);
    expect(remainingExtraSlots(3, 5)).toBe(0);
  });

  it("plano sem limite não tem teto", () => {
    expect(remainingExtraSlots(null, 40)).toBeNull();
  });
});

describe("validateExtraAccounts", () => {
  it("aceita contas dentro do limite", () => {
    expect(
      validateExtraAccounts(
        "dono@empresa.com",
        [
          { name: "Ana", email: "ana@empresa.com" },
          { name: "Bia", email: "bia@empresa.com" },
        ],
        essencial,
      ),
    ).toBeNull();
  });

  it("barra contas além do plano", () => {
    const extras = ["a", "b", "c"].map((n) => ({
      name: n,
      email: `${n}@empresa.com`,
    }));
    expect(validateExtraAccounts("dono@empresa.com", extras, essencial)).toMatch(
      /até 3 contas.*Remova 1/,
    );
    expect(
      validateExtraAccounts("dono@empresa.com", extras, empresarial),
    ).toBeNull();
  });

  it("barra e-mail repetido, inclusive o do primeiro usuário", () => {
    expect(
      validateExtraAccounts(
        "Dono@Empresa.com",
        [{ name: "Ana", email: "dono@empresa.com " }],
        essencial,
      ),
    ).toMatch(/Conta 2: o e-mail dono@empresa.com já está na lista/);
  });

  it("exige nome e e-mail válido", () => {
    expect(
      validateExtraAccounts("d@e.com", [{ name: " ", email: "a@e.com" }], null),
    ).toBe("Conta 2: informe o nome.");
    expect(
      validateExtraAccounts("d@e.com", [{ name: "Ana", email: "ana" }], null),
    ).toBe("Conta 2: informe um e-mail válido.");
  });
});
