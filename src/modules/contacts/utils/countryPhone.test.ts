import { describe, expect, it } from "vitest";
import { buildCountryPhone, PHONE_COUNTRIES, searchPhoneCountries } from "./countryPhone";

describe("buildCountryPhone", () => {
  it("Brasil segue a regra do DDD", () => {
    expect(buildCountryPhone("(11) 98765-4321", "BR")).toBe("5511987654321");
    expect(buildCountryPhone("11 3333-4444", "BR")).toBe("551133334444");
    expect(buildCountryPhone("123", "BR")).toBeNull();
  });

  it("outro país recebe o código escolhido", () => {
    expect(buildCountryPhone("7 45 51 36 37", "FR")).toBe("33745513637");
    // O 0 da frente (discagem nacional) sai
    expect(buildCountryPhone("07 45 51 36 37", "FR")).toBe("33745513637");
    expect(buildCountryPhone("912 345 678", "PT")).toBe("351912345678");
    expect(buildCountryPhone("(212) 555-1234", "US")).toBe("12125551234");
  });

  it("com + usa o número como foi digitado", () => {
    expect(buildCountryPhone("+33 7 45 51 36 37", "PT")).toBe("33745513637");
  });

  it("recusa número curto ou longo demais", () => {
    expect(buildCountryPhone("12", "FR")).toBeNull();
    expect(buildCountryPhone("12345678901234", "FR")).toBeNull();
  });
});

describe("searchPhoneCountries", () => {
  it("Brasil vem primeiro", () => {
    expect(PHONE_COUNTRIES[0].iso).toBe("BR");
  });

  it("acha por nome sem acento, sigla e código", () => {
    expect(searchPhoneCountries("franca").map((c) => c.iso)).toContain("FR");
    expect(searchPhoneCountries("FR").map((c) => c.iso)).toContain("FR");
    expect(searchPhoneCountries("+33").map((c) => c.iso)).toEqual(["FR"]);
    expect(searchPhoneCountries("zzz")).toEqual([]);
  });
});
