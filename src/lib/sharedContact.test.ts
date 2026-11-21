import { describe, expect, it } from "vitest";
import { buildSharedContact, sharedContactFromText, sharedContactText } from "./sharedContact";

describe("sharedContactFromText (Reenviar)", () => {
  it("lê de volta o texto gravado no envio", () => {
    const contact = buildSharedContact("Maria - Financeiro", "+55 91 98888-7777")!;
    expect(sharedContactFromText(sharedContactText(contact))).toEqual(contact);
  });

  it("texto comum não é contato", () => {
    expect(sharedContactFromText("Me liga no +5591988887777")).toBeNull();
    expect(sharedContactFromText("👤 Contato: Maria - sem número")).toBeNull();
    expect(sharedContactFromText(null)).toBeNull();
  });
});
