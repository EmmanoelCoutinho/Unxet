import React, { useEffect, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "../../../components/ui/Button";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import { usePipelineSettingsActions } from "../hooks/useLeads";
import type { LossReason, Pipeline, PipelineStage } from "../types/leads";
import { FIELD_CLASS, LeadModal } from "./LeadModal";

const KIND_LABEL: Record<PipelineStage["kind"], string> = {
  open: "Em andamento",
  won: "Ganho",
  lost: "Perdido",
};

const STAGE_COLORS = ["#3b82f6", "#8b5cf6", "#06b6d4", "#f59e0b", "#f97316", "#ec4899", "#64748b"];

export const PipelineSettingsModal: React.FC<{
  clinicId: string;
  pipelines: Pipeline[];
  activePipelineId: string;
  lossReasons: LossReason[];
  dealCountByStage: Record<string, number>;
  onClose: () => void;
  onSelectPipeline: (id: string) => void;
}> = ({ clinicId, pipelines, activePipelineId, lossReasons, dealCountByStage, onClose, onSelectPipeline }) => {
  const confirm = useConfirm();
  const actions = usePipelineSettingsActions();
  const pipeline = pipelines.find((p) => p.id === activePipelineId) ?? pipelines[0];
  const [pipelineName, setPipelineName] = useState(pipeline?.name ?? "");
  useEffect(() => {
    setPipelineName(pipeline?.name ?? "");
  }, [pipeline?.id, pipeline?.name]);
  const [newStage, setNewStage] = useState("");
  const [newReason, setNewReason] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  if (!pipeline) return null;

  const stages = pipeline.stages;
  const openStages = stages.filter((s) => s.kind === "open");

  // Regrava as posições na ordem da lista (só as que mudaram)
  const savePositions = async (ordered: PipelineStage[]) => {
    await Promise.all(
      ordered.map((s, index) => (s.position === index ? null : actions.updateStage(s.id, { position: index }))),
    );
  };

  const move = (stage: PipelineStage, delta: -1 | 1) => {
    // Etapas de fechamento ficam sempre no fim; as abertas trocam entre si
    const index = openStages.findIndex((s) => s.id === stage.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= openStages.length) return;
    const reordered = [...openStages];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const closing = stages.filter((s) => s.kind !== "open");
    void run(() => savePositions([...reordered, ...closing]));
  };

  const addStage = (event: React.FormEvent) => {
    event.preventDefault();
    const name = newStage.trim();
    if (!name) return;
    const closing = stages.filter((s) => s.kind !== "open");
    void run(async () => {
      await actions.createStage({
        clinicId,
        pipelineId: pipeline.id,
        name,
        color: STAGE_COLORS[openStages.length % STAGE_COLORS.length],
        position: openStages.length,
        kind: "open",
      });
      // Empurra Ganho/Perdido para depois da nova etapa
      await Promise.all(
        closing.map((s, i) => actions.updateStage(s.id, { position: openStages.length + 1 + i })),
      );
      setNewStage("");
    }, "Etapa criada.");
  };

  const removeStage = async (stage: PipelineStage) => {
    if ((dealCountByStage[stage.id] ?? 0) > 0) {
      toast.error("Mova as negociações desta etapa antes de excluí-la.");
      return;
    }
    if (stage.kind !== "open" && stages.filter((s) => s.kind === stage.kind).length <= 1) {
      toast.error(`O funil precisa de uma etapa de "${KIND_LABEL[stage.kind]}".`);
      return;
    }
    if (stage.kind === "open" && openStages.length <= 1) {
      toast.error("O funil precisa de pelo menos uma etapa em andamento.");
      return;
    }
    const ok = await confirm({
      title: `Excluir a etapa "${stage.name}"?`,
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (ok) void run(() => actions.deleteStage(stage.id), "Etapa excluída.");
  };

  const addPipeline = () =>
    run(async () => {
      const id = await actions.createPipeline(clinicId, `Funil ${pipelines.length + 1}`, pipelines.length);
      onSelectPipeline(id);
    }, "Funil criado. Renomeie e ajuste as etapas.");

  const removePipeline = async () => {
    if (pipelines.length <= 1) {
      toast.error("A empresa precisa de pelo menos um funil.");
      return;
    }
    const ok = await confirm({
      title: `Excluir o funil "${pipeline.name}"?`,
      description: "Só dá para excluir um funil sem negociações.",
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    void run(async () => {
      await actions.deletePipeline(pipeline.id);
      onSelectPipeline(pipelines.find((p) => p.id !== pipeline.id)!.id);
    }, "Funil excluído.");
  };

  return (
    <LeadModal title="Configurar funil" subtitle="Só administradores alteram." onClose={onClose} width="max-w-2xl">
      <div className="space-y-6">
        {/* Funis */}
        <section>
          <div className="flex flex-wrap items-center gap-2">
            {pipelines.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectPipeline(p.id)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  p.id === pipeline.id ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {p.name}
              </button>
            ))}
            <button
              type="button"
              onClick={addPipeline}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Novo funil
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={pipelineName}
              maxLength={60}
              onChange={(event) => setPipelineName(event.target.value)}
              onBlur={() => {
                if (pipelineName.trim() && pipelineName.trim() !== pipeline.name) {
                  void run(() => actions.renamePipeline(pipeline.id, pipelineName), "Nome salvo.");
                }
              }}
              className={FIELD_CLASS}
              aria-label="Nome do funil"
            />
            {pipelines.length > 1 && (
              <Button type="button" variant="ghost" size="sm" onClick={removePipeline} className="border border-red-200 text-red-600">
                Excluir funil
              </Button>
            )}
          </div>
        </section>

        {/* Etapas */}
        <section>
          <h3 className="text-sm font-semibold text-slate-800">Etapas</h3>
          <p className="mt-1 text-xs text-slate-500">
            "Ganho" e "Perdido" fecham a negociação e ficam sempre no fim.
          </p>
          <ul className="mt-3 space-y-2">
            {stages.map((stage) => {
              const openIndex = openStages.findIndex((s) => s.id === stage.id);
              return (
                <StageRow
                  key={`${stage.id}-${stage.name}-${stage.color}`}
                  stage={stage}
                  count={dealCountByStage[stage.id] ?? 0}
                  canUp={stage.kind === "open" && openIndex > 0}
                  canDown={stage.kind === "open" && openIndex < openStages.length - 1}
                  onUp={() => move(stage, -1)}
                  onDown={() => move(stage, 1)}
                  onSave={(patch) => run(() => actions.updateStage(stage.id, patch))}
                  onDelete={() => removeStage(stage)}
                  busy={busy}
                />
              );
            })}
          </ul>
          <form onSubmit={addStage} className="mt-3 flex gap-2">
            <input
              value={newStage}
              maxLength={40}
              onChange={(event) => setNewStage(event.target.value)}
              placeholder="Nova etapa (ex.: Avaliação agendada)"
              className={FIELD_CLASS}
              aria-label="Nova etapa"
            />
            <Button type="submit" size="sm" disabled={busy || !newStage.trim()} className="rounded-full">
              Adicionar
            </Button>
          </form>
        </section>

        {/* Motivos de perda */}
        <section>
          <h3 className="text-sm font-semibold text-slate-800">Motivos de perda</h3>
          <p className="mt-1 text-xs text-slate-500">Aparecem ao marcar uma negociação como perdida.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {lossReasons.map((reason) => (
              <li
                key={reason.id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                  reason.archivedAt ? "border-dashed border-slate-200 text-slate-400 line-through" : "border-slate-200 text-slate-700"
                }`}
              >
                {reason.name}
                <button
                  type="button"
                  onClick={() => run(() => actions.archiveLossReason(reason.id, !reason.archivedAt))}
                  className="text-xs font-medium text-slate-400 no-underline hover:text-slate-700"
                >
                  {reason.archivedAt ? "reativar" : "ocultar"}
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!newReason.trim()) return;
              void run(async () => {
                await actions.createLossReason(clinicId, newReason, lossReasons.length);
                setNewReason("");
              });
            }}
            className="mt-3 flex gap-2"
          >
            <input
              value={newReason}
              maxLength={60}
              onChange={(event) => setNewReason(event.target.value)}
              placeholder="Novo motivo"
              className={FIELD_CLASS}
              aria-label="Novo motivo de perda"
            />
            <Button type="submit" size="sm" disabled={busy || !newReason.trim()} className="rounded-full">
              Adicionar
            </Button>
          </form>
        </section>
      </div>
    </LeadModal>
  );
};

const StageRow: React.FC<{
  stage: PipelineStage;
  count: number;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onSave: (patch: { name?: string; color?: string }) => void;
  onDelete: () => void;
  busy: boolean;
}> = ({ stage, count, canUp, canDown, onUp, onDown, onSave, onDelete, busy }) => {
  const [name, setName] = useState(stage.name);
  // A cor muda a cada movimento do seletor: só grava ao sair dele
  const [color, setColor] = useState(stage.color);
  return (
    <li className="flex items-center gap-2 rounded-xl border border-slate-200 p-2">
      <label className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-full border border-slate-200" style={{ backgroundColor: color }}>
        <span className="sr-only">Cor da etapa {stage.name}</span>
        <input
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
          onBlur={() => {
            if (color !== stage.color) onSave({ color });
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <input
        value={name}
        maxLength={40}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name.trim() && name.trim() !== stage.name) onSave({ name: name.trim() });
          else setName(stage.name);
        }}
        className={`${FIELD_CLASS} py-1.5`}
        aria-label={`Nome da etapa ${stage.name}`}
      />
      <span className="hidden flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 sm:inline">
        {KIND_LABEL[stage.kind]} · {count}
      </span>
      <button type="button" onClick={onUp} disabled={!canUp || busy} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Subir">
        <ArrowUpIcon className="h-4 w-4" />
      </button>
      <button type="button" onClick={onDown} disabled={!canDown || busy} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Descer">
        <ArrowDownIcon className="h-4 w-4" />
      </button>
      <button type="button" onClick={onDelete} disabled={busy} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label={`Excluir etapa ${stage.name}`}>
        <Trash2Icon className="h-4 w-4" />
      </button>
    </li>
  );
};
