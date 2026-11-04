// deno-lint-ignore-file
// @ts-nocheck
// Helpers da função health (sem dependências, testáveis no Vitest).

export type CheckStatus = "ok" | "degraded" | "down";

export type CheckResult = {
  status: CheckStatus;
  latency_ms: number;
};

// Acima disso a parte responde, mas está lenta
export const SLOW_MS = 2000;
// Acima disso a parte é considerada fora do ar
export const TIMEOUT_MS = 8000;

/**
 * Roda uma checagem com limite de tempo. A função recebe um AbortSignal e
 * deve lançar erro quando a parte não estiver respondendo bem.
 * O erro em si nunca é devolvido: a resposta é pública.
 */
export const runCheck = async (
  check: (signal: AbortSignal) => Promise<unknown>,
  { timeoutMs = TIMEOUT_MS, slowMs = SLOW_MS, now = () => Date.now() } = {},
): Promise<CheckResult> => {
  const started = now();
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });

  try {
    await Promise.race([check(controller.signal), timeout]);
    const latency = now() - started;
    return { status: latency > slowMs ? "degraded" : "ok", latency_ms: latency };
  } catch {
    return { status: "down", latency_ms: now() - started };
  } finally {
    clearTimeout(timer);
  }
};

/** Pior status entre as partes: uma fora do ar deixa o sistema "down". */
export const overallStatus = (results: Record<string, CheckResult>): CheckStatus => {
  const statuses = Object.values(results).map((r) => r.status);
  if (statuses.includes("down")) return "down";
  if (statuses.includes("degraded")) return "degraded";
  return "ok";
};

/**
 * Código HTTP para os monitores externos: só "down" vira erro. Lentidão
 * aparece no JSON, mas não dispara alerta de queda.
 */
export const httpStatusFor = (status: CheckStatus) => (status === "down" ? 503 : 200);

/** Escolhe as partes pedidas em ?check=a,b. Sem o parâmetro, todas. */
export const selectChecks = (requested: string | null, available: string[]) => {
  if (!requested) return available;
  const wanted = requested
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const unknown = wanted.filter((name) => !available.includes(name));
  if (unknown.length) return null;
  return [...new Set(wanted)];
};
