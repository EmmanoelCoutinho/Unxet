import { describe, expect, it } from "vitest";
import type { Appointment } from "../types";
import { isOutsideHours, layoutDay, startOfWeek, validateHours, visibleHours } from "./calendar";

const appt = (id: string, start: string, end: string): Appointment => ({
  id,
  professionalId: "p",
  serviceId: null,
  contactId: "c",
  contactName: null,
  contactPhone: null,
  startsAt: new Date(start).toISOString(),
  endsAt: new Date(end).toISOString(),
  status: "scheduled",
  notes: null,
  source: "manual",
  conversationId: null,
  cancelReason: null,
  createdBy: null,
  createdAt: new Date(start).toISOString(),
});

describe("calendário", () => {
  it("semana começa na segunda", () => {
    // Quinta, 26/11/2026
    const monday = startOfWeek(new Date(2026, 10, 26, 15, 0));
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(23);
    // Domingo fica na semana que começou na segunda anterior
    expect(startOfWeek(new Date(2026, 10, 29)).getDate()).toBe(23);
  });

  it("horários que se cruzam ficam lado a lado", () => {
    const placed = layoutDay([
      appt("a", "2026-11-26T09:00", "2026-11-26T10:00"),
      appt("b", "2026-11-26T09:30", "2026-11-26T10:30"),
      appt("c", "2026-11-26T11:00", "2026-11-26T11:30"),
    ]);
    const byId = Object.fromEntries(placed.map((p) => [p.appointment.id, p]));
    expect(byId.a).toMatchObject({ column: 0, columns: 2 });
    expect(byId.b).toMatchObject({ column: 1, columns: 2 });
    expect(byId.c).toMatchObject({ column: 0, columns: 1 });
  });

  it("grade cobre o expediente e agendamentos fora dele", () => {
    const day = new Date(2026, 10, 26);
    const hours = [{ weekday: 4, start: "08:30", end: "17:00" }];
    expect(visibleHours(hours, [], [day])).toEqual({ from: 8 * 60, to: 17 * 60 });
    const late = appt("x", "2026-11-26T19:00", "2026-11-26T19:45");
    expect(visibleHours(hours, [late], [day])).toEqual({ from: 8 * 60, to: 20 * 60 });
  });

  it("confere faixas de horário", () => {
    expect(validateHours([{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "13:00", end: "18:00" }])).toBeNull();
    expect(validateHours([{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "18:00" }])).toMatch(
      /sobrepõem/,
    );
    expect(validateHours([{ weekday: 2, start: "18:00", end: "08:00" }])).toMatch(/depois do início/);
  });

  it("fora do expediente", () => {
    const hours = [{ weekday: 1, start: "08:00", end: "12:00" }];
    expect(isOutsideHours(hours, 1, 9 * 60)).toBe(false);
    expect(isOutsideHours(hours, 1, 12 * 60)).toBe(true);
    expect(isOutsideHours(hours, 2, 9 * 60)).toBe(true);
  });
});
