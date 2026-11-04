import { describe, expect, it } from "vitest";
import { httpStatusFor, overallStatus, runCheck, selectChecks } from "./health";

// Relógio falso: cada chamada avança o tempo pedido
const clock = (...times: number[]) => {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
};

describe("runCheck", () => {
  it("marca ok quando responde rápido", async () => {
    const result = await runCheck(async () => {}, { now: clock(0, 120) });
    expect(result).toEqual({ status: "ok", latency_ms: 120 });
  });

  it("marca degraded quando responde, mas lento", async () => {
    const result = await runCheck(async () => {}, { slowMs: 2000, now: clock(0, 2500) });
    expect(result.status).toBe("degraded");
  });

  it("marca down quando a checagem falha", async () => {
    const result = await runCheck(async () => {
      throw new Error("connection refused");
    });
    expect(result.status).toBe("down");
    expect(result).not.toHaveProperty("error");
  });

  it("marca down e cancela quando passa do limite de tempo", async () => {
    let aborted = false;
    const result = await runCheck(
      (signal) =>
        new Promise(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      { timeoutMs: 20 },
    );
    expect(result.status).toBe("down");
    expect(aborted).toBe(true);
  });
});

describe("overallStatus e httpStatusFor", () => {
  const ok = { status: "ok", latency_ms: 1 } as const;
  const slow = { status: "degraded", latency_ms: 3000 } as const;
  const down = { status: "down", latency_ms: 8000 } as const;

  it("usa o pior status entre as partes", () => {
    expect(overallStatus({ a: ok, b: ok })).toBe("ok");
    expect(overallStatus({ a: ok, b: slow })).toBe("degraded");
    expect(overallStatus({ a: slow, b: down })).toBe("down");
  });

  it("só devolve erro HTTP quando algo está fora do ar", () => {
    expect(httpStatusFor("ok")).toBe(200);
    expect(httpStatusFor("degraded")).toBe(200);
    expect(httpStatusFor("down")).toBe(503);
  });
});

describe("selectChecks", () => {
  const available = ["database", "auth", "storage", "evolution"];

  it("sem parâmetro, roda todas", () => {
    expect(selectChecks(null, available)).toEqual(available);
  });

  it("aceita uma lista, sem repetir e sem diferenciar maiúsculas", () => {
    expect(selectChecks("Database, auth,database", available)).toEqual(["database", "auth"]);
  });

  it("recusa parte desconhecida", () => {
    expect(selectChecks("database,redis", available)).toBeNull();
  });
});
