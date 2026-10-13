import { describe, expect, it } from "vitest";
import {
  combineDateAndTime,
  defaultScheduleDate,
  formatPhone,
  normalizeTypedPhone,
  recipientLabel,
  summarizeRecipients,
  toDateInputValue,
  toTimeInputValue,
} from "./schedule";

describe("normalizeTypedPhone", () => {
  it.each([
    ["(11) 99999-8888", "5511999998888"],
    ["11 3333-4444", "551133334444"],
    ["011 99999-8888", "5511999998888"],
    ["+55 11 99999-8888", "5511999998888"],
    ["5511999998888", "5511999998888"],
    ["+351 912 345 678", "351912345678"],
  ])("aceita %j como %s", (input, expected) => {
    expect(normalizeTypedPhone(input)).toBe(expected);
  });

  it.each(["", "99999-8888", "123", "55119999988887777", "abc"])(
    "rejeita %j",
    (input) => {
      expect(normalizeTypedPhone(input)).toBeNull();
    },
  );
});

describe("formatPhone", () => {
  it("formata celular e fixo do Brasil", () => {
    expect(formatPhone("5511999998888")).toBe("+55 (11) 99999-8888");
    expect(formatPhone("551133334444")).toBe("+55 (11) 3333-4444");
  });

  it("mantém números de outros países só com o +", () => {
    expect(formatPhone("351912345678")).toBe("+351912345678");
    expect(formatPhone(null)).toBe("");
  });
});

describe("recipientLabel", () => {
  it("usa o nome quando existe", () => {
    expect(recipientLabel({ name: " Ana ", phone: "5511999998888" })).toBe("Ana");
  });

  it("usa o telefone quando o nome é vazio ou é o próprio número", () => {
    expect(recipientLabel({ name: null, phone: "5511999998888" })).toBe(
      "+55 (11) 99999-8888",
    );
    expect(
      recipientLabel({ name: "5511999998888", phone: "5511999998888" }),
    ).toBe("+55 (11) 99999-8888");
  });
});

describe("data e hora do formulário", () => {
  it("combina data e hora no fuso do navegador e volta para os mesmos valores", () => {
    const date = combineDateAndTime("2026-12-24", "08:05");
    expect(date).not.toBeNull();
    expect(toDateInputValue(date as Date)).toBe("2026-12-24");
    expect(toTimeInputValue(date as Date)).toBe("08:05");
  });

  it.each([
    ["", "08:00"],
    ["2026-12-24", ""],
    ["2026-02-31", "08:00"],
    ["24/12/2026", "08:00"],
  ])("rejeita %j %j", (date, time) => {
    expect(combineDateAndTime(date, time)).toBeNull();
  });

  it("sugere daqui a 1 hora, arredondando para cima em 5 minutos", () => {
    const suggestion = defaultScheduleDate(new Date(2026, 9, 13, 10, 2, 30));
    expect(toDateInputValue(suggestion)).toBe("2026-10-13");
    expect(toTimeInputValue(suggestion)).toBe("11:05");

    const nextHour = defaultScheduleDate(new Date(2026, 9, 13, 22, 58, 0));
    expect(toDateInputValue(nextHour)).toBe("2026-10-14");
    expect(toTimeInputValue(nextHour)).toBe("00:00");
  });
});

describe("summarizeRecipients", () => {
  it("conta enviados, falhas e quem ainda aguarda", () => {
    expect(
      summarizeRecipients([
        { status: "sent" },
        { status: "sent" },
        { status: "failed" },
        { status: "pending" },
        { status: "sending" },
        { status: "cancelled" },
      ]),
    ).toEqual({ total: 6, sent: 2, failed: 1, waiting: 2 });
  });
});
