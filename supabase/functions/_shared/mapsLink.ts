// Link curto do Google Maps (maps.app.goo.gl), aberto pelo resolve-maps-link.
// O redirecionamento só pode passar por endereços do Google.

// Links curtos aceitos na entrada
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);

/** Endereços do Google por onde o redirecionamento pode passar. */
export function isGoogleMapsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (SHORT_HOSTS.has(host)) return true;
  // google.com, google.com.br, www.google.com.br, maps.google.com...
  return /^(?:(?:www|maps)\.)?google\.(?:com|com\.br)$/.test(host);
}

/** O link colado é um link curto do Google Maps? */
export function shortMapsLink(raw: unknown): URL | null {
  try {
    const url = new URL(String(raw ?? "").trim());
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!SHORT_HOSTS.has(host)) return null;
    // goo.gl só para os links antigos do Maps (goo.gl/maps/...)
    if (host === "goo.gl" && !url.pathname.startsWith("/maps")) return null;
    return url;
  } catch {
    return null;
  }
}
