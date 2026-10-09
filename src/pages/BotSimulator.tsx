import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { botsService } from "../services/bots";
import type {
  BotNodeRow,
  BotOptionRow,
  BotRow,
  DepartmentRow,
  TagRow,
} from "../types/bots";
import { BOT_ROOT_NODE_KEY } from "../types/bots";
import { toast } from "react-toastify";

type SimMessage =
  | { role: "bot"; text: string }
  | { role: "user"; text: string }
  | { role: "system"; text: string };

const actionTypeToLabel: Record<string, string> = {
  go_to_node: "Ir para etapa",
  transfer_to_department: "Transferir para departamento",
  add_tag: "Adicionar tag",
  send_message: "Enviar mensagem",
  handoff_to_human: "Transferência para atendente",
  end_flow: "Encerrar fluxo",
};

const roleStyles: Record<SimMessage["role"], string> = {
  bot: "bg-white border-slate-200 text-slate-800",
  user: "bg-blue-600 border-blue-600 text-white ml-auto",
  system: "bg-slate-50 border-slate-200 text-slate-600",
};

export const BotSimulator = ({
  clinicId,
  botId,
  bot,
}: {
  clinicId: string;
  botId: string;
  bot: BotRow;
}) => {
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<BotNodeRow[]>([]);
  const [optionsByNodeId, setOptionsByNodeId] = useState<
    Record<string, BotOptionRow[]>
  >({});
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);

  const [startNodeId, setStartNodeId] = useState<string | null>(null);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [history, setHistory] = useState<SimMessage[]>([]);

  const nodeById = useMemo(() => {
    const map = new Map<string, BotNodeRow>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const options = useMemo(() => {
    if (!currentNodeId) return [];
    return (optionsByNodeId[currentNodeId] ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [currentNodeId, optionsByNodeId]);

  const deptById = useMemo(() => {
    const map = new Map<string, DepartmentRow>();
    for (const d of departments) map.set(d.id, d);
    return map;
  }, [departments]);

  const tagById = useMemo(() => {
    const map = new Map<string, TagRow>();
    for (const t of tags) map.set(t.id, t);
    return map;
  }, [tags]);

  const load = useCallback(async () => {
    setLoading(true);
    const [nodesRes, depsRes, tagsRes] = await Promise.all([
      botsService.listNodes(botId),
      botsService.listDepartments(clinicId),
      botsService.listTags(clinicId),
    ]);
    setLoading(false);

    if (nodesRes.error) return toast.error(nodesRes.error.message);
    if (depsRes.error) toast.error(depsRes.error.message);
    if (tagsRes.error) toast.error(tagsRes.error.message);

    const list = nodesRes.data;
    setNodes(list);
    setDepartments(depsRes.data ?? []);
    setTags(tagsRes.data ?? []);

    const optionsMap: Record<string, BotOptionRow[]> = {};
    for (const n of list) {
      const optRes = await botsService.listOptions(n.id);
      if (optRes.error) {
        toast.error(optRes.error.message);
        continue;
      }
      optionsMap[n.id] = optRes.data;
    }
    setOptionsByNodeId(optionsMap);

    const root = list.find((n) => n.node_key === BOT_ROOT_NODE_KEY) ?? null;
    const initial = root?.id ?? list[0]?.id ?? null;
    setStartNodeId((prev) => prev ?? initial);
    setCurrentNodeId((prev) => prev ?? initial);
  }, [botId, clinicId]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = useCallback(
    (nodeId?: string | null) => {
      const nextNodeId = nodeId ?? startNodeId;
      setCurrentNodeId(nextNodeId ?? null);
      setEnded(false);

      const start: SimMessage[] = [];
      if (bot.start_message?.trim())
        start.push({ role: "bot", text: bot.start_message.trim() });
      const node = nextNodeId ? nodeById.get(nextNodeId) : null;
      if (node?.message?.trim())
        start.push({ role: "bot", text: node.message.trim() });
      setHistory(start);
    },
    [bot.start_message, nodeById, startNodeId],
  );

  useEffect(() => {
    if (!loading && history.length === 0) reset();
  }, [history.length, loading, reset]);

  const stepToNode = (nextNodeId: string | null) => {
    if (!nextNodeId) {
      setHistory((prev) => [
        ...prev,
        { role: "system", text: "Etapa de destino não definida." },
      ]);
      setEnded(true);
      return;
    }
    setCurrentNodeId(nextNodeId);
    const node = nodeById.get(nextNodeId);
    if (node?.message?.trim()) {
      setHistory((prev) => [
        ...prev,
        { role: "bot", text: node.message.trim() },
      ]);
    }
  };

  const handleChoose = (opt: BotOptionRow) => {
    if (ended) return;

    const selectedOptionText = opt.label?.trim() || opt.option_value;
    setHistory((prev) => [...prev, { role: "user", text: selectedOptionText }]);

    if (opt.message_to_send?.trim()) {
      setHistory((prev) => [
        ...prev,
        { role: "bot", text: opt.message_to_send!.trim() },
      ]);
    }

    if (opt.action_type === "go_to_node") {
      stepToNode(opt.next_node_id);
    } else if (opt.action_type === "transfer_to_department") {
      const d = opt.target_department_id
        ? deptById.get(opt.target_department_id)
        : null;
      setHistory((prev) => [
        ...prev,
        {
          role: "system",
          text: `Transferir para departamento: ${d?.name ?? opt.target_department_id ?? "-"}`,
        },
      ]);
      setEnded(Boolean(opt.end_session));
    } else if (opt.action_type === "add_tag") {
      const t = opt.tag_id ? tagById.get(opt.tag_id) : null;
      setHistory((prev) => [
        ...prev,
        {
          role: "system",
          text: `Adicionar tag: ${t?.name ?? opt.tag_id ?? "-"}`,
        },
      ]);
      setEnded(Boolean(opt.end_session));
    } else if (opt.action_type === "handoff_to_human") {
      setHistory((prev) => [
        ...prev,
        { role: "system", text: "Transferência para atendente" },
      ]);
      setEnded(true);
    } else if (opt.action_type === "end_flow") {
      setHistory((prev) => [...prev, { role: "system", text: "Fim do fluxo" }]);
      setEnded(true);
    } else if (opt.action_type === "send_message") {
      setEnded(Boolean(opt.end_session));
    } else {
      setHistory((prev) => [
        ...prev,
        { role: "system", text: `Ação: ${String(opt.action_type)}` },
      ]);
      setEnded(Boolean(opt.end_session));
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white"
          />
        ))}
      </div>
    );
  }

  const startNode = startNodeId ? nodeById.get(startNodeId) : null;
  const currentNode = currentNodeId ? nodeById.get(currentNodeId) : null;

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Simulador</h2>
            <p className="mt-1 text-sm text-slate-500">
              Preview local do fluxo (não chama o bot-engine).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => load()}>
              Recarregar dados
            </Button>
            <Button
              className="bg-green-500 hover:bg-green-400"
              variant="secondary"
              size="sm"
              onClick={() => reset()}
            >
              Reiniciar o fluxo
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="w-full">
            <label className="block text-sm font-medium text-[#1E1E1E] mb-1">
              Etapa inicial
            </label>
            <select
              value={startNodeId ?? ""}
              onChange={(e) => {
                const v = e.target.value || null;
                setStartNodeId(v);
                reset(v);
              }}
              className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:border-transparent bg-white"
            >
              <option value="">Selecione...</option>
              {nodes
                .slice()
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title} ({n.node_key})
                  </option>
                ))}
            </select>
            <div className="mt-1 text-xs text-slate-500">
              Recomendado: etapa inicial (root). Atual:{" "}
              {startNode?.node_key ?? "-"}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <div className="font-medium">Status</div>
            <div className="mt-1">
              Etapa atual:{" "}
              <span className="font-mono">{currentNode?.node_key ?? "-"}</span>
            </div>
            <div className="mt-1">Sessão: {ended ? "encerrada" : "ativa"}</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr,360px]">
        <Card className="p-4 sm:p-6">
          <div className="space-y-3">
            {history.length === 0 ? (
              <div className="text-sm text-slate-500">Sem mensagens.</div>
            ) : (
              history.map((m, idx) => (
                <div
                  key={idx}
                  className={[
                    "max-w-[80%] rounded-xl border px-4 py-3 text-sm leading-relaxed",
                    roleStyles[m.role],
                    m.role === "user" ? "ml-auto" : "",
                  ].join(" ")}
                >
                  {m.text}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-4 sm:p-6">
          <div className="text-sm font-semibold text-slate-900">
            Opções da etapa
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {currentNode
              ? `${currentNode.title} (${currentNode.node_key})`
              : "-"}
          </div>

          {ended ? (
            <div className="mt-4 text-sm text-slate-500">Sessão encerrada.</div>
          ) : options.length === 0 ? (
            <div className="mt-4 text-sm text-slate-500">
              Nenhuma opção disponível.
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleChoose(opt)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium text-slate-900">
                      {opt.option_value}. {opt.label}
                    </div>
                    <div className="text-xs text-slate-500">
                      {actionTypeToLabel[opt.action_type] ?? opt.action_type}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
