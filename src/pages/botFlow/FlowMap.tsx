import { PlusIcon, SparklesIcon } from "lucide-react";
import {
  buildFlowTree,
  isStageIncomplete,
  optionsOf,
  type FlowState,
} from "./flowModel";

const countLabel = (n: number) =>
  n === 0 ? "sem botões" : n === 1 ? "1 botão" : `${n} botões`;

export const FlowMap = ({
  state,
  selectedId,
  disabled,
  onSelect,
  onNewStage,
}: {
  state: FlowState;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (stageId: string) => void;
  onNewStage: () => void;
}) => {
  const { rows, orphans } = buildFlowTree(state);
  const byId = new Map(state.stages.map((s) => [s.id, s]));

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[15px] font-bold text-slate-900">
            Mapa do fluxo
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Na ordem em que o cliente passa
          </div>
        </div>
        <button
          type="button"
          onClick={onNewStage}
          disabled={disabled}
          aria-label="Nova etapa"
          title="Nova etapa"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-blue-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col">
        {rows.map((row) => {
          const stage = byId.get(row.stageId);
          if (!stage) return null;
          const selected = stage.id === selectedId;
          const n = optionsOf(state, stage.id).length;
          return (
            <div
              key={stage.id}
              style={
                row.depth > 0
                  ? { marginLeft: 12 + (row.depth - 1) * 16 }
                  : undefined
              }
              className={row.depth > 0 ? "border-l-2 border-slate-200 pl-2.5" : ""}
            >
              <button
                type="button"
                onClick={() => onSelect(stage.id)}
                className={[
                  "my-0.5 flex w-full flex-col gap-0.5 rounded-xl px-2.5 py-2 text-left transition",
                  selected
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-900 hover:bg-slate-50",
                ].join(" ")}
              >
                <span className="flex w-full items-center gap-2">
                  <span
                    className={[
                      "h-2 w-2 flex-none rounded-full",
                      stage.isRoot
                        ? "bg-green-600"
                        : selected
                          ? "bg-blue-500"
                          : "bg-slate-300",
                    ].join(" ")}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {stage.name || "(sem nome)"}
                  </span>
                  {isStageIncomplete(state, stage) ? (
                    <span className="whitespace-nowrap text-[11px] font-semibold text-orange-700">
                      incompleta
                    </span>
                  ) : null}
                  {stage.kind === "ai" ? (
                    <span className="flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-violet-700">
                      <SparklesIcon className="h-3 w-3" />
                      IA
                    </span>
                  ) : (
                    <span className="whitespace-nowrap text-xs text-slate-500">
                      {countLabel(n)}
                    </span>
                  )}
                </span>
                <span className="truncate pl-4 text-xs text-slate-500">
                  {stage.isRoot ? "Primeira mensagem" : `Botão “${row.via}”`}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {orphans.length > 0 ? (
        <div className="flex flex-col gap-0.5 border-t border-slate-100 pt-3">
          <div className="px-2.5 pb-1 text-xs font-semibold text-slate-500">
            Ainda sem ligação
          </div>
          {orphans.map((id) => {
            const stage = byId.get(id);
            if (!stage) return null;
            const selected = id === selectedId;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                className={[
                  "flex w-full flex-col gap-0.5 rounded-xl px-2.5 py-2 text-left transition",
                  selected
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-900 hover:bg-slate-50",
                ].join(" ")}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="box-border h-2 w-2 flex-none rounded-full border-[1.5px] border-dashed border-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {stage.name || "(sem nome)"}
                  </span>
                </span>
                <span className="pl-4 text-xs text-slate-500">
                  Nenhum botão leva até aqui
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
