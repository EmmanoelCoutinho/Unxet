import { botsService } from "../../services/bots";
import {
  isOptionChanged,
  isStageChanged,
  optionIndexMap,
  toOptionColumns,
  toStageColumns,
  type FlowState,
} from "./flowModel";

// Grava a diferença entre o fluxo salvo e o editado. Devolve o mapa de ids
// provisórios → ids do banco das etapas criadas.
export const saveFlow = async (params: {
  clinicId: string;
  botId: string;
  saved: FlowState;
  current: FlowState;
}): Promise<{ stageIds: Record<string, string>; error: Error | null }> => {
  const { clinicId, botId, saved, current } = params;
  const stageIds: Record<string, string> = {};
  for (const s of current.stages) if (!s.isNew) stageIds[s.id] = s.id;
  const fail = (error: Error) => ({ stageIds, error });

  // 1. Etapas novas primeiro: os botões podem apontar para elas
  for (const [index, s] of current.stages.entries()) {
    if (!s.isNew) continue;
    const res = await botsService.createNode({
      ...toStageColumns(s),
      bot_id: botId,
      clinic_id: clinicId,
      node_key: s.nodeKey,
      title: s.name.trim() || "Nova etapa",
      sort_order: index + 1,
    });
    if (res.error) return fail(res.error);
    stageIds[s.id] = res.data.id;
  }

  // 2. Etapas alteradas
  const savedStages = new Map(saved.stages.map((s) => [s.id, s]));
  for (const s of current.stages) {
    if (s.isNew || !isStageChanged(savedStages.get(s.id), s)) continue;
    const res = await botsService.updateNode(s.id, toStageColumns(s));
    if (res.error) return fail(res.error);
  }

  // 3. Remoções (apagar a etapa apaga os botões dela no banco)
  const currentOptionIds = new Set(current.options.map((o) => o.id));
  const currentStageIds = new Set(current.stages.map((s) => s.id));
  for (const o of saved.options) {
    if (currentOptionIds.has(o.id) || !currentStageIds.has(o.stageId)) continue;
    const res = await botsService.deleteOption(o.id);
    if (res.error) return fail(res.error);
  }
  for (const s of saved.stages) {
    if (currentStageIds.has(s.id) || s.isRoot) continue;
    const res = await botsService.deleteNode(s.id);
    if (res.error) return fail(res.error);
  }

  // 4. Botões. O número de cada um é a posição, e (etapa, número) é único:
  // quem vai mudar de número recebe antes um valor provisório.
  const resolve = (id: string) => stageIds[id] ?? null;
  const savedIdx = optionIndexMap(saved);
  const currentIdx = optionIndexMap(current);
  const savedOptions = new Map(saved.options.map((o) => [o.id, o]));

  const renumbered = current.options.filter(
    (o) => !o.isNew && o.savedValue !== String(currentIdx[o.id] + 1),
  );
  for (const o of renumbered) {
    const res = await botsService.updateOption(o.id, {
      option_value: `tmp-${o.id}`,
    });
    if (res.error) return fail(res.error);
  }
  const renumberedIds = new Set(renumbered.map((o) => o.id));

  for (const o of current.options) {
    const index = currentIdx[o.id];
    const stageRealId = stageIds[o.stageId];
    if (!stageRealId) continue;
    const columns = toOptionColumns(o, index, stageRealId, resolve);

    if (o.isNew) {
      const res = await botsService.createOption({
        ...columns,
        bot_node_id: stageRealId,
        clinic_id: clinicId,
      });
      if (res.error) return fail(res.error);
      continue;
    }

    const changed = isOptionChanged(
      savedOptions.get(o.id),
      savedIdx[o.id],
      o,
      index,
    );
    if (!changed && !renumberedIds.has(o.id)) continue;
    const res = await botsService.updateOption(o.id, columns);
    if (res.error) return fail(res.error);
  }

  return { stageIds, error: null };
};
