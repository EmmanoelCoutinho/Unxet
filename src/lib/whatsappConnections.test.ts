import { describe, expect, it } from "vitest";
import {
  formatConnectionPhone,
  whatsappConnectionLabel,
} from "./whatsappConnections";

describe("formatConnectionPhone", () => {
  it("formata celular e fixo brasileiros com DDI", () => {
    expect(formatConnectionPhone("5511987654321@s.whatsapp.net")).toBe(
      "+55 (11) 98765-4321",
    );
    expect(formatConnectionPhone("551132654321")).toBe("+55 (11) 3265-4321");
  });

  it("formata número sem DDI e devolve o resto como veio", () => {
    expect(formatConnectionPhone("11987654321")).toBe("(11) 98765-4321");
    expect(formatConnectionPhone("1132654321")).toBe("(11) 3265-4321");
    expect(formatConnectionPhone("447911123456")).toBe("447911123456");
  });

  it("vazio vira null", () => {
    expect(formatConnectionPhone(null)).toBeNull();
    expect(formatConnectionPhone("   ")).toBeNull();
  });
});

describe("whatsappConnectionLabel", () => {
  it("prefere o apelido", () => {
    expect(
      whatsappConnectionLabel({
        display_name: " Recepção ",
        connected_phone: "5511987654321",
      }),
    ).toBe("Recepção");
  });

  it("sem apelido, usa o telefone e depois o nome do perfil", () => {
    expect(
      whatsappConnectionLabel({ connected_phone: "5511987654321" }),
    ).toBe("+55 (11) 98765-4321");
    expect(whatsappConnectionLabel({ connected_name: "Clínica" })).toBe(
      "Clínica",
    );
  });

  it("sem nada, usa o texto padrão", () => {
    expect(whatsappConnectionLabel(null)).toBe("WhatsApp");
    expect(whatsappConnectionLabel({}, "Número")).toBe("Número");
  });
});
