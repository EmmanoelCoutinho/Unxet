import { describe, expect, it } from "vitest";
import { statusPatch } from "./messageStatus";

const at = "2026-11-17T15:00:00.000Z";

describe("statusPatch", () => {
  it("entregue e lida avançam os ticks", () => {
    expect(statusPatch({}, "delivered", at)).toEqual({ delivered_at: at });
    expect(statusPatch({}, "read", at)).toEqual({ delivered_at: at, read_at: at });
    expect(statusPatch({ delivered_at: at }, "read", at)).toEqual({ read_at: at });
    expect(statusPatch({ delivered_at: at, read_at: at }, "read", at)).toEqual({});
  });

  it("falha marca não entregue, com o motivo", () => {
    expect(statusPatch({}, "failed", at)).toEqual({ failed_at: at });
    expect(statusPatch({}, "failed", at, " 131047 - janela de 24 h ")).toEqual({
      failed_at: at,
      failure_reason: "131047 - janela de 24 h",
    });
    expect(statusPatch({}, "failed", at, "x".repeat(500)).failure_reason).toHaveLength(300);
  });

  it("falha depois de entregue ou já marcada não muda nada", () => {
    expect(statusPatch({ delivered_at: at }, "failed", at)).toEqual({});
    expect(statusPatch({ read_at: at }, "failed", at)).toEqual({});
    expect(statusPatch({ failed_at: at }, "failed", "2026-11-17T16:00:00.000Z")).toEqual({});
  });

  it("entrega depois de um aviso de falha: a entrega prevalece", () => {
    expect(statusPatch({ failed_at: at }, "delivered", at)).toEqual({
      delivered_at: at,
      failed_at: null,
      failure_reason: null,
    });
  });
});
