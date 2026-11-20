// Localização enviada no chat do WhatsApp (QR Code). Mesmas regras de
// supabase/functions/_shared/sharedLocation.ts: a edge function valida de novo
// e grava a mensagem como texto neste formato.

export type SharedLocation = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};

const MAX_NAME = 100;
const MAX_ADDRESS = 200;

const NUMBER = String.raw`-?\d{1,3}(?:\.\d+)?`;
// "lat,lng" solto ou nos formatos de link do Google Maps:
// ...@-1.4558,-48.4902,17z | ...?q=-1.4558,-48.4902 | !3d-1.4558!4d-48.4902
const PATTERNS = [
  new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`),
  new RegExp(String.raw`@(${NUMBER}),\s*(${NUMBER})`),
  new RegExp(String.raw`[?&](?:q|query|ll|destination)=(${NUMBER}),\s*(${NUMBER})`),
  new RegExp(String.raw`^\s*(${NUMBER})\s*[,;\s]\s*(${NUMBER})\s*$`),
];

const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180 &&
  !(lat === 0 && lng === 0);

const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Coordenadas de um link do Google Maps ou de "latitude, longitude". */
export function parseCoordinates(
  raw: string,
): { latitude: number; longitude: number } | null {
  let value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    // link com % solto: usa como veio
  }
  for (const pattern of PATTERNS) {
    const match = value.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (valid(latitude, longitude)) {
      return { latitude: round(latitude), longitude: round(longitude) };
    }
  }
  return null;
}

const cleanText = (value: string | undefined, max: number) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max).trim() : undefined;
};

export function buildSharedLocation(params: {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}): SharedLocation | null {
  if (!valid(params.latitude, params.longitude)) return null;
  return {
    latitude: round(params.latitude),
    longitude: round(params.longitude),
    name: cleanText(params.name, MAX_NAME),
    address: cleanText(params.address, MAX_ADDRESS),
  };
}

export function sharedLocationMapsUrl(location: SharedLocation): string {
  return `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
}

export function sharedLocationText(location: SharedLocation): string {
  const place = [location.name, location.address].filter(Boolean).join(" - ");
  return `📍 Localização${place ? `: ${place}` : ""}\n${sharedLocationMapsUrl(location)}`;
}
