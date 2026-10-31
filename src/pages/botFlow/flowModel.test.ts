import { describe, expect, it } from "vitest";
import type { BotNodeRow, BotOptionRow } from "../../types/bots";
import {
  buildFlowTree,
  countChanges,
  fromRows,
  getOptionWarning,
  isStageIncomplete,
  nextNodeKey,
  toOptionColumns,
  toStageColumns,
  type FlowOption,
} from "./flowModel";

const node = (id: string, key: string, sort: number): BotNodeRow => ({
  id,
  bot_id: "b",
  clinic_id: "c",
  node_key: key,
  title: `Etapa ${id}`,
  message: `Mensagem ${id}`,
  node_type: "menu",
  sort_order: sort,
});

const row = (
  id: string,
  nodeId: string,
  sort: number,
  extra: Partial<BotOptionRow>,
): BotOptionRow => ({
  id,
  bot_node_id: nodeId,
  clinic_id: "c",
  option_value: String(sort),
  label: `Botão ${id}`,
  action_type: "end_flow",
  next_node_id: null,
  target_department_id: null,
  tag_id: null,
  message_to_send: null,
  end_session: true,
  sort_order: sort,
  ...extra,
});

const option = (extra: Partial<FlowOption>): FlowOption => ({
  id: "o",
  isNew: false,
  stageId: "s1",
  label: "Agendar",
  action: "end",
  target: "",
  departmentId: "",
  reply: "",
  tagId: "",
  savedValue: "1",
  ...extra,
});

const identity = (id: string) => id;

describe("fromRows", () => {
  it("coloca a etapa inicial primeiro e traduz as ações antigas", () => {
    const state = fromRows([node("s2", "node_2", 2), node("s1", "root", 5)], {
      s1: [
        row("a", "s1", 2, { action_type: "transfer_to_department", target_department_id: "d" }),
        row("b", "s1", 1, { action_type: "go_to_node", next_node_id: "s2", end_session: false }),
        row("c", "s1", 3, { action_type: "send_message", message_to_send: "oi", end_session: true }),
        row("d", "s1", 4, { action_type: "add_tag", tag_id: "t", end_session: false }),
      ],
    });

    expect(state.stages.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(state.stages[0].isRoot).toBe(true);
    expect(state.options.map((o) => [o.id, o.action])).toEqual([
      ["b", "stage"],
      ["a", "human"],
      // mensagem que encerrava a sessão passava a conversa para a equipe
      ["c", "human"],
      ["d", "message"],
    ]);
    expect(state.options[0].target).toBe("s2");
    expect(state.options[1].departmentId).toBe("d");
    expect(state.options[3].tagId).toBe("t");
  });
});

describe("toOptionColumns", () => {
  it("numera pela posição", () => {
    const cols = toOptionColumns(option({}), 2, "s1", identity);
    expect(cols.option_value).toBe("3");
    expect(cols.sort_order).toBe(3);
  });

  it("Responder aponta para a própria etapa para reenviar os botões", () => {
    const cols = toOptionColumns(option({ action: "message", reply: "Horário" }), 0, "real-s1", identity);
    expect(cols).toMatchObject({
      action_type: "send_message",
      next_node_id: "real-s1",
      end_session: false,
      message_to_send: "Horário",
    });
  });

  it("Atendente com setor vira transferência, sem setor vira atendente", () => {
    expect(toOptionColumns(option({ action: "human", departmentId: "d" }), 0, "s1", identity)).toMatchObject({
      action_type: "transfer_to_department",
      target_department_id: "d",
      end_session: true,
    });
    expect(toOptionColumns(option({ action: "human" }), 0, "s1", identity)).toMatchObject({
      action_type: "handoff_to_human",
      target_department_id: null,
    });
  });

  it("Abrir etapa troca o id provisório pelo do banco e mantém a etiqueta", () => {
    const cols = toOptionColumns(
      option({ action: "stage", target: "draft-1", tagId: "t" }),
      0,
      "s1",
      (id) => (id === "draft-1" ? "real-9" : null),
    );
    expect(cols).toMatchObject({ action_type: "go_to_node", next_node_id: "real-9", tag_id: "t", end_session: false });
  });

  it("volta igual ao ler de novo", () => {
    const original = option({ action: "message", reply: "Oi", tagId: "t" });
    const cols = toOptionColumns(original, 0, "s1", identity);
    const back = fromRows([node("s1", "root", 1)], {
      s1: [row("o", "s1", 1, cols as Partial<BotOptionRow>)],
    }).options[0];
    expect(back).toMatchObject({ action: "message", reply: "Oi", tagId: "t" });
  });
});

describe("avisos, mapa e alterações", () => {
  it("aponta o que falta no botão", () => {
    expect(getOptionWarning(option({ label: " " }))).toBe("Escreva o texto do botão");
    expect(getOptionWarning(option({ action: "" }))).toBe("Escolha o que acontece ao tocar");
    expect(getOptionWarning(option({ action: "stage" }))).toBe("Escolha qual etapa abrir");
    expect(getOptionWarning(option({ action: "message" }))).toBe("Escreva a resposta");
    // "Adicionar tag" antigo sem mensagem não trava o salvamento
    expect(getOptionWarning(option({ action: "message", tagId: "t" }))).toBeNull();
    expect(getOptionWarning(option({}))).toBeNull();
  });

  it("monta o mapa sem repetir etapas e separa as soltas", () => {
    const state = fromRows([node("s1", "root", 1), node("s2", "node_2", 2), node("s3", "node_3", 3)], {
      s1: [row("a", "s1", 1, { action_type: "go_to_node", next_node_id: "s2", end_session: false })],
      s2: [row("b", "s2", 1, { action_type: "go_to_node", next_node_id: "s1", end_session: false })],
    });
    const tree = buildFlowTree(state);
    expect(tree.rows.map((r) => [r.stageId, r.depth, r.via])).toEqual([
      ["s1", 0, null],
      ["s2", 1, "Botão a"],
    ]);
    expect(tree.orphans).toEqual(["s3"]);
  });

  it("conta etapas e botões alterados, inclusive mudança de ordem", () => {
    const saved = fromRows([node("s1", "root", 1)], {
      s1: [row("a", "s1", 1, {}), row("b", "s1", 2, {})],
    });
    expect(countChanges(saved, saved)).toBe(0);
    const swapped = { ...saved, options: [saved.options[1], saved.options[0]] };
    expect(countChanges(saved, swapped)).toBe(2);
    const removed = { ...saved, options: [saved.options[0]] };
    expect(countChanges(saved, removed)).toBe(1);
  });

  it("gera chave de etapa livre", () => {
    expect(nextNodeKey([{ nodeKey: "root" }, { nodeKey: "node_2" }])).toBe("node_3");
  });
});

describe("etapa de IA", () => {
  const aiNode: BotNodeRow = {
    ...node("ai", "node_1", 2),
    node_type: "ai",
    message: "",
    ai_instructions: "Tire dúvidas sobre preços",
    ai_handoff_department_id: "dep-1",
  };

  it("lê o tipo e os campos da IA", () => {
    const state = fromRows([node("r", "root", 1), aiNode], {});
    const stage = state.stages.find((s) => s.id === "ai");
    expect(stage?.kind).toBe("ai");
    expect(stage?.aiInstructions).toBe("Tire dúvidas sobre preços");
    expect(stage?.aiDepartmentId).toBe("dep-1");
    expect(state.stages.find((s) => s.id === "r")?.kind).toBe("menu");
  });

  it("só fica incompleta sem objetivo (abertura e botões são opcionais)", () => {
    const state = fromRows([aiNode], {});
    const stage = state.stages[0];
    expect(isStageIncomplete(state, stage)).toBe(false);
    expect(isStageIncomplete(state, { ...stage, aiInstructions: " " })).toBe(true);
  });

  it("grava os campos da IA só na etapa de IA", () => {
    const [ai] = fromRows([aiNode], {}).stages;
    expect(toStageColumns(ai)).toMatchObject({
      node_type: "ai",
      ai_instructions: "Tire dúvidas sobre preços",
      ai_handoff_department_id: "dep-1",
    });
    expect(toStageColumns({ ...ai, kind: "menu" })).toMatchObject({
      node_type: "menu",
      ai_instructions: null,
      ai_handoff_department_id: null,
    });
  });

  it("trocar o tipo conta como alteração", () => {
    const saved = fromRows([aiNode], {});
    const current = {
      ...saved,
      stages: saved.stages.map((s) => ({ ...s, kind: "menu" as const })),
    };
    expect(countChanges(saved, current)).toBe(1);
  });
});
