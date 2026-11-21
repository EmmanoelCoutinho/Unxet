import { describe, expect, it, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ supabase: {} }));

import { stickerPathFromUrl } from "./stickerFavorites";

const CLINIC = "00000000-0000-0000-0000-0000000000c1";
const HASH = "a".repeat(64);

describe("stickerPathFromUrl", () => {
  it("URL pública da figurinha guardada na pasta da empresa", () => {
    expect(
      stickerPathFromUrl(`https://x.supabase.co/storage/v1/object/public/whatsapp-media/${CLINIC}/stickers/${HASH}.webp`),
    ).toBe(`${CLINIC}/stickers/${HASH}.webp`);
  });

  it("URL assinada (com token) também vale", () => {
    expect(
      stickerPathFromUrl(`http://127.0.0.1:54321/storage/v1/object/sign/whatsapp-media/${CLINIC}/stickers/${HASH}.png?token=abc`),
    ).toBe(`${CLINIC}/stickers/${HASH}.png`);
  });

  it("figurinha antiga, fora da pasta stickers, não pode ser favoritada", () => {
    expect(
      stickerPathFromUrl(`https://x.supabase.co/storage/v1/object/public/whatsapp-media/${CLINIC}/conv/123/sticker.webp`),
    ).toBeNull();
    expect(stickerPathFromUrl(`https://x.supabase.co/storage/v1/object/public/outro/${CLINIC}/stickers/${HASH}.webp`)).toBeNull();
    expect(stickerPathFromUrl("não é url")).toBeNull();
    expect(stickerPathFromUrl(null)).toBeNull();
  });
});
