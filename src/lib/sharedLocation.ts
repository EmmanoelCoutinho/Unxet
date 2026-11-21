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
const COMMA_NUMBER = String.raw`-?\d{1,3},\d+`;
// "lat,lng" solto ou nos formatos de link do Google Maps:
// ...@-1.4558,-48.4902,17z | ...?q=-1.4558,-48.4902 | !3d-1.4558!4d-48.4902
const PATTERNS = [
  new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`),
  new RegExp(String.raw`@(${NUMBER}),\s*(${NUMBER})`),
  new RegExp(String.raw`[?&](?:q|query|ll|destination)=(${NUMBER}),\s*(${NUMBER})`),
  // Pino solto aberto pelo link curto: .../maps/search/-1.4558,+-48.4902
  new RegExp(String.raw`/maps/(?:search|place)/(${NUMBER}),[\s+]*(${NUMBER})`),
  new RegExp(String.raw`^\s*(${NUMBER})\s*[,;\s]\s*(${NUMBER})\s*$`),
  // Vírgula decimal, como se escreve no Brasil: "-1,4558, -48,4902",
  // "-1,4558; -48,4902" ou "-1,4558 -48,4902"
  new RegExp(String.raw`^\s*(${COMMA_NUMBER})\s*(?:[,;]\s*|\s+)(${COMMA_NUMBER})\s*$`),
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
    const latitude = Number(match[1].replace(",", "."));
    const longitude = Number(match[2].replace(",", "."));
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

/** Link curto do Google Maps (o app pede ao resolve-maps-link para abrir). */
export function isShortMapsLink(raw: string): boolean {
  return /^\s*https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/\S+\s*$/i.test(String(raw ?? ""));
}

const LOCATION_TEXT =
  /^📍 Localização(?:: (.+))?\nhttps:\/\/maps\.google\.com\/\?q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/u;

/**
 * Localização de uma mensagem enviada pelo Unxet (para o "Reenviar"). Ela
 * fica gravada como texto (sharedLocationText); nome e endereço saem da
 * resposta da Evolution guardada no payload e, sem ela, do próprio texto.
 */
export function sharedLocationFromMessage(
  text: string | null | undefined,
  payload?: unknown,
): SharedLocation | null {
  const match = String(text ?? "").trim().match(LOCATION_TEXT);
  if (!match) return null;
  const sent = (payload as { message?: { locationMessage?: Record<string, unknown> } } | null)
    ?.message?.locationMessage;
  return buildSharedLocation({
    latitude: Number(match[2]),
    longitude: Number(match[3]),
    name: typeof sent?.name === "string" ? sent.name : sent ? undefined : match[1],
    address: typeof sent?.address === "string" ? sent.address : undefined,
  });
}
