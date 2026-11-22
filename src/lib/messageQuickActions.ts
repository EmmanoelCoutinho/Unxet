// Atalhos na bolha da mensagem: copiar o Pix e abrir a localização no Maps.
// O texto vem gravado pelas edge functions (evolutionContent.ts e
// sharedLocation.ts), então a detecção segue esses formatos.

export type PixQuickAction = {
  /** O que vai para a área de transferência */
  value: string;
  kind: "code" | "key";
};

// Código copia e cola (BR Code / EMV): começa com 000201, cita o arranjo do Pix
// e fica numa linha só. Os espaços fazem parte do código (nome do recebedor,
// cidade) e entram no CRC: copia exatamente como veio.
const PIX_CODE = /^000201[^\r\n]*br\.gov\.bcb\.pix[^\r\n]*$/i;
// "Chave Pix (CNPJ): 12.345.678/0001-90" (o tipo é opcional)
const PIX_KEY = /^Chave Pix(?: \([^)]*\))?:\s*(.+)$/im;

export function pixFromText(text: string): PixQuickAction | null {
  const value = String(text ?? "").trim();
  if (!value) return null;
  if (value.length <= 512 && PIX_CODE.test(value)) {
    return { value, kind: "code" };
  }
  const key = value.match(PIX_KEY)?.[1]?.trim();
  return key ? { value: key, kind: "key" } : null;
}

const NUMBER = String.raw`-?\d{1,3}(?:\.\d+)?`;
const MAPS_COORDS = new RegExp(
  String.raw`https?://(?:www\.)?(?:maps\.google\.[a-z.]+|google\.[a-z.]+/maps)\S*?[?&](?:q|query)=(${NUMBER}),\s*(${NUMBER})`,
  "i",
);

/**
 * Localização enviada ou recebida ("📍 Localização..." com o link do Maps).
 * Devolve o link universal do Google Maps: no celular abre o app (se houver),
 * no computador abre o site.
 */
export function locationMapsLinkFromText(text: string): string | null {
  const value = String(text ?? "").trim();
  if (!value.startsWith("📍")) return null;
  const match = value.match(MAPS_COORDS);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
