import { describe, expect, it } from "vitest";
import {
  brazilianPhoneVariants,
  isPlaceholderName,
  normalizeTypedPhone,
  parseWhatsappNumbersResponse,
} from "./startConversation";

describe("normalizeTypedPhone", () => {
  it("adiciona o 55 em DDD + número", () => {
    expect(normalizeTypedPhone("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizeTypedPhone("1133334444")).toBe("551133334444");
  });
  it("mantém número com DDI", () => {
    expect(normalizeTypedPhone("+55 11 98765-4321")).toBe("5511987654321");
  });
  it("recusa o que não é telefone", () => {
    expect(normalizeTypedPhone("123")).toBeNull();
    expect(normalizeTypedPhone("")).toBeNull();
    expect(normalizeTypedPhone("123456789012345")).toBeNull();
  });
});

describe("brazilianPhoneVariants", () => {
  it("celular com 9 também procura sem o 9", () => {
    expect(brazilianPhoneVariants("5531987654321")).toEqual(["5531987654321", "553187654321"]);
  });
  it("celular sem 9 também procura com o 9", () => {
    expect(brazilianPhoneVariants("553187654321")).toEqual(["553187654321", "5531987654321"]);
  });
  it("fixo e estrangeiro ficam como estão", () => {
    expect(brazilianPhoneVariants("551133334444")).toEqual(["551133334444"]);
    expect(brazilianPhoneVariants("351912345678")).toEqual(["351912345678"]);
  });
});

describe("isPlaceholderName", () => {
  it("nome só com número conta como sem nome", () => {
    expect(isPlaceholderName("5511987654321")).toBe(true);
    expect(isPlaceholderName(null)).toBe(true);
    expect(isPlaceholderName("Ana")).toBe(false);
  });
});

describe("parseWhatsappNumbersResponse", () => {
  it("usa o número do jid", () => {
    expect(
      parseWhatsappNumbersResponse([{ exists: true, jid: "553187654321@s.whatsapp.net", number: "5531987654321" }]),
    ).toBe("553187654321");
  });
  it("número sem WhatsApp", () => {
    expect(parseWhatsappNumbersResponse([{ exists: false, jid: "5511987654321@s.whatsapp.net" }])).toBe(false);
  });
  it("resposta estranha não decide", () => {
    expect(parseWhatsappNumbersResponse(null)).toBeNull();
    expect(parseWhatsappNumbersResponse({})).toBeNull();
  });
});
