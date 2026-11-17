import { describe, expect, it } from "vitest";
import { LATE_INBOUND_MINUTES, isLateInbound, unansweredSince } from "./lateInbound";

const now = new Date("2026-11-17T05:11:30Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60000).toISOString();

describe("isLateInbound", () => {
  it("mensagem de agora ou de poucos minutos não é atrasada", () => {
    expect(isLateInbound(minutesAgo(0), now)).toBe(false);
    expect(isLateInbound(minutesAgo(5), now)).toBe(false);
    expect(isLateInbound(minutesAgo(LATE_INBOUND_MINUTES), now)).toBe(false);
  });

  it("passou do limite: atrasada", () => {
    expect(isLateInbound(minutesAgo(LATE_INBOUND_MINUTES + 1), now)).toBe(true);
    // Caso real: escrita às 17:19 de 16/11, chegou às 02:11 de 17/11 (BRT)
    expect(isLateInbound("2026-11-16T20:19:13Z", now)).toBe(true);
  });

  it("relógio adiantado do remetente não conta como atraso", () => {
    expect(isLateInbound(new Date(now.getTime() + 60000).toISOString(), now)).toBe(false);
  });

  it("sem horário ou inválido: não é atrasada", () => {
    expect(isLateInbound(null, now)).toBe(false);
    expect(isLateInbound(undefined, now)).toBe(false);
    expect(isLateInbound("não é data", now)).toBe(false);
  });
});

describe("unansweredSince", () => {
  it("atrasada conta de quando chegou; no tempo, de quando foi escrita", () => {
    expect(unansweredSince("2026-11-16T20:19:13.000Z", true, now)).toBe(now.toISOString());
    expect(unansweredSince("2026-11-17T05:11:20.000Z", false, now)).toBe("2026-11-17T05:11:20.000Z");
  });
});
