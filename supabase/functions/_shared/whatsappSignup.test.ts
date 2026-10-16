import { describe, expect, it } from "vitest";
import {
  extractWabaIds,
  metaErrorMessage,
  parsePhoneNumbers,
} from "./whatsappSignup";

describe("extractWabaIds (embedded signup do WhatsApp)", () => {
  it("lê os WABAs dos granular_scopes, management primeiro e sem repetição", () => {
    const debugData = {
      granular_scopes: [
        { scope: "business_management", target_ids: ["999"] },
        { scope: "whatsapp_business_messaging", target_ids: ["222", "111"] },
        { scope: "whatsapp_business_management", target_ids: ["111"] },
      ],
    };
    expect(extractWabaIds(debugData)).toEqual(["111", "222"]);
  });

  it("devolve lista vazia quando nada foi compartilhado", () => {
    expect(extractWabaIds({ granular_scopes: [] })).toEqual([]);
    expect(extractWabaIds({ granular_scopes: [{ scope: "whatsapp_business_management" }] })).toEqual([]);
    expect(extractWabaIds(undefined)).toEqual([]);
  });
});

describe("parsePhoneNumbers", () => {
  it("normaliza a resposta e descarta números incompletos", () => {
    const body = {
      data: [
        { id: "123", display_phone_number: "+55 11 99999-0000", verified_name: "Empresa" },
        { id: "456" },
      ],
    };
    expect(parsePhoneNumbers(body)).toEqual([
      { id: "123", displayPhoneNumber: "+55 11 99999-0000", verifiedName: "Empresa" },
    ]);
    expect(parsePhoneNumbers({})).toEqual([]);
  });
});

describe("metaErrorMessage", () => {
  it("prefere a mensagem para o usuário e cai para message", () => {
    expect(metaErrorMessage({ error: { message: "técnica", error_user_msg: "amigável" } })).toBe("amigável");
    expect(metaErrorMessage({ error: { message: "Code expirou" } })).toBe("Code expirou");
    expect(metaErrorMessage({})).toBe("");
  });
});
