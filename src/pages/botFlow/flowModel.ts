import {
  BOT_MENU_MAX_OPTIONS,
  BOT_ROOT_NODE_KEY,
  type BotNodeRow,
  type BotOptionRow,
  type CreateBotOptionInput,
} from "../../types/bots";

// Modelo do editor de fluxo. A tela fala em "etapas" e "botões" com 4 ações
// simples; aqui é feita a tradução de/para as colunas de bot_nodes/bot_options.

export type FlowAction = "" | "stage" | "human" | "message" | "end";

// "menu": mensagem com botões. "ai": a IA conversa com o cliente.
export type FlowStageKind = "menu" | "ai";

export type FlowStage = {
  id: string;
  isNew: boolean;
  isRoot: boolean;
  kind: FlowStageKind;
  name: string;
  // Na etapa de IA é a mensagem de abertura (opcional)
  message: string;
  nodeKey: string;
  aiInstructions: string;
  aiDepartmentId: string;
};

export type FlowOption = {
  id: string;
  isNew: boolean;
  stageId: string;
  label: string;
  action: FlowAction;
  target: string;
  departmentId: string;
  reply: string;
  tagId: string;
  // Valor gravado no banco (o número que o cliente digita); vazio se novo
  savedValue: string;
};

// A ordem de `options` é a ordem dos botões dentro de cada etapa
export type FlowState = { stages: FlowStage[]; options: FlowOption[] };

export const FLOW_ACTIONS: Array<{
  key: Exclude<FlowAction, "">;
  short: string;
  help: string;
}> = [
  { key: "stage", short: "Abrir etapa", help: "Mostra outra mensagem com novos botões." },
  { key: "human", short: "Atendente", help: "O bot para e alguém da equipe assume a conversa." },
  { key: "message", short: "Responder", help: "Envia um texto, como horário ou endereço, e mostra os botões de novo." },
  { key: "end", short: "Encerrar", help: "Envia uma despedida (opcional) e o bot termina." },
];

export const makeDraftId = (prefix: string) =>
  `draft-${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const rowToAction = (row: BotOptionRow): FlowAction => {
  switch (row.action_type) {
    case "go_to_node":
      return "stage";
    case "transfer_to_department":
    case "handoff_to_human":
      return "human";
    case "end_flow":
      return "end";
    // Mensagem/etiqueta que encerravam a sessão passavam a conversa para a
    // equipe no bot-engine: é o mesmo que "Atendente" com aviso
    case "send_message":
    case "add_tag":
      return row.end_session && !row.next_node_id ? "human" : "message";
    default:
      return "";
  }
};

export const fromRows = (
  nodes: BotNodeRow[],
  optionsByNodeId: Record<string, BotOptionRow[]>,
): FlowState => {
  const sorted = [...nodes].sort((a, b) => {
    const aRoot = a.node_key === BOT_ROOT_NODE_KEY ? 0 : 1;
    const bRoot = b.node_key === BOT_ROOT_NODE_KEY ? 0 : 1;
    return aRoot - bRoot || (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });

  const stages: FlowStage[] = sorted.map((n) => ({
    id: n.id,
    isNew: false,
    isRoot: n.node_key === BOT_ROOT_NODE_KEY,
    kind: n.node_type === "ai" ? "ai" : "menu",
    name: n.title ?? "",
    message: n.message ?? "",
    nodeKey: n.node_key,
    aiInstructions: n.ai_instructions ?? "",
    aiDepartmentId: n.ai_handoff_department_id ?? "",
  }));

  const options: FlowOption[] = [];
  for (const stage of stages) {
    const rows = [...(optionsByNodeId[stage.id] ?? [])].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
    for (const row of rows) {
      const action = rowToAction(row);
      options.push({
        id: row.id,
        isNew: false,
        stageId: stage.id,
        label: row.label ?? "",
        action,
        target: action === "stage" ? (row.next_node_id ?? "") : "",
        departmentId: row.target_department_id ?? "",
        reply: row.message_to_send ?? "",
        tagId: row.tag_id ?? "",
        savedValue: row.option_value,
      });
    }
  }

  return { stages, options };
};

export const optionsOf = (state: FlowState, stageId: string) =>
  state.options.filter((o) => o.stageId === stageId);

export const getOptionWarning = (o: FlowOption) => {
  if (!o.label.trim()) return "Escreva o texto do botão";
  if (!o.action) return "Escolha o que acontece ao tocar";
  if (o.action === "stage" && !o.target) return "Escolha qual etapa abrir";
  // Com etiqueta a resposta é opcional: o botão só marca e mostra os botões
  if (o.action === "message" && !o.reply.trim() && !o.tagId) {
    return "Escreva a resposta";
  }
  return null;
};

// Na etapa de IA a abertura é opcional; o que ela precisa é saber o objetivo
export const isStageIncomplete = (state: FlowState, stage: FlowStage) =>
  stage.kind === "ai"
    ? !stage.aiInstructions.trim()
    : !stage.message.trim() ||
      optionsOf(state, stage.id).some((o) => getOptionWarning(o) !== null);

// Colunas gravadas para uma etapa
export const toStageColumns = (s: FlowStage) => ({
  title: s.name.trim() || "Etapa sem nome",
  message: s.message.trim(),
  node_type: s.kind,
  ai_instructions: s.kind === "ai" ? s.aiInstructions.trim() || null : null,
  ai_handoff_department_id:
    s.kind === "ai" ? s.aiDepartmentId || null : null,
});

// Colunas gravadas para um botão. `stageRealId` e `resolveStageId` trocam os
// ids provisórios das etapas criadas nesta edição pelos ids do banco.
export const toOptionColumns = (
  o: FlowOption,
  index: number,
  stageRealId: string,
  resolveStageId: (id: string) => string | null,
): Omit<CreateBotOptionInput, "bot_node_id" | "clinic_id"> => {
  const base = {
    option_value: String(index + 1),
    label: o.label.trim(),
    sort_order: index + 1,
    tag_id: o.tagId || null,
    message_to_send: o.reply.trim() || null,
    next_node_id: null as string | null,
    target_department_id: null as string | null,
  };

  switch (o.action) {
    case "stage":
      return {
        ...base,
        action_type: "go_to_node",
        next_node_id: o.target ? resolveStageId(o.target) : null,
        end_session: false,
      };
    case "human":
      return {
        ...base,
        action_type: o.departmentId ? "transfer_to_department" : "handoff_to_human",
        target_department_id: o.departmentId || null,
        end_session: true,
      };
    case "message":
      // Apontar para a própria etapa faz o bot-engine reenviar os botões
      return {
        ...base,
        action_type: "send_message",
        next_node_id: stageRealId,
        end_session: false,
      };
    case "end":
    default:
      return { ...base, action_type: "end_flow", end_session: true };
  }
};

export const nextNodeKey = (stages: Array<Pick<FlowStage, "nodeKey">>) => {
  const used = new Set(stages.map((s) => s.nodeKey));
  let n = stages.length;
  while (used.has(`node_${n}`)) n++;
  return `node_${n}`;
};

const stageSignature = (s: FlowStage) =>
  JSON.stringify([s.name, s.message, s.kind, s.aiInstructions, s.aiDepartmentId]);
const optionSignature = (o: FlowOption, index: number) =>
  JSON.stringify([
    o.stageId,
    index,
    o.label,
    o.action,
    o.target,
    o.departmentId,
    o.reply,
    o.tagId,
  ]);

export const optionIndexMap = (state: FlowState) => {
  const counters: Record<string, number> = {};
  const map: Record<string, number> = {};
  for (const o of state.options) {
    const i = counters[o.stageId] ?? 0;
    map[o.id] = i;
    counters[o.stageId] = i + 1;
  }
  return map;
};

export const isOptionChanged = (
  before: FlowOption | undefined,
  beforeIndex: number | undefined,
  after: FlowOption,
  afterIndex: number,
) =>
  !before ||
  beforeIndex === undefined ||
  optionSignature(before, beforeIndex) !== optionSignature(after, afterIndex);

export const isStageChanged = (before: FlowStage | undefined, after: FlowStage) =>
  !before || stageSignature(before) !== stageSignature(after);

// Quantas etapas/botões mudaram (criados, alterados ou removidos)
export const countChanges = (saved: FlowState, current: FlowState) => {
  let count = 0;
  const savedStages = new Map(saved.stages.map((s) => [s.id, s]));
  const currentStageIds = new Set(current.stages.map((s) => s.id));
  for (const s of current.stages) {
    const before = savedStages.get(s.id);
    if (!before || stageSignature(before) !== stageSignature(s)) count++;
  }
  for (const s of saved.stages) if (!currentStageIds.has(s.id)) count++;

  const savedIdx = optionIndexMap(saved);
  const currentIdx = optionIndexMap(current);
  const savedOptions = new Map(saved.options.map((o) => [o.id, o]));
  const currentOptionIds = new Set(current.options.map((o) => o.id));
  for (const o of current.options) {
    const before = savedOptions.get(o.id);
    if (
      !before ||
      optionSignature(before, savedIdx[o.id]) !==
        optionSignature(o, currentIdx[o.id])
    ) {
      count++;
    }
  }
  for (const o of saved.options) if (!currentOptionIds.has(o.id)) count++;
  return count;
};

export type FlowTreeRow = {
  stageId: string;
  depth: number;
  via: string | null;
};

// Etapas na ordem em que o cliente passa por elas, a partir do início.
// Etapas já listadas não se repetem (voltas ao início, por exemplo).
export const buildFlowTree = (state: FlowState) => {
  const rows: FlowTreeRow[] = [];
  const seen = new Set<string>();
  const byId = new Map(state.stages.map((s) => [s.id, s]));

  const walk = (stageId: string, depth: number, via: string | null) => {
    if (seen.has(stageId) || !byId.has(stageId)) return;
    seen.add(stageId);
    rows.push({ stageId, depth, via });
    for (const o of optionsOf(state, stageId)) {
      if (o.action === "stage" && o.target) {
        walk(o.target, depth + 1, o.label.trim() || "sem texto");
      }
    }
  };

  const root = state.stages.find((s) => s.isRoot);
  if (root) walk(root.id, 0, null);

  const orphans = state.stages.filter((s) => !seen.has(s.id)).map((s) => s.id);
  return { rows, orphans };
};

export const canAddOption = (state: FlowState, stageId: string) =>
  optionsOf(state, stageId).length < BOT_MENU_MAX_OPTIONS;
