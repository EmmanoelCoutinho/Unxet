import { describe, expect, it } from "vitest";
import { locationMapsLinkFromText, pixFromText } from "./messageQuickActions";

const CODE =
  "00020101021226900014br.gov.bcb.pix2568pix.exemplo.com/loc/AbC123520400005303986" +
  "5802BR5913LOJA EXEMPLO6008BELEM62070503***6304ABCD";

describe("pixFromText", () => {
  it("código copia e cola, com os espaços do nome do recebedor", () => {
    expect(pixFromText(`  ${CODE}\n`)).toEqual({ value: CODE, kind: "code" });
    expect(pixFromText(CODE)?.value).toContain("LOJA EXEMPLO");
  });

  it("código no meio de outro texto não vira Pix", () => {
    expect(pixFromText(`Segue o pix:\n${CODE}`)).toBeNull();
  });

  it("chave Pix com tipo e recebedor", () => {
    expect(pixFromText("Chave Pix (CNPJ): 12.345.678/0001-90\nLoja Exemplo")).toEqual({
      value: "12.345.678/0001-90",
      kind: "key",
    });
  });

  it("chave Pix sem tipo", () => {
    expect(pixFromText("Chave Pix: loja@exemplo.com")?.value).toBe("loja@exemplo.com");
  });

  it("texto comum não vira Pix", () => {
    expect(pixFromText("Pode mandar o pix?")).toBeNull();
    expect(pixFromText("000201 é o começo do código")).toBeNull();
    expect(pixFromText("")).toBeNull();
  });
});

describe("locationMapsLinkFromText", () => {
  it("localização enviada pela Unxet", () => {
    expect(
      locationMapsLinkFromText("📍 Localização: Loja - Rua A, 10\nhttps://maps.google.com/?q=-1.4558,-48.4902"),
    ).toBe("https://www.google.com/maps/search/?api=1&query=-1.4558,-48.4902");
  });

  it("localização em tempo real recebida", () => {
    expect(
      locationMapsLinkFromText("📍 Localização em tempo real\nhttps://maps.google.com/?q=10,20"),
    ).toBe("https://www.google.com/maps/search/?api=1&query=10,20");
  });

  it("sem coordenadas ou sem o 📍 não mostra o botão", () => {
    expect(locationMapsLinkFromText("📍 Localização: Loja")).toBeNull();
    expect(locationMapsLinkFromText("olha https://maps.google.com/?q=1,2")).toBeNull();
  });
});
