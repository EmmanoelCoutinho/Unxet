import { describe, expect, it } from "vitest";
import { isClinicStickerPath, stickerHash, stickerStoragePath } from "./stickerStore";
import { parseEvolutionContent } from "./evolutionContent";

const sha = Array.from({ length: 32 }, (_, i) => i * 7 % 256);
const shaObj = Object.fromEntries(sha.map((b, i) => [String(i), b]));
const hex = sha.map((b) => b.toString(16).padStart(2, "0")).join("");
const clinic = "3f1c2a10-5b6e-4c7d-8e9f-0a1b2c3d4e5f";

describe("stickerHash", () => {
  it("hash do arquivo em hex (objeto da Evolution, lista ou base64)", () => {
    expect(stickerHash({ fileSha256: shaObj })).toBe(hex);
    expect(stickerHash({ fileSha256: sha })).toBe(hex);
    expect(stickerHash({ fileSha256: btoa(String.fromCharCode(...sha)) })).toBe(hex);
  });

  it("sem hash ou com tamanho errado", () => {
    expect(stickerHash({})).toBeNull();
    expect(stickerHash({ fileSha256: [1, 2, 3] })).toBeNull();
    expect(stickerHash(null)).toBeNull();
  });
});

describe("caminho da figurinha", () => {
  it("um arquivo por figurinha, na pasta da empresa", () => {
    expect(stickerStoragePath(clinic, hex)).toBe(`${clinic}/stickers/${hex}.webp`);
  });

  it("só aceita figurinha da própria empresa", () => {
    expect(isClinicStickerPath(`${clinic}/stickers/${hex}.webp`, clinic)).toBe(true);
    expect(isClinicStickerPath(`outra-empresa/stickers/${hex}.webp`, clinic)).toBe(false);
    expect(isClinicStickerPath(`${clinic}/stickers/../x/${hex}.webp`, clinic)).toBe(false);
    expect(isClinicStickerPath(`${clinic}/5511999/inbound-images/a.webp`, clinic)).toBe(false);
    expect(isClinicStickerPath(undefined, clinic)).toBe(false);
  });
});

describe("parser", () => {
  it("figurinha leva o hash junto", () => {
    expect(parseEvolutionContent({ stickerMessage: { mimetype: "image/webp", fileSha256: shaObj } }, "S1"))
      .toMatchObject({ messageType: "image", stickerHash: hex });
  });

  it("figurinha animada (lottie) também", () => {
    expect(parseEvolutionContent({ lottieStickerMessage: { message: { stickerMessage: { fileSha256: sha } } } }, "S2"))
      .toMatchObject({ messageType: "image", stickerHash: hex });
  });
});
