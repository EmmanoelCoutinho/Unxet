// deno-lint-ignore-file
// @ts-nocheck
/**
 * health — saúde do sistema, para os monitores externos e a página de status.
 *
 * GET /functions/v1/health                → todas as partes
 * GET /functions/v1/health?check=database → só as partes pedidas (separadas por vírgula)
 *
 * Responde 200 quando tudo responde (mesmo lento) e 503 quando alguma parte
 * pedida está fora do ar. É pública: devolve só status e tempo de resposta,
 * nunca mensagens de erro.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { httpStatusFor, overallStatus, runCheck, selectChecks } from "../_shared/health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const expectOk = (res: Response) => {
  // Lê o corpo para liberar a conexão
  res.body?.cancel();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
};

const CHECKS: Record<string, (signal: AbortSignal) => Promise<unknown>> = {
  // Banco de dados (conversas, contatos, tudo)
  database: async (signal) => {
    const { error } = await supabase
      .from("channel_connections")
      .select("id")
      .limit(1)
      .abortSignal(signal);
    if (error) throw error;
  },
  // Login
  auth: async (signal) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY },
      signal,
    });
    expectOk(res);
  },
  // Arquivos (áudios, imagens, documentos)
  storage: async () => {
    const { error } = await supabase.storage.listBuckets();
    if (error) throw error;
  },
};

// WhatsApp por QR Code: só quando a Evolution está configurada no ambiente
if (EVOLUTION_API_URL) {
  CHECKS.evolution = async (signal) => {
    const res = await fetch(EVOLUTION_API_URL, { signal });
    expectOk(res);
  };
}

const json = (body: unknown, status: number, method: string) =>
  new Response(method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });

serve(async (req) => {
  const method = req.method;
  if (method === "OPTIONS") return json({}, 204, "HEAD");
  if (method !== "GET" && method !== "HEAD") {
    return json({ error: "method_not_allowed" }, 405, method);
  }

  const url = new URL(req.url);
  const names = selectChecks(url.searchParams.get("check"), Object.keys(CHECKS));
  if (!names) {
    return json({ error: "unknown_check", available: Object.keys(CHECKS) }, 400, method);
  }

  const entries = await Promise.all(
    names.map(async (name) => [name, await runCheck(CHECKS[name])] as const),
  );
  const checks = Object.fromEntries(entries);
  const status = overallStatus(checks);

  if (status !== "ok") {
    console.warn("[health]", status, JSON.stringify(checks));
  }

  return json(
    { status, checked_at: new Date().toISOString(), checks },
    httpStatusFor(status),
    method,
  );
});
