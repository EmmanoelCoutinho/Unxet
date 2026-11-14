import { describe, expect, it } from "vitest";
import {
  brazilianPhoneVariants,
  findContactByPhone,
  pickContactByPhone,
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

describe("pickContactByPhone", () => {
  const comNove = { id: "a", phone: "5591991599439" };
  const semNove = { id: "b", phone: "559191599439" };
  it("prefere o telefone exatamente igual", () => {
    expect(pickContactByPhone([comNove, semNove], "559191599439")).toBe(semNove);
  });
  it("sem o exato, usa o cadastro na outra forma do número", () => {
    expect(pickContactByPhone([comNove], "559191599439")).toBe(comNove);
  });
  it("sem contato devolve null", () => {
    expect(pickContactByPhone([], "559191599439")).toBeNull();
    expect(pickContactByPhone(null, "559191599439")).toBeNull();
  });
});

describe("findContactByPhone", () => {
  const fakeSupabase = (rows: any[], error: any = null) => {
    const calls: any = {};
    const query: any = {
      select: () => query,
      eq: (column: string, value: string) => ((calls[column] = value), query),
      in: (column: string, values: string[]) => ((calls[column] = values), query),
      order: () => query,
      limit: async () => ({ data: error ? null : rows, error }),
    };
    return { calls, from: () => query };
  };

  it("cliente salvo com o 9 que escreve pelo número sem o 9 é o mesmo contato", async () => {
    const supabase = fakeSupabase([{ id: "a", phone: "5591991599439" }]);
    const { contact, error } = await findContactByPhone(supabase, "clinica", "559191599439");
    expect(error).toBeNull();
    expect(contact?.id).toBe("a");
    expect(supabase.calls.clinic_id).toBe("clinica");
    expect(supabase.calls.phone).toEqual(["559191599439", "5591991599439"]);
  });
  it("erro na consulta não devolve contato", async () => {
    const { contact, error } = await findContactByPhone(fakeSupabase([], { message: "x" }), "clinica", "559191599439");
    expect(contact).toBeNull();
    expect(error).toEqual({ message: "x" });
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
