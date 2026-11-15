import { describe, expect, it } from "vitest";
import { safeStorageContentType } from "./storageContentType";

describe("safeStorageContentType", () => {
  it("mantém imagem comum, áudio, vídeo, PDF e Office", () => {
    expect(safeStorageContentType("image/jpeg")).toBe("image/jpeg");
    expect(safeStorageContentType("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(safeStorageContentType("video/mp4")).toBe("video/mp4");
    expect(safeStorageContentType("application/pdf")).toBe("application/pdf");
    expect(
      safeStorageContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(safeStorageContentType("application/x-pkcs12")).toBe("application/x-pkcs12");
  });

  it("grava como texto puro o que o navegador interpretaria", () => {
    for (const mime of [
      "image/svg+xml",
      "text/html",
      "application/xhtml+xml",
      "application/xml",
      "text/xml",
      "text/csv",
      "application/x-ofx",
      "application/json",
      "application/javascript",
      "TEXT/HTML; charset=utf-8",
    ]) {
      expect(safeStorageContentType(mime)).toBe("text/plain");
    }
  });

  it("o resto só baixa", () => {
    expect(safeStorageContentType("application/x-msdownload")).toBe("application/octet-stream");
    expect(safeStorageContentType("application/x-sh")).toBe("application/octet-stream");
    expect(safeStorageContentType("image/bmp")).toBe("application/octet-stream");
    expect(safeStorageContentType("")).toBe("application/octet-stream");
    expect(safeStorageContentType(null)).toBe("application/octet-stream");
  });
});
