import { describe, expect, it } from "vitest";
import { isGoogleMapsHost, shortMapsLink } from "./mapsLink";

describe("shortMapsLink", () => {
  it.each(["https://maps.app.goo.gl/AbCdEf123", " https://goo.gl/maps/AbC "])("%s é link curto", (value) => {
    expect(shortMapsLink(value)).not.toBeNull();
  });

  it.each([
    "http://maps.app.goo.gl/AbC",
    "https://goo.gl/AbC",
    "https://maps.app.goo.gl.evil.com/AbC",
    "https://www.google.com/maps/@-1,-48,17z",
    "javascript:alert(1)",
    "",
    null,
  ])("%s não é", (value) => {
    expect(shortMapsLink(value)).toBeNull();
  });
});

describe("isGoogleMapsHost", () => {
  it.each(["www.google.com", "google.com.br", "maps.google.com", "maps.app.goo.gl"])("%s é do Google", (host) => {
    expect(isGoogleMapsHost(host)).toBe(true);
  });

  it.each(["google.com.evil.com", "evilgoogle.com", "127.0.0.1", "metadata.google.internal"])("%s não é", (host) => {
    expect(isGoogleMapsHost(host)).toBe(false);
  });
});
