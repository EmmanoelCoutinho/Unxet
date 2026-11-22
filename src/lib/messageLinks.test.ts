import { describe, expect, it } from "vitest";
import { splitLinks } from "./messageLinks";

const links = (text: string) =>
  splitLinks(text)
    .filter((s) => s.kind === "link")
    .map((s) => (s.kind === "link" ? s.href : ""));

describe("splitLinks", () => {
  it("acha o link do mapa da localização", () => {
    const text = "📍 Localização: Loja - Av. Nazaré, 100\nhttps://maps.google.com/?q=-1.4558,-48.4902";
    expect(links(text)).toEqual(["https://maps.google.com/?q=-1.4558,-48.4902"]);
    expect(splitLinks(text).map((s) => s.value).join("")).toBe(text);
  });

  it("tira a pontuação do fim da frase", () => {
    expect(links("Veja em https://unxet.com.br.")).toEqual(["https://unxet.com.br"]);
    expect(links("(site: https://unxet.com.br/ajuda)")).toEqual(["https://unxet.com.br/ajuda"]);
    expect(links("https://pt.wikipedia.org/wiki/Bel%C3%A9m_(Par%C3%A1)")).toEqual([
      "https://pt.wikipedia.org/wiki/Bel%C3%A9m_(Par%C3%A1)",
    ]);
  });

  it("completa www. com https", () => {
    expect(links("acesse www.unxet.com.br agora")).toEqual(["https://www.unxet.com.br"]);
  });

  it("ignora o que não é link", () => {
    expect(links("www. e https:// sozinhos")).toEqual([]);
    expect(links("javascript:alert(1)")).toEqual([]);
    expect(links("texto sem link")).toEqual([]);
    expect(splitLinks("")).toEqual([]);
  });

  it("acha vários links", () => {
    expect(links("https://a.com e https://chat.whatsapp.com/AbC123")).toEqual([
      "https://a.com",
      "https://chat.whatsapp.com/AbC123",
    ]);
  });
});
