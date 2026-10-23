import { describe, expect, it } from "vitest";
import {
  metaContactsText,
  normalizeContactPhone,
  parseSharedContact,
  sharedContactText,
  toEvolutionContact,
  toMetaContact,
} from "./contactCard";

describe("normalizeContactPhone", () => {
  it("adiciona o 55 em número brasileiro com DDD", () => {
    expect(normalizeContactPhone("(11) 99999-8888")).toBe("5511999998888");
    expect(normalizeContactPhone("11 3333-4444")).toBe("551133334444");
  });

  it("mantém número que já tem DDI", () => {
    expect(normalizeContactPhone("+55 11 99999-8888")).toBe("5511999998888");
    expect(normalizeContactPhone("+1 415 555 0100")).toBe("14155550100");
    expect(normalizeContactPhone("+5511999998888")).toBe("5511999998888");
    expect(normalizeContactPhone("5511999998888")).toBe("5511999998888");
  });

  it("recusa número inválido e trata sem + como brasileiro", () => {
    expect(normalizeContactPhone("99999-8888")).toBeNull();
    expect(normalizeContactPhone("1234567890123456")).toBeNull();
    expect(normalizeContactPhone("999911988887777")).toBeNull();
    expect(normalizeContactPhone("14155550100")).toBe("5514155550100");
    expect(normalizeContactPhone(null)).toBeNull();
  });
});

describe("parseSharedContact", () => {
  it("exige nome e telefone válidos", () => {
    expect(parseSharedContact({ name: "  Ana  ", phone: "11999998888" })).toEqual({
      name: "Ana",
      phone: "5511999998888",
    });
    expect(parseSharedContact({ name: "", phone: "11999998888" })).toBeNull();
    expect(parseSharedContact({ name: "Ana", phone: "123" })).toBeNull();
    expect(parseSharedContact("Ana")).toBeNull();
  });
});

describe("formatos de envio", () => {
  const contact = { name: "Recepção Centro", phone: "5511999998888" };

  it("gera o texto do histórico", () => {
    expect(sharedContactText(contact)).toBe(
      "👤 Contato: Recepção Centro - +5511999998888",
    );
  });

  it("monta o contato da Evolution", () => {
    expect(toEvolutionContact(contact)).toEqual({
      fullName: "Recepção Centro",
      wuid: "5511999998888",
      phoneNumber: "+5511999998888",
    });
  });

  it("monta o contato da Cloud API", () => {
    expect(toMetaContact(contact)).toEqual({
      name: {
        formatted_name: "Recepção Centro",
        first_name: "Recepção",
        last_name: "Centro",
      },
      phones: [{ phone: "+5511999998888", wa_id: "5511999998888", type: "CELL" }],
    });
    expect(toMetaContact({ name: "Ana", phone: "5511999998888" }).name).toEqual({
      formatted_name: "Ana",
      first_name: "Ana",
    });
  });
});

describe("metaContactsText", () => {
  it("converte contatos recebidos pela Cloud API", () => {
    const message = {
      type: "contacts",
      contacts: [
        {
          name: { formatted_name: "Maria Silva", first_name: "Maria" },
          phones: [{ phone: "+55 11 99999-8888", wa_id: "5511999998888" }],
        },
        { name: { first_name: "João", last_name: "Souza" }, phones: [{ wa_id: "5511977776666" }] },
      ],
    };
    expect(metaContactsText(message)).toBe(
      "👤 Contato: Maria Silva - +55 11 99999-8888\n👤 Contato: João Souza - +5511977776666",
    );
  });

  it("não fica vazio sem contatos", () => {
    expect(metaContactsText({ type: "contacts" })).toBe("👤 Contato compartilhado");
  });
});
