import { describe, expect, it } from "vitest";
import { parseWhatsappFormatting as parse } from "./whatsappFormatting";

describe("parseWhatsappFormatting", () => {
  it("texto sem marcação fica igual", () => {
    expect(parse("olá, tudo bem?")).toEqual(["olá, tudo bem?"]);
    expect(parse("")).toEqual([]);
  });

  it("negrito, itálico, tachado e monoespaçado", () => {
    expect(parse("*Emmanoel Coutinho:*\nteste 12")).toEqual([
      { style: "bold", children: ["Emmanoel Coutinho:"] },
      "\nteste 12",
    ]);
    expect(parse("um _dois_ três")).toEqual([
      "um ",
      { style: "italic", children: ["dois"] },
      " três",
    ]);
    expect(parse("~caro~")).toEqual([{ style: "strike", children: ["caro"] }]);
    expect(parse("```a *b*\nc```")).toEqual([{ style: "mono", children: ["a *b*\nc"] }]);
  });

  it("combina estilos", () => {
    expect(parse("*_muito_ importante*")).toEqual([
      {
        style: "bold",
        children: [{ style: "italic", children: ["muito"] }, " importante"],
      },
    ]);
  });

  it("aceita pontuação em volta", () => {
    expect(parse("(*ok*), _sim_!")).toEqual([
      "(",
      { style: "bold", children: ["ok"] },
      "), ",
      { style: "italic", children: ["sim"] },
      "!",
    ]);
  });

  it("não formata marcador colado em palavra ou com espaço por dentro", () => {
    expect(parse("nome_do_arquivo.pdf")).toEqual(["nome_do_arquivo.pdf"]);
    expect(parse("2*3*4")).toEqual(["2*3*4"]);
    expect(parse("* item *")).toEqual(["* item *"]);
    expect(parse("**")).toEqual(["**"]);
    expect(parse("5 * 3 = 15")).toEqual(["5 * 3 = 15"]);
  });

  it("não atravessa linhas, exceto o monoespaçado", () => {
    expect(parse("*começo\nfim*")).toEqual(["*começo\nfim*"]);
  });

  it("marcador sem par fica como texto", () => {
    expect(parse("*Emmanoel Coutin")).toEqual(["*Emmanoel Coutin"]);
    expect(parse("preço: *10")).toEqual(["preço: *10"]);
  });
});
