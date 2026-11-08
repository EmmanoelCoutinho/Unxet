import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { adminSupabase } from "../lib/adminSupabaseClient";
import { aiUsageLevel, type AiUsageLevel } from "../../../lib/aiUsage";

// Adicional "Assistente com IA": a Unxet liga por empresa com um limite de
// respostas por mês e, no plano sob medida, escreve instruções extras que só
// a Unxet vê (a empresa edita o resto em "Assistente com IA").

const levelOf = (row: { ai_replies_addon: number | null; replies_this_month: number }): AiUsageLevel | null =>
  row.ai_replies_addon === null ? null : aiUsageLevel(row.replies_this_month, row.ai_replies_addon);

// Esgotadas primeiro, depois as perto do limite, as ligadas e as desligadas
const LEVEL_ORDER: Record<string, number> = { exhausted: 0, warning: 1, ok: 2, off: 3 };

const UsageBadge: React.FC<{ level: AiUsageLevel | null }> = ({ level }) =>
  level === "exhausted" ? (
    <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">Esgotou</span>
  ) : level === "warning" ? (
    <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Acima de 80%</span>
  ) : null;

type AiClinicRow = {
  clinic_id: string;
  clinic_name: string;
  ai_replies_addon: number | null;
  replies_this_month: number;
  input_tokens_this_month: number;
  output_tokens_this_month: number;
  custom_instructions: string;
};

const LIMIT_MIN = 50;
const LIMIT_MAX = 100000;
const DEFAULT_LIMIT = 1000;
const aiQueryKey = ["admin", "ai-addon"] as const;

const fetchRows = async (): Promise<AiClinicRow[]> => {
  const { data, error } = await adminSupabase.rpc("platform_list_ai");
  if (error) throw error;
  return (data ?? []) as AiClinicRow[];
};

const saveRow = async (params: {
  clinicId: string;
  limit: number | null;
  customInstructions: string;
}) => {
  const { error } = await adminSupabase.rpc("platform_set_ai", {
    p_clinic_id: params.clinicId,
    p_ai_replies_addon: params.limit,
    p_custom_instructions: params.customInstructions,
  });
  if (error) throw error;
};

const formatNumber = (n: number) => n.toLocaleString("pt-BR");

const Editor = ({
  row,
  onClose,
}: {
  row: AiClinicRow;
  onClose: () => void;
}) => {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(row.ai_replies_addon !== null);
  const [limit, setLimit] = useState(String(row.ai_replies_addon ?? DEFAULT_LIMIT));
  const [instructions, setInstructions] = useState(row.custom_instructions);

  const limitNumber = Number(limit);
  const limitValid =
    !enabled ||
    (Number.isInteger(limitNumber) && limitNumber >= LIMIT_MIN && limitNumber <= LIMIT_MAX);

  const mutation = useMutation({
    mutationFn: saveRow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiQueryKey });
      toast.success("IA da empresa salva.");
      onClose();
    },
    onError: (err: Error) =>
      toast.error(err.message || "Não foi possível salvar. Tente novamente."),
  });

  return (
    <div className="space-y-4 border-t border-gray-200 bg-slate-50 p-4 sm:p-5">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Adicional de IA ligado
      </label>

      {enabled ? (
        <div>
          <label htmlFor={`ai-limit-${row.clinic_id}`} className="mb-1 block text-sm font-medium text-gray-700">
            Respostas da IA por mês
          </label>
          <input
            id={`ai-limit-${row.clinic_id}`}
            type="number"
            min={LIMIT_MIN}
            max={LIMIT_MAX}
            step={50}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-40 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          />
          {!limitValid ? (
            <p className="mt-1 text-xs text-red-600">
              Entre {formatNumber(LIMIT_MIN)} e {formatNumber(LIMIT_MAX)}.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          Desligado: as etapas de IA dos bots passam a conversa direto para a equipe.
        </p>
      )}

      <div>
        <label htmlFor={`ai-custom-${row.clinic_id}`} className="mb-1 block text-sm font-medium text-gray-700">
          Instruções sob medida (só a Unxet vê)
        </label>
        <p className="mb-2 text-xs text-gray-500">
          Para o plano sob demanda: regras e conhecimento extra que a Unxet
          configura com a empresa. Somam com o que a empresa escreve.
        </p>
        <textarea
          id={`ai-custom-${row.clinic_id}`}
          rows={8}
          maxLength={20000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="w-full resize-y rounded-lg border border-gray-200 bg-white p-3 text-sm"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!limitValid}
          isLoading={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              clinicId: row.clinic_id,
              limit: enabled ? limitNumber : null,
              customInstructions: instructions.trim(),
            })
          }
        >
          Salvar
        </Button>
      </div>
    </div>
  );
};

export const AiAddonPage: React.FC = () => {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useQuery({ queryKey: aiQueryKey, queryFn: fetchRows });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = query.data ?? [];
    const filtered = term
      ? all.filter((r) => r.clinic_name.toLowerCase().includes(term))
      : all;
    // Quem precisa de atenção (esgotou ou passou de 80%) aparece primeiro
    return [...filtered].sort(
      (a, b) => LEVEL_ORDER[levelOf(a) ?? "off"] - LEVEL_ORDER[levelOf(b) ?? "off"],
    );
  }, [query.data, search]);

  const attention = useMemo(() => {
    const all = query.data ?? [];
    return {
      exhausted: all.filter((r) => levelOf(r) === "exhausted").length,
      warning: all.filter((r) => levelOf(r) === "warning").length,
    };
  }, [query.data]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Assistente com IA</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ligue o adicional por empresa, defina o limite de respostas por mês e
          escreva instruções sob medida. O consumo zera todo dia 1º.
        </p>
      </div>

      {attention.exhausted + attention.warning > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {attention.exhausted > 0
            ? `${attention.exhausted} ${attention.exhausted === 1 ? "empresa esgotou" : "empresas esgotaram"} as respostas do mês`
            : null}
          {attention.exhausted > 0 && attention.warning > 0 ? " e " : null}
          {attention.warning > 0
            ? `${attention.warning} ${attention.warning === 1 ? "está" : "estão"} acima de 80%`
            : null}
          . Bom momento para oferecer um limite maior.
        </div>
      ) : null}

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar empresa"
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm sm:w-72"
      />

      {query.isLoading ? (
        <div className="h-40 animate-pulse rounded-lg border border-gray-200 bg-white" />
      ) : query.isError ? (
        <Card className="flex flex-col items-start gap-3 p-5 text-sm text-gray-600">
          <p>Não foi possível carregar as empresas.</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : (
        <Card className="divide-y divide-gray-200 overflow-hidden p-0">
          {rows.length === 0 ? (
            <p className="p-5 text-sm text-gray-500">Nenhuma empresa encontrada.</p>
          ) : (
            rows.map((row) => {
              const on = row.ai_replies_addon !== null;
              const open = openId === row.clinic_id;
              return (
                <div key={row.clinic_id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : row.clinic_id)}
                    className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center truncate text-sm font-medium text-gray-900">
                        <span className="truncate">{row.clinic_name || "Empresa sem nome"}</span>
                        <UsageBadge level={levelOf(row)} />
                      </span>
                      <span className="text-xs text-gray-500">
                        {on
                          ? `${formatNumber(row.replies_this_month)} de ${formatNumber(row.ai_replies_addon ?? 0)} respostas neste mês`
                          : "Adicional desligado"}
                        {row.custom_instructions ? " · com instruções sob medida" : ""}
                      </span>
                    </span>
                    {on ? (
                      <span className="text-xs text-gray-500">
                        {formatNumber(row.input_tokens_this_month)} tokens de entrada ·{" "}
                        {formatNumber(row.output_tokens_this_month)} de saída
                      </span>
                    ) : null}
                  </button>
                  {open ? <Editor row={row} onClose={() => setOpenId(null)} /> : null}
                </div>
              );
            })
          )}
        </Card>
      )}
    </div>
  );
};
