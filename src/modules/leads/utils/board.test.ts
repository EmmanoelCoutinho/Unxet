import { describe, expect, it } from "vitest";
import type { Deal } from "../types/leads";
import {
  daysSince,
  dropPosition,
  filterDeals,
  formatCompactCurrency,
  formatDue,
  initials,
  isStalled,
  localDateTimeToIso,
  nextOpenTask,
  positionBetween,
  stageTotals,
  topPosition,
} from "./board";

const NOW = new Date(2026, 9, 26, 12, 0, 0).getTime();

const deal = (overrides: Partial<Deal>): Deal => ({
  id: "d",
  clinicId: "c",
  pipelineId: "p",
  stageId: "s",
  contact: { id: "ct", name: "Ana Souza", phone: "5511999998888", imageUrl: null },
  title: "Implante",
  value: null,
  ownerUserId: null,
  source: "manual",
  sourceConversationId: null,
  sourceCampaignId: null,
  status: "open",
  lostReasonId: null,
  lostNote: null,
  position: 0,
  stageEnteredAt: new Date(NOW).toISOString(),
  closedAt: null,
  createdBy: null,
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
  tagIds: [],
  tasks: [],
  ...overrides,
});

describe("posição dos cartões", () => {
  it("calcula entre vizinhos", () => {
    expect(positionBetween()).toBe(0);
    expect(positionBetween(undefined, 5)).toBe(4);
    expect(positionBetween(5)).toBe(6);
    expect(positionBetween(1, 2)).toBe(1.5);
  });

  it("solta no índice certo ignorando o próprio cartão", () => {
    const stage = [
      { id: "a", position: 1 },
      { id: "b", position: 2 },
      { id: "c", position: 3 },
    ];
    expect(dropPosition(stage, 0, "x")).toBe(0);
    expect(dropPosition(stage, 1, "x")).toBe(1.5);
    expect(dropPosition(stage, 3, "x")).toBe(4);
    // "a" descendo para depois de "b"
    expect(dropPosition(stage, 1, "a")).toBe(2.5);
    expect(dropPosition([], 0, "x")).toBe(0);
  });

  it("topo da etapa", () => {
    expect(topPosition([])).toBe(0);
    expect(topPosition([{ position: 3 }, { position: -2 }])).toBe(-3);
  });
});

describe("tempo e tarefas", () => {
  it("conta dias e marca parado só se aberto há 7+ dias", () => {
    const eightDays = new Date(NOW - 8 * 86400000).toISOString();
    expect(daysSince(eightDays, NOW)).toBe(8);
    expect(isStalled({ status: "open", stageEnteredAt: eightDays }, NOW)).toBe(true);
    expect(isStalled({ status: "won", stageEnteredAt: eightDays }, NOW)).toBe(false);
    expect(isStalled({ status: "open", stageEnteredAt: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });

  it("próxima tarefa aberta", () => {
    expect(
      nextOpenTask([
        { id: "1", title: "a", dueAt: "2026-10-28T10:00:00Z", doneAt: null },
        { id: "2", title: "b", dueAt: "2026-10-27T10:00:00Z", doneAt: "x" },
        { id: "3", title: "c", dueAt: "2026-10-27T12:00:00Z", doneAt: null },
      ])?.id,
    ).toBe("3");
    expect(nextOpenTask([])).toBeNull();
  });

  it("descreve o vencimento", () => {
    const now = new Date(NOW);
    expect(formatDue(new Date(2026, 9, 26, 14, 30).toISOString(), now)).toBe("hoje 14:30");
    expect(formatDue(new Date(2026, 9, 27, 9, 0).toISOString(), now)).toBe("amanhã 09:00");
    expect(formatDue(new Date(2026, 9, 25, 18, 0).toISOString(), now)).toBe("ontem 18:00");
    expect(formatDue(new Date(2026, 10, 12, 10, 0).toISOString(), now)).toBe("12/11 10:00");
  });

  it("monta data e hora locais e recusa data inválida", () => {
    expect(localDateTimeToIso("2026-10-27", "09:30")).toBe(new Date(2026, 9, 27, 9, 30).toISOString());
    expect(localDateTimeToIso("2026-02-31", "09:30")).toBeNull();
    expect(localDateTimeToIso("", "09:30")).toBeNull();
  });
});

describe("filtros e totais", () => {
  const deals = [
    deal({ id: "1", title: "Clareamento", ownerUserId: "u1", tagIds: ["t1"] }),
    deal({ id: "2", contact: { id: "c2", name: "João Ávila", phone: "5521988887777", imageUrl: null }, ownerUserId: null }),
    deal({ id: "3", ownerUserId: "u2", stageEnteredAt: new Date(NOW - 10 * 86400000).toISOString() }),
  ];
  const base = { search: "", owner: "all", tagId: null, stalledOnly: false };

  it("busca por título, nome sem acento e telefone", () => {
    expect(filterDeals(deals, { ...base, search: "clare" }, "u1", NOW).map((d) => d.id)).toEqual(["1"]);
    expect(filterDeals(deals, { ...base, search: "joao avila" }, "u1", NOW).map((d) => d.id)).toEqual(["2"]);
    expect(filterDeals(deals, { ...base, search: "88887777" }, "u1", NOW).map((d) => d.id)).toEqual(["2"]);
  });

  it("filtra por responsável, etiqueta e parados", () => {
    expect(filterDeals(deals, { ...base, owner: "mine" }, "u1", NOW).map((d) => d.id)).toEqual(["1"]);
    expect(filterDeals(deals, { ...base, owner: "none" }, "u1", NOW).map((d) => d.id)).toEqual(["2"]);
    expect(filterDeals(deals, { ...base, owner: "u2" }, "u1", NOW).map((d) => d.id)).toEqual(["3"]);
    expect(filterDeals(deals, { ...base, tagId: "t1" }, "u1", NOW).map((d) => d.id)).toEqual(["1"]);
    expect(filterDeals(deals, { ...base, stalledOnly: true }, "u1", NOW).map((d) => d.id)).toEqual(["3"]);
  });

  it("soma a etapa e abrevia valores", () => {
    expect(stageTotals([{ value: 100 }, { value: null }, { value: 50.5 }])).toEqual({ count: 3, value: 150.5 });
    expect(formatCompactCurrency(15000)).toBe("R$ 15 mil");
    expect(formatCompactCurrency(2500000)).toBe("R$ 2,5 mi");
  });

  it("iniciais do nome", () => {
    expect(initials("Mariana Souza Lima")).toBe("ML");
    expect(initials("Carlos")).toBe("C");
    expect(initials("5511999")).toBe("?");
  });
});
