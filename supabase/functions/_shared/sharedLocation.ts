// Localização enviada pelo atendente (WhatsApp via QR Code).
//
// No histórico fica como texto, no mesmo formato da localização recebida
// (evolution-in/_shared/evolutionContent.ts): "📍 Localização: nome - endereço"
// e o link do Google Maps. O app monta o mesmo texto em src/lib/sharedLocation.ts.

export interface SharedLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

const MAX_NAME = 100;
const MAX_ADDRESS = 200;

const cleanText = (value: unknown, max: number) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max).trim() : undefined;
};

/** Valida o que veio do app. null se faltar coordenada válida. */
export function parseSharedLocation(raw: any): SharedLocation | null {
  if (!raw || typeof raw !== "object") return null;
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return {
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
    name: cleanText(raw.name, MAX_NAME),
    address: cleanText(raw.address, MAX_ADDRESS),
  };
}

export function sharedLocationMapsUrl(location: SharedLocation): string {
  return `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
}

/** Texto gravado no histórico. */
export function sharedLocationText(location: SharedLocation): string {
  const place = [location.name, location.address].filter(Boolean).join(" - ");
  return `📍 Localização${place ? `: ${place}` : ""}\n${sharedLocationMapsUrl(location)}`;
}

/** Corpo do /message/sendLocation da Evolution. */
export function toEvolutionLocation(location: SharedLocation) {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    name: location.name ?? "",
    address: location.address ?? "",
  };
}
