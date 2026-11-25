import { describe, expect, it } from "vitest";
import {
  attachmentLabel,
  classifyInternalFile,
  extensionOf,
  formatFileSize,
  internalAttachmentPath,
  messagePreview,
} from "./attachments";

const file = (name: string, type: string, size = 1000) => ({ name, type, size });
const MB = 1024 * 1024;

describe("classifyInternalFile", () => {
  it("mostra na conversa as imagens que o bucket aceita", () => {
    expect(classifyInternalFile(file("foto.PNG", "image/png"))).toEqual({
      ok: true,
      kind: "image",
      contentType: "image/png",
      extension: "png",
    });
  });

  it("trata áudio gravado como áudio, com a extensão do tipo", () => {
    expect(
      classifyInternalFile(file("", "audio/webm;codecs=opus")),
    ).toMatchObject({ ok: true, kind: "audio", contentType: "audio/webm", extension: "webm" });
  });

  it("grava HTML e SVG como binário, para não rodar script ao abrir", () => {
    expect(classifyInternalFile(file("pagina.html", "text/html"))).toMatchObject({
      ok: true,
      kind: "file",
      contentType: "application/octet-stream",
      extension: "html",
    });
    expect(classifyInternalFile(file("logo.svg", "image/svg+xml"))).toMatchObject({
      kind: "file",
      contentType: "application/octet-stream",
    });
  });

  it("mantém o tipo de documentos conhecidos", () => {
    expect(classifyInternalFile(file("laudo.pdf", "application/pdf"))).toMatchObject({
      kind: "file",
      contentType: "application/pdf",
    });
  });

  it("recusa arquivo vazio ou grande demais", () => {
    expect(classifyInternalFile(file("a.txt", "text/plain", 0)).ok).toBe(false);
    expect(classifyInternalFile(file("a.jpg", "image/jpeg", 11 * MB)).ok).toBe(false);
    expect(classifyInternalFile(file("a.zip", "application/zip", 51 * MB)).ok).toBe(false);
    expect(classifyInternalFile(file("a.zip", "application/zip", 49 * MB)).ok).toBe(true);
  });
});

describe("extensionOf", () => {
  it("só aceita extensões simples", () => {
    expect(extensionOf("relatorio.final.XLSX")).toBe("xlsx");
    expect(extensionOf(".bashrc")).toBe("");
    expect(extensionOf("x.a/b")).toBe("");
  });
});

describe("internalAttachmentPath", () => {
  it("fica na pasta da conversa", () => {
    expect(internalAttachmentPath("c1", "t1", "pdf")).toMatch(
      /^c1\/internal-chat\/t1\/[0-9a-f-]{36}\.pdf$/,
    );
  });
});

describe("prévia", () => {
  it("usa o texto ou, sem texto, o tipo do anexo", () => {
    expect(messagePreview({ body: "oi", attachment: null })).toBe("oi");
    expect(
      messagePreview({
        body: "",
        attachment: { kind: "file", path: "p", name: "laudo.pdf", mime: null, size: null },
      }),
    ).toBe("📎 laudo.pdf");
    expect(attachmentLabel({ kind: "audio", name: null })).toBe("🎤 Áudio");
  });

  it("formata o tamanho do arquivo", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1.5 * MB)).toBe("1,5 MB");
  });
});
