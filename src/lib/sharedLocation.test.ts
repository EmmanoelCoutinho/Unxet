import { describe, expect, it } from "vitest";
import { buildSharedLocation, parseCoordinates, sharedLocationText } from "./sharedLocation";
import {
  parseSharedLocation,
  sharedLocationText as serverLocationText,
} from "../../supabase/functions/_shared/sharedLocation";

describe("parseCoordinates", () => {
  it.each([
    ["-1.4558, -48.4902", -1.4558, -48.4902],
    ["-1.4558,-48.4902", -1.4558, -48.4902],
    ["https://www.google.com/maps/place/Teatro+da+Paz/@-1.4529531,-48.4955326,17z/data=x", -1.452953, -48.495533],
    ["https://maps.google.com/?q=-23.5505,-46.6333", -23.5505, -46.6333],
    ["https://www.google.com/maps/search/?api=1&query=-23.5505%2C-46.6333", -23.5505, -46.6333],
    ["https://www.google.com/maps/place/X/data=!3d-1.4529531!4d-48.4955326", -1.452953, -48.495533],
  ])("%s", (value, latitude, longitude) => {
    expect(parseCoordinates(value)).toEqual({ latitude, longitude });
  });

  it.each(["", "Rua das Flores, 10", "https://maps.app.goo.gl/AbCdEf", "200, 10", "0, 0"])(
    "%s não tem coordenadas válidas",
    (value) => {
      expect(parseCoordinates(value)).toBeNull();
    },
  );
});

describe("texto da localização", () => {
  it("o app e a edge function gravam o mesmo texto", () => {
    const raw = { latitude: -1.4558123456, longitude: -48.4902, name: "  Nossa   loja ", address: "Av. Nazaré, 100" };
    const app = buildSharedLocation(raw)!;
    const server = parseSharedLocation(raw)!;
    expect(app).toEqual(server);
    expect(sharedLocationText(app)).toBe(serverLocationText(server));
    expect(sharedLocationText(app)).toBe(
      "📍 Localização: Nossa loja - Av. Nazaré, 100\nhttps://maps.google.com/?q=-1.455812,-48.4902",
    );
  });

  it("sem nome nem endereço", () => {
    expect(sharedLocationText(buildSharedLocation({ latitude: 1, longitude: 2 })!)).toBe(
      "📍 Localização\nhttps://maps.google.com/?q=1,2",
    );
  });

  it("a edge function recusa coordenada inválida", () => {
    expect(parseSharedLocation({ latitude: "abc", longitude: 1 })).toBeNull();
    expect(parseSharedLocation({ latitude: 95, longitude: 1 })).toBeNull();
    expect(parseSharedLocation(null)).toBeNull();
  });
});
