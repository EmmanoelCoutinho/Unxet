import { describe, expect, it } from "vitest";
import {
  createCheckThrottle,
  imageHash,
  isCurrentProfilePic,
  profilePicPath,
} from "./profilePicture";

describe("profilePicPath", () => {
  it("usa o hash no nome e a extensão do tipo", () => {
    expect(profilePicPath("c1", "5511999", "abc", "image/jpeg")).toBe(
      "c1/5511999/profile/abc.jpg",
    );
    expect(profilePicPath("c1", "5511999", "abc", "image/png")).toBe(
      "c1/5511999/profile/abc.png",
    );
  });
});

describe("isCurrentProfilePic", () => {
  const path = "c1/5511999/profile/abc.jpg";
  it("reconhece a mesma foto", () => {
    expect(
      isCurrentProfilePic(
        `https://x.supabase.co/storage/v1/object/public/whatsapp-media/${path}`,
        path,
      ),
    ).toBe(true);
  });
  it("foto antiga ou sem foto conta como diferente", () => {
    expect(
      isCurrentProfilePic(
        "https://x.supabase.co/storage/v1/object/public/whatsapp-media/c1/5511999/profile/avatar.jpg",
        path,
      ),
    ).toBe(false);
    expect(isCurrentProfilePic(null, path)).toBe(false);
  });
});

describe("imageHash", () => {
  it("muda quando a imagem muda", async () => {
    const a = await imageHash(new Uint8Array([1, 2, 3]).buffer);
    const b = await imageHash(new Uint8Array([1, 2, 4]).buffer);
    expect(a).toHaveLength(16);
    expect(a).toBe(await imageHash(new Uint8Array([1, 2, 3]).buffer));
    expect(a).not.toBe(b);
  });
});

describe("createCheckThrottle", () => {
  it("confere de novo só depois do intervalo, por contato", () => {
    const shouldCheck = createCheckThrottle(1000);
    expect(shouldCheck("a", 0)).toBe(true);
    expect(shouldCheck("a", 500)).toBe(false);
    expect(shouldCheck("b", 500)).toBe(true);
    expect(shouldCheck("a", 1000)).toBe(true);
  });
});
