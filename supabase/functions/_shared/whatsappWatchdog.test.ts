import { describe, expect, it, vi } from "vitest";
import {
  restartInstance,
  watchdogDecision,
  watchdogNotification,
  watchdogNumberLabel,
} from "./whatsappWatchdog";

const now = new Date("2026-11-12T15:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60000).toISOString();

const silent = {
  recent_count: 0,
  baseline_counts: [22, 3, 18, 0],
  last_connection_at: minutesAgo(60 * 24 * 10),
  watchdog_restarted_at: null,
  watchdog_alerted_at: null,
  inbound_since_restart: null,
};

describe("watchdogDecision", () => {
  it("não mexe em número que está recebendo", () => {
    expect(watchdogDecision({ ...silent, recent_count: 1 }, now)).toBe("ok");
  });

  it("não mexe em número que não costuma receber nesse horário", () => {
    expect(watchdogDecision({ ...silent, baseline_counts: [22, 9, 4, 0] }, now)).toBe("ok");
    expect(watchdogDecision({ ...silent, baseline_counts: [] }, now)).toBe("ok");
    expect(watchdogDecision({ ...silent, baseline_counts: null }, now)).toBe("ok");
  });

  it("reinicia número movimentado que ficou em silêncio", () => {
    expect(watchdogDecision(silent, now)).toBe("restart");
  });

  it("espera quem acabou de conectar", () => {
    expect(watchdogDecision({ ...silent, last_connection_at: minutesAgo(10) }, now)).toBe("ok");
  });

  it("dá um tempo para as mensagens voltarem depois do reinício", () => {
    expect(
      watchdogDecision({ ...silent, watchdog_restarted_at: minutesAgo(10), inbound_since_restart: 0 }, now),
    ).toBe("wait");
  });

  it("avisa quando o reinício não resolveu", () => {
    expect(
      watchdogDecision({ ...silent, watchdog_restarted_at: minutesAgo(25), inbound_since_restart: 0 }, now),
    ).toBe("alert");
  });

  it("não avisa se voltou a receber depois do reinício", () => {
    expect(
      watchdogDecision({ ...silent, watchdog_restarted_at: minutesAgo(60), inbound_since_restart: 4 }, now),
    ).toBe("wait");
  });

  it("avisa só uma vez por dia", () => {
    const restarted = { ...silent, watchdog_restarted_at: minutesAgo(30), inbound_since_restart: 0 };
    expect(watchdogDecision({ ...restarted, watchdog_alerted_at: minutesAgo(200) }, now)).toBe("wait");
    expect(watchdogDecision({ ...restarted, watchdog_alerted_at: minutesAgo(25 * 60) }, now)).toBe("alert");
  });

  it("reinicia de novo depois de 3 horas se o reinício anterior tinha resolvido", () => {
    const restarted = { ...silent, inbound_since_restart: 7 };
    expect(watchdogDecision({ ...restarted, watchdog_restarted_at: minutesAgo(170) }, now)).toBe("wait");
    expect(watchdogDecision({ ...restarted, watchdog_restarted_at: minutesAgo(181) }, now)).toBe("restart");
  });

  it("espera 12 horas se o reinício anterior não trouxe mensagens", () => {
    const restarted = { ...silent, inbound_since_restart: 0, watchdog_alerted_at: minutesAgo(100) };
    expect(watchdogDecision({ ...restarted, watchdog_restarted_at: minutesAgo(181) }, now)).toBe("wait");
    expect(watchdogDecision({ ...restarted, watchdog_restarted_at: minutesAgo(12 * 60 + 1) }, now)).toBe("restart");
  });
});

describe("watchdogNumberLabel", () => {
  it("mostra nome e telefone", () => {
    expect(
      watchdogNumberLabel({ connected_name: "Clínica", connected_phone: "5511999998888@s.whatsapp.net" }),
    ).toBe("Clínica (+5511999998888)");
    expect(watchdogNumberLabel({ connected_phone: "5511999998888:12@s.whatsapp.net" })).toBe("+5511999998888");
    expect(watchdogNumberLabel({})).toBe("WhatsApp");
  });
});

describe("watchdogNotification", () => {
  it("monta os dois avisos", () => {
    const activity = { connected_phone: "5511999998888" };
    expect(watchdogNotification("restart", activity).kind).toBe("whatsapp_watchdog_restart");
    expect(watchdogNotification("alert", activity).body).toContain("+5511999998888");
  });
});

describe("restartInstance", () => {
  const response = (status: number) => ({ ok: status >= 200 && status < 300, status, body: null });

  it("reinicia com POST", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200));
    expect(await restartInstance("https://evo.test/", "key", "loja 1", { fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://evo.test/instance/restart/loja%201");
    expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
  });

  it("tenta PUT quando o POST não existe (Evolution v1)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(200));
    expect(await restartInstance("https://evo.test", "key", "loja", { fetchImpl })).toBe(true);
    expect(fetchImpl.mock.calls[1][1].method).toBe("PUT");
  });

  it("devolve false em erro da Evolution ou de rede, sem lançar", async () => {
    const failing = vi.fn().mockResolvedValue(response(500));
    expect(await restartInstance("https://evo.test", "key", "loja", { fetchImpl: failing })).toBe(false);
    expect(failing).toHaveBeenCalledTimes(1);

    const offline = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await restartInstance("https://evo.test", "key", "loja", { fetchImpl: offline })).toBe(false);
  });
});
