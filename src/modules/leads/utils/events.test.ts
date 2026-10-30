import { describe, expect, it } from "vitest";
import { describeDealEvent } from "./events";

const names = { u1: "Mariana" };
const ev = (type: any, payload: Record<string, unknown> = {}) => ({ type, payload, userId: null });

describe("describeDealEvent", () => {
  it("descreve criação e mudanças de etapa", () => {
    expect(describeDealEvent(ev("created", { source: "campaign", stage_name: "Novo lead" }), names)).toBe(
      'Negociação veio de uma campanha em "Novo lead"',
    );
    expect(
      describeDealEvent(ev("stage_changed", { from_stage_name: "Novo lead", to_stage_name: "Proposta", status: "open" }), names),
    ).toBe('Movida de "Novo lead" para "Proposta"');
    expect(describeDealEvent(ev("stage_changed", { to_stage_name: "Ganho", status: "won" }), names)).toBe(
      'Marcada como ganha ("Ganho")',
    );
    expect(describeDealEvent(ev("stage_changed", { status: "lost", lost_reason: "Preço" }), names)).toBe(
      "Marcada como perdida: Preço",
    );
  });

  it("descreve valor, responsável e tarefa", () => {
    // O formato de moeda usa espaço inseparável depois do R$
    expect(
      describeDealEvent(ev("value_changed", { from: null, to: "1500" }), names).replace(/\s/g, " "),
    ).toBe("Valor alterado de sem valor para R$ 1.500,00");
    expect(describeDealEvent(ev("owner_changed", { to: "u1" }), names)).toBe("Responsável: Mariana");
    expect(describeDealEvent(ev("owner_changed", { to: null }), names)).toBe("Ficou sem responsável");
    expect(describeDealEvent(ev("task_done", { title: "Ligar" }), names)).toBe("Tarefa concluída: Ligar");
  });
});
