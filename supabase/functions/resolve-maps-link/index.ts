// deno-lint-ignore-file
// @ts-nocheck
/**
 * resolve-maps-link — abre o link curto do Google Maps (maps.app.goo.gl).
 *
 * O link que o celular gera ao tocar em "Compartilhar" no Google Maps não traz
 * as coordenadas: elas só aparecem no endereço para onde ele redireciona. O
 * navegador não consegue seguir esse redirecionamento (CORS), então o modal
 * "Enviar localização" pede aqui.
 *
 * Segurança: só segue redirecionamentos entre endereços do Google
 * (_shared/mapsLink.ts), sem ler a página, no máximo 5 saltos. Devolve o
 * último endereço; quem procura as coordenadas nele é o app (parseCoordinates).
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { getAuthenticatedUser } from "../_shared/security.ts";
import { isGoogleMapsHost, shortMapsLink } from "../_shared/mapsLink.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 5000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return json(401, { error: "Unauthorized" });

    const { url: rawUrl } = await req.json().catch(() => ({}));
    let current = shortMapsLink(rawUrl);
    if (!current) return json(400, { error: "Cole um link do Google Maps (maps.app.goo.gl)." });

    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const resp = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      // Só o endereço importa: o corpo não é lido
      await resp.body?.cancel().catch(() => {});

      const location = resp.headers.get("location");
      // Link curto que não existe (ou já expirou): o Google responde 404
      if (resp.status >= 400 && hop === 0) {
        return json(404, { error: "Este link do Google Maps não existe ou expirou. Copie de novo no Google Maps." });
      }
      if (resp.status < 300 || resp.status >= 400 || !location) break;

      const next = new URL(location, current);
      if (next.protocol !== "https:" || !isGoogleMapsHost(next.hostname)) {
        console.warn("[RESOLVE_MAPS_LINK_OFF_GOOGLE]", next.hostname);
        return json(422, { error: "Este link não leva ao Google Maps." });
      }
      current = next;
    }

    return json(200, { url: current.toString() });
  } catch (error) {
    console.error("[RESOLVE_MAPS_LINK_ERROR]", error?.message ?? String(error));
    return json(502, { error: "Não foi possível abrir o link agora." });
  }
});
