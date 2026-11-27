import { describe, expect, it } from "vitest";
import { storageFileName } from "./storageFileName";

describe("storageFileName", () => {
  it("tira acento, ç e ° dos nomes que o Storage recusava", () => {
    expect(storageFileName("Orçamento n. 233-2026 (I C MELO & CIA LTDA).pdf", "x.pdf"))
      .toBe("Orcamento n. 233-2026 (I C MELO _ CIA LTDA).pdf");
    expect(storageFileName("CERTIDÃO NOAH.pdf", "x.pdf")).toBe("CERTIDAO NOAH.pdf");
    expect(storageFileName("FORMULÁRIO INFORMAÇÕES TRIBUTÁRIAS.odt", "x.odt"))
      .toBe("FORMULARIO INFORMACOES TRIBUTARIAS.odt");
    expect(storageFileName("LEI N° 7.116, DE 29 DE AGOSTO DE 1983.pdf", "x.pdf"))
      .toBe("LEI N_ 7.116_ DE 29 DE AGOSTO DE 1983.pdf");
  });

  it("mantém nome que já era aceito", () => {
    expect(storageFileName("CamScanner 24-11-2026 14.11.pdf", "x.pdf")).toBe("CamScanner 24-11-2026 14.11.pdf");
    expect(storageFileName("NFS-E-KAILU_.pdf", "x.pdf")).toBe("NFS-E-KAILU_.pdf");
  });

  it("sem nome que preste usa o reserva", () => {
    expect(storageFileName("", "abc.pdf")).toBe("abc.pdf");
    expect(storageFileName(null, "abc.pdf")).toBe("abc.pdf");
    expect(storageFileName("文件", "abc.pdf")).toBe("abc.pdf");
    expect(storageFileName("../..", "abc.pdf")).toBe("abc.pdf");
  });

  it("não deixa barra nem ponto no começo virar pasta", () => {
    expect(storageFileName("a/b\\c.pdf", "x.pdf")).toBe("a_b_c.pdf");
    expect(storageFileName("..segredo.pdf", "x.pdf")).toBe("segredo.pdf");
  });

  it("nome comprido é cortado sem perder a extensão", () => {
    const name = storageFileName(`${"a".repeat(300)}.pdf`, "x.pdf");
    expect(name.length).toBe(120);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});
