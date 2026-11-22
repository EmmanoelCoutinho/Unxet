import { describe, expect, it } from "vitest";
import {
  documentIsValid,
  formatCompanyPhone,
  formatDocument,
  formatPostalCode,
  profileFromClinic,
  validateCompanyProfile,
} from "./companyProfile";

describe("companyProfile", () => {
  it("formata CPF e CNPJ enquanto digita", () => {
    expect(formatDocument("529982247")).toBe("529.982.247");
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("confere os dígitos de CPF e CNPJ", () => {
    expect(documentIsValid("529.982.247-25")).toBe(true);
    expect(documentIsValid("529.982.247-24")).toBe(false);
    expect(documentIsValid("11.222.333/0001-81")).toBe(true);
    expect(documentIsValid("11.222.333/0001-80")).toBe(false);
    expect(documentIsValid("11111111111")).toBe(false);
  });

  it("formata telefone com ou sem o 55", () => {
    expect(formatCompanyPhone("5511987654321")).toBe("(11) 98765-4321");
    expect(formatCompanyPhone("1133334444")).toBe("(11) 3333-4444");
    expect(formatCompanyPhone("11")).toBe("(11");
  });

  it("formata CEP", () => {
    expect(formatPostalCode("01310100")).toBe("01310-100");
    expect(formatPostalCode("013")).toBe("013");
  });

  it("valida o formulário", () => {
    const empty = profileFromClinic({ name: "" });
    expect(validateCompanyProfile(empty)).toEqual({ name: "Informe o nome da empresa." });

    const filled = profileFromClinic({
      name: "Unxet",
      document: "11222333000181",
      phone: "5511987654321",
      email: "contato@unxet.com.br",
      website: "unxet.com.br",
      postal_code: "01310100",
      state: "SP",
    });
    expect(validateCompanyProfile(filled)).toEqual({});

    const wrong = { ...filled, email: "contato", website: "unxet", postal_code: "0131", phone: "119" };
    expect(Object.keys(validateCompanyProfile(wrong)).sort()).toEqual(
      ["email", "phone", "postal_code", "website"],
    );
  });
});
