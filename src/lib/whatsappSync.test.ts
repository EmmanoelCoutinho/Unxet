import { describe, expect, it } from "vitest";
import { whatsappSyncPercent, whatsappSyncState, type WhatsappSyncRow } from "./whatsappSync";

const now = new Date("2026-11-21T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60000).toISOString();

const row = (overrides: Partial<WhatsappSyncRow> = {}): WhatsappSyncRow => ({
  inbound_recovery_requested_at: minutesAgo(3),
  inbound_recovery_total: null,
  inbound_recovery_done: 0,
  inbound_recovery_progress_at: minutesAgo(3),
  ...overrides,
});

describe("whatsappSyncState", () => {
  it("sem recuperação pedida não mostra nada", () => {
    expect(whatsappSyncState(null, now)).toBeNull();
    expect(whatsappSyncState(row({ inbound_recovery_requested_at: null }), now)).toBeNull();
  });

  it("número que caiu de novo não mostra nada", () => {
    expect(
      whatsappSyncState(row({ status: "disconnected", inbound_recovery_total: 38, inbound_recovery_done: 37, inbound_recovery_progress_at: minutesAgo(1) }), now),
    ).toBeNull();
    expect(whatsappSyncState(row({ status: "connected" }), now)).toEqual({ kind: "searching" });
  });

  it("antes da primeira busca mostra que está procurando", () => {
    expect(whatsappSyncState(row(), now)).toEqual({ kind: "searching" });
  });

  it("primeira busca que nunca rodou some depois do prazo", () => {
    expect(whatsappSyncState(row({ inbound_recovery_requested_at: minutesAgo(20) }), now)).toBeNull();
  });

  it("nada para trazer não mostra nada", () => {
    expect(whatsappSyncState(row({ inbound_recovery_total: 0 }), now)).toBeNull();
  });

  it("mostra quantas já entraram", () => {
    expect(
      whatsappSyncState(row({ inbound_recovery_total: 40, inbound_recovery_done: 10, inbound_recovery_progress_at: minutesAgo(1) }), now),
    ).toEqual({ kind: "progress", done: 10, total: 40 });
  });

  it("parada há muito tempo some", () => {
    expect(
      whatsappSyncState(row({ inbound_recovery_total: 40, inbound_recovery_done: 38, inbound_recovery_progress_at: minutesAgo(11) }), now),
    ).toBeNull();
  });

  it("terminou: mostra concluída por um minuto", () => {
    const finished = row({ inbound_recovery_total: 40, inbound_recovery_done: 40, inbound_recovery_progress_at: minutesAgo(0.5) });
    expect(whatsappSyncState(finished, now)).toEqual({ kind: "done", total: 40 });
    expect(whatsappSyncState({ ...finished, inbound_recovery_progress_at: minutesAgo(2) }, now)).toBeNull();
  });

  it("contador acima do total conta como concluída", () => {
    expect(
      whatsappSyncState(row({ inbound_recovery_total: 5, inbound_recovery_done: 7, inbound_recovery_progress_at: minutesAgo(0.2) }), now),
    ).toEqual({ kind: "done", total: 5 });
  });
});

describe("whatsappSyncPercent", () => {
  it("calcula a porcentagem", () => {
    expect(whatsappSyncPercent({ kind: "progress", done: 1, total: 3 })).toBe(33);
    expect(whatsappSyncPercent({ kind: "done", total: 3 })).toBe(100);
    expect(whatsappSyncPercent({ kind: "searching" })).toBe(0);
  });
});
