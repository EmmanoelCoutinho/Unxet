import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import {
  canSetPassword,
  clearSetPasswordGrant,
  grantSetPassword,
  sessionFromRecentEmailLink,
} from "./passwordLink";

const nowSec = () => Math.floor(Date.now() / 1000);

const sessionWithAmr = (amr: Array<{ method: string; timestamp: number }>) =>
  ({
    access_token: `header.${Buffer.from(JSON.stringify({ amr })).toString("base64url")}.signature`,
  }) as unknown as Session;

describe("passwordLink", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bloqueia sessão comum (login com senha)", () => {
    expect(canSetPassword(sessionWithAmr([{ method: "password", timestamp: nowSec() }]))).toBe(false);
  });

  it("bloqueia quando não há sessão", () => {
    expect(canSetPassword(null)).toBe(false);
  });

  it.each(["recovery", "invite", "otp", "magiclink"])(
    "libera sessão recente criada por link de e-mail (%s)",
    (method) => {
      expect(canSetPassword(sessionWithAmr([{ method, timestamp: nowSec() }]))).toBe(true);
    },
  );

  it("bloqueia link de recuperação antigo (mais de 15 min)", () => {
    expect(
      sessionFromRecentEmailLink(sessionWithAmr([{ method: "recovery", timestamp: nowSec() - 3600 }])),
    ).toBe(false);
  });

  it("ignora token malformado", () => {
    expect(canSetPassword({ access_token: "sem-pontos" } as unknown as Session)).toBe(false);
  });

  it("libera com a marca do callback e bloqueia depois de limpar", () => {
    const session = sessionWithAmr([{ method: "password", timestamp: nowSec() }]);
    grantSetPassword();
    expect(canSetPassword(session)).toBe(true);
    clearSetPasswordGrant();
    expect(canSetPassword(session)).toBe(false);
  });
});
