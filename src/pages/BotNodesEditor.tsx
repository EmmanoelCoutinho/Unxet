import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Textarea } from "../components/ui/Textarea";
import { Toggle } from "../components/ui/Toggle";
import { Badge } from "../components/ui/Badge";
import { botsService } from "../services/bots";
import {
  BOT_OPTION_ACTION_TYPE_VALUES,
  BOT_ROOT_NODE_KEY,
  type BotNodeRow,
  type BotOptionRow,
  type CreateBotOptionInput,
  type DepartmentRow,
  type TagRow,
  type UpdateBotOptionInput,
} from "../types/bots";

type OptionDraft = Omit<BotOptionRow, "id"> & {
  __draftId: string;
  clinic_id?: string;
  bot_node_id?: string;
};

const makeDraftId = () =>
  `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const ensureValueInList = (values: string[], current: string) => {
  if (!current) return values;
  return values.includes(current) ? values : [...values, current];
};

const actionTypeToLabel: Record<string, string> = {
  go_to_node: "Ir para etapa",
  transfer_to_department: "Transferir para departamento",
  add_tag: "Adicionar tag",
  send_message: "Enviar mensagem",
  handoff_to_human: "Transferência para atendente",
  end_flow: "Encerrar fluxo",
};

const normalizeOptionEndSession = (
  option: Pick<BotOptionRow, "action_type" | "next_node_id" | "end_session">,
) => {
  if (option.next_node_id) return false;

  switch (option.action_type) {
    case "go_to_node":
      return false;
    case "transfer_to_department":
    case "handoff_to_human":
    case "end_flow":
      return true;
    case "send_message":
    case "add_tag":
    default:
      return Boolean(option.end_session);
  }
};

const getEndSessionControlState = (
  option: Pick<BotOptionRow, "action_type" | "next_node_id">,
) => {
  if (option.next_node_id) {
    return {
      disabled: true,
      helper:
        "Desativado porque uma opcao com proxima etapa não pode encerrar a Sessão.",
    };
  }

  switch (option.action_type) {
    case "go_to_node":
      return {
        disabled: true,
        helper:
          "Desativado porque ir para a proxima etapa mantem o fluxo em andamento.",
      };
    case "transfer_to_department":
      return {
        disabled: true,
        helper:
          "Ativado automaticamente porque a transferencia para departamento encerra o bot.",
      };
    case "handoff_to_human":
      return {
        disabled: true,
        helper:
          "Ativado automaticamente porque a transferencia para atendente encerra o bot.",
      };
    case "end_flow":
      return {
        disabled: true,
        helper:
          "Ativado automaticamente porque esta acao foi definida para encerrar o fluxo.",
      };
    case "send_message":
      return {
        disabled: false,
        helper:
          "Opcional: use quando esta mensagem deve finalizar o bot apos o envio.",
      };
    case "add_tag":
    default:
      return {
        disabled: false,
        helper:
          "Opcional: ative apenas quando adicionar a tag tambem deve encerrar o atendimento do bot.",
      };
  }
};

const NodeBadge = ({ node }: { node: BotNodeRow }) => {
  const isRoot = node.node_key === BOT_ROOT_NODE_KEY;
  return (
    <span className="inline-flex items-center gap-2">
      {isRoot ? <Badge variant="success">Inicio</Badge> : null}
      <span className="font-mono text-xs text-slate-500">{node.node_key}</span>
    </span>
  );
};

export const BotNodesEditor = ({
  clinicId,
  botId,
  isAdmin,
}: {
  clinicId: string;
  botId: string;
  isAdmin: boolean;
}) => {
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<BotNodeRow[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);

  const [savingNodeId, setSavingNodeId] = useState<string | null>(null);
  const [deletingNodeId, setDeletingNodeId] = useState<string | null>(null);
  const [optionsByNodeId, setOptionsByNodeId] = useState<
    Record<string, Array<BotOptionRow | OptionDraft>>
  >({});
  const [optionsLoadingNodeId, setOptionsLoadingNodeId] = useState<
    string | null
  >(null);
  const [savingOptionId, setSavingOptionId] = useState<string | null>(null);

  const rootNode = useMemo(
    () => nodes.find((n) => n.node_key === BOT_ROOT_NODE_KEY) ?? null,
    [nodes],
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const nodeList = useMemo(() => {
    return [...nodes].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [nodes]);

  const selectedOptions = useMemo(() => {
    if (!selectedNodeId) return [];
    return optionsByNodeId[selectedNodeId] ?? [];
  }, [optionsByNodeId, selectedNodeId]);

  const fetchAll = useCallback(async () => {
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

    const nextSelected =
      selectedNodeId && list.some((n) => n.id === selectedNodeId)
        ? selectedNodeId
        : (list[0]?.id ?? null);
    setSelectedNodeId(nextSelected);
  }, [botId, clinicId, selectedNodeId]);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  const loadOptions = useCallback(
    async (nodeId: string) => {
      if (optionsByNodeId[nodeId]) return;
      setOptionsLoadingNodeId(nodeId);
      const res = await botsService.listOptions(nodeId);
      setOptionsLoadingNodeId(null);
      if (res.error) {
        toast.error(res.error.message);
        return;
      }
      setOptionsByNodeId((prev) => ({ ...prev, [nodeId]: res.data }));
    },
    [optionsByNodeId],
  );

  useEffect(() => {
    if (!selectedNodeId) return;
    loadOptions(selectedNodeId);
  }, [loadOptions, selectedNodeId]);

  const updateNodeLocal = (nodeId: string, patch: Partial<BotNodeRow>) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId ? ({ ...n, ...patch } as BotNodeRow) : n,
      ),
    );
  };

  const handleCreateRoot = async () => {
    if (rootNode) return;
    if (!isAdmin) return toast.error("Você não tem permissão para esta ação.");

    setSavingNodeId("root");
    const res = await botsService.createNode({
      bot_id: botId,
      clinic_id: clinicId,
      node_key: BOT_ROOT_NODE_KEY,
      title: "Etapa inicial",
      message: "Escolha uma opção:",
      node_type: "menu",
      sort_order: 1,
    });
    setSavingNodeId(null);

    if (res.error) return toast.error(res.error.message);
    setNodes((prev) => [res.data, ...prev]);
    setSelectedNodeId(res.data.id);
    toast.success("Etapa inicial criada.");
  };

  const handleCreateNode = async () => {
    if (!isAdmin) return toast.error("Você não tem permissão para esta ação.");
    const nextSort =
      nodes.reduce((max, n) => Math.max(max, n.sort_order ?? 0), 0) + 1;

    setSavingNodeId("new");
    const res = await botsService.createNode({
      bot_id: botId,
      clinic_id: clinicId,
      node_key: `node_${nextSort}`,
      title: `Etapa ${nextSort}`,
      message: "",
      node_type: "menu",
      sort_order: nextSort,
    });
    setSavingNodeId(null);

    if (res.error) return toast.error(res.error.message);
    setNodes((prev) => [...prev, res.data]);
    setSelectedNodeId(res.data.id);
    toast.success("Etapa criada.");
  };

  const handleSaveNode = async (node: BotNodeRow) => {
    if (!isAdmin) return toast.error("Você não tem permissão para esta ação.");
    if (!node.title.trim()) return toast.error("Título é obrigatório.");
    if (!node.message.trim()) return toast.error("Mensagem é obrigatória.");
    if (!node.node_key.trim())
      return toast.error("A chave da etapa e obrigatoria.");

    if (
      node.node_key === BOT_ROOT_NODE_KEY &&
      nodes.some((n) => n.id !== node.id && n.node_key === BOT_ROOT_NODE_KEY)
    ) {
      return toast.error('Ja existe uma etapa com chave "root".');
    }

    setSavingNodeId(node.id);
    const res = await botsService.updateNode(node.id, {
      node_key: node.node_key.trim(),
      title: node.title.trim(),
      message: node.message.trim(),
      node_type: "menu",
      sort_order: node.sort_order,
    });
    setSavingNodeId(null);
    if (res.error) return toast.error(res.error.message);
    setNodes((prev) => prev.map((n) => (n.id === node.id ? res.data : n)));
    toast.success("Etapa salva.");
  };

  const handleDeleteNode = async (node: BotNodeRow) => {
    if (!isAdmin) return toast.error("Você não tem permissão para esta ação.");
    if (node.node_key === BOT_ROOT_NODE_KEY) {
      return toast.error("A etapa inicial não pode ser removida.");
    }
    const ok = window.confirm(`Remover a etapa "${node.title}"?`);
    if (!ok) return;

    setDeletingNodeId(node.id);
    const res = await botsService.deleteNode(node.id);
    setDeletingNodeId(null);
    if (res.error) return toast.error(res.error.message);

    setNodes((prev) => prev.filter((n) => n.id !== node.id));
    setOptionsByNodeId((prev) => {
      const copy = { ...prev };
      delete copy[node.id];
      return copy;
    });
    toast.success("Etapa removida.");
  };

  const swapSortOrder = async (a: BotNodeRow, b: BotNodeRow) => {
    if (!isAdmin) return toast.error("Você não tem permissão para esta ação.");
    const aOrder = a.sort_order;
    const bOrder = b.sort_order;
    updateNodeLocal(a.id, { sort_order: bOrder });
    updateNodeLocal(b.id, { sort_order: aOrder });

    const [r1, r2] = await Promise.all([
      botsService.updateNode(a.id, {
        sort_order: bOrder,
      }),
      botsService.updateNode(b.id, {
        sort_order: aOrder,
      }),
    ]);

    if (r1.error || r2.error) {
      toast.error(
        (r1.error ?? r2.error)?.message ?? "Falha ao reordenar etapas.",
      );
      await fetchAll();
      return;
    }

    setNodes((prev) =>
      [...prev].sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0)),
    );
  };

  const updateOptionLocal = (
    nodeId: string,
    optionKey: string,
    patch: Partial<OptionDraft | BotOptionRow>,
  ) => {
    setOptionsByNodeId((prev) => {
      const list = prev[nodeId] ?? [];
      const next = list.map((opt) => {
        const idKey =
          (opt as OptionDraft).__draftId ?? (opt as BotOptionRow).id;
        if (idKey !== optionKey) return opt;
        const nextOption = { ...opt, ...patch } as BotOptionRow | OptionDraft;
        return {
          ...nextOption,
          end_session: normalizeOptionEndSession(nextOption),
        } as BotOptionRow | OptionDraft;
      });
      return { ...prev, [nodeId]: next };
    });
  };

  const handleAddOptionDraft = (nodeId: string) => {
    if (!isAdmin) return toast.error("Você não tem permissão para esta ação.");
    const current = optionsByNodeId[nodeId] ?? [];
    const nextSort =
      current.reduce((max, o) => Math.max(max, o.sort_order ?? 0), 0) + 1;
    const nextValue = String(current.length + 1);

    const draft: OptionDraft = {
      __draftId: makeDraftId(),
      bot_node_id: nodeId,
      clinic_id: clinicId,
      option_value: nextValue,
      label: "",
      action_type: "go_to_node",
      next_node_id: null,
      target_department_id: null,
      tag_id: null,
      message_to_send: null,
      end_session: false,
      sort_order: nextSort,
    };

    setOptionsByNodeId((prev) => ({ ...prev, [nodeId]: [...current, draft] }));
  };

  const handleSaveOption = async (
    nodeId: string,
    opt: BotOptionRow | OptionDraft,
  ) => {
    if (!isAdmin) return toast.error("Você não tem permissão para esta ação.");
    if (!opt.option_value.trim())
      return toast.error("option_value é obrigatório.");
    if (!opt.label.trim()) return toast.error("label é obrigatório.");
    if (!opt.action_type) return toast.error("action_type é obrigatório.");

    const optionKey =
      (opt as BotOptionRow).id ?? (opt as OptionDraft).__draftId;
    setSavingOptionId(optionKey);

    const createPayload: CreateBotOptionInput = {
      clinic_id: clinicId,
      bot_node_id: nodeId,
      option_value: opt.option_value.trim(),
      label: opt.label.trim(),
      action_type: opt.action_type,
      next_node_id:
        opt.action_type === "go_to_node" ? (opt.next_node_id ?? null) : null,
      target_department_id:
        opt.action_type === "transfer_to_department"
          ? (opt.target_department_id ?? null)
          : null,
      tag_id: opt.action_type === "add_tag" ? (opt.tag_id ?? null) : null,
      message_to_send:
        opt.action_type === "send_message" ||
        opt.action_type === "handoff_to_human" ||
        opt.action_type === "end_flow"
          ? opt.message_to_send?.trim() || null
          : null,
      end_session: normalizeOptionEndSession(opt),
      sort_order: opt.sort_order ?? 1,
    };

    const updatePayload: UpdateBotOptionInput = {
      option_value: createPayload.option_value,
      label: createPayload.label,
      action_type: createPayload.action_type,
      next_node_id: createPayload.next_node_id,
      target_department_id: createPayload.target_department_id,
      tag_id: createPayload.tag_id,
      message_to_send: createPayload.message_to_send,
      end_session: createPayload.end_session,
      sort_order: createPayload.sort_order,
    };

    const res = (opt as BotOptionRow).id
      ? await botsService.updateOption((opt as BotOptionRow).id, updatePayload)
      : await botsService.createOption(createPayload);

    setSavingOptionId(null);
    if (res.error) return toast.error(res.error.message);

    const saved = res.data;
    setOptionsByNodeId((prev) => {
      const list = prev[nodeId] ?? [];
      const next = list.map((o) => {
        if ((o as BotOptionRow).id && (o as BotOptionRow).id === saved.id) {
          return saved;
        }
        if (
          !(o as BotOptionRow).id &&
          (o as OptionDraft).__draftId === (opt as OptionDraft).__draftId
        ) {
          return saved;
        }
        return o;
      });
      return { ...prev, [nodeId]: next };
    });

    toast.success("Opção salva.");
  };

  const handleDeleteOption = async (
    nodeId: string,
    opt: BotOptionRow | OptionDraft,
  ) => {
    if (!isAdmin) return toast.error("Você não tem permissão para esta ação.");
    const label = opt.label?.trim() ? `"${opt.label.trim()}"` : "esta opção";
    const ok = window.confirm(`Remover ${label}?`);
    if (!ok) return;

    if (!(opt as BotOptionRow).id) {
      setOptionsByNodeId((prev) => {
        const list = prev[nodeId] ?? [];
        const next = list.filter(
          (o) =>
            (o as OptionDraft).__draftId !== (opt as OptionDraft).__draftId,
        );
        return { ...prev, [nodeId]: next };
      });
      return;
    }

    setSavingOptionId((opt as BotOptionRow).id);
    const res = await botsService.deleteOption((opt as BotOptionRow).id);
    setSavingOptionId(null);
    if (res.error) return toast.error(res.error.message);

    setOptionsByNodeId((prev) => {
      const list = prev[nodeId] ?? [];
      const next = list.filter(
        (o) => (o as BotOptionRow).id !== (opt as BotOptionRow).id,
      );
      return { ...prev, [nodeId]: next };
    });
    toast.success("Opção removida.");
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-lg border border-slate-200 bg-white"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px,1fr]">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-900">Etapas</div>
            <div className="mt-0.5 text-xs text-slate-500">
              Etapa inicial obrigatoria:{" "}
              <span className="font-mono">{BOT_ROOT_NODE_KEY}</span>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleCreateNode}
            disabled={!isAdmin || savingNodeId !== null}
          >
            <span className="flex items-center gap-2">
              <PlusIcon className="h-4 w-4" />
              Etapa
            </span>
          </Button>
        </div>

        {!rootNode ? (
          <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-3 text-sm text-yellow-800">
            <div className="font-medium">Etapa inicial ausente</div>
            <div className="mt-1">
              Para publicar, e necessario ter uma etapa com chave{" "}
              <span className="font-mono">"root"</span>.
            </div>
            <div className="mt-3">
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreateRoot}
                disabled={!isAdmin || savingNodeId !== null}
              >
                Criar etapa inicial
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {nodeList.length === 0 ? (
            <div className="text-sm text-slate-500">Nenhuma etapa criada.</div>
          ) : (
            nodeList.map((n, idx) => {
              const active = n.id === selectedNodeId;
              const canMoveUp = idx > 0;
              const canMoveDown = idx < nodeList.length - 1;

              return (
                <div
                  key={n.id}
                  className={[
                    "rounded-lg border px-3 py-2",
                    active
                      ? "border-blue-200 bg-blue-50"
                      : "border-slate-200 bg-white hover:bg-slate-50",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(n.id);
                      // Abaixo de lg o editor fica embaixo da lista
                      if (window.matchMedia?.("(max-width: 1023px)").matches) {
                        requestAnimationFrame(() =>
                          editorRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          }),
                        );
                      }
                    }}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {n.title || "(sem título)"}
                        </div>
                        <div className="mt-1">
                          <NodeBadge node={n} />
                        </div>
                      </div>
                      <div className="text-xs text-slate-500">
                        #{n.sort_order}
                      </div>
                    </div>
                  </button>

                  <div className="mt-2 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      title="Subir"
                      disabled={!isAdmin || !canMoveUp}
                      onClick={() => swapSortOrder(n, nodeList[idx - 1]!)}
                      className="rounded-md p-1 text-slate-500 hover:bg-white disabled:opacity-50"
                    >
                      <ArrowUpIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Descer"
                      disabled={!isAdmin || !canMoveDown}
                      onClick={() => swapSortOrder(n, nodeList[idx + 1]!)}
                      className="rounded-md p-1 text-slate-500 hover:bg-white disabled:opacity-50"
                    >
                      <ArrowDownIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <div ref={editorRef} className="min-w-0 scroll-mt-4 space-y-4">
        {selectedNode ? (
          <>
            <Card className="p-4 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Editor da etapa
                  </h2>
                  <div className="mt-1">
                    <NodeBadge node={selectedNode} />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSaveNode(selectedNode)}
                    disabled={!isAdmin || savingNodeId === selectedNode.id}
                    isLoading={savingNodeId === selectedNode.id}
                  >
                    <span className="flex items-center gap-2">
                      <SaveIcon className="h-4 w-4" />
                      Salvar etapa
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => handleDeleteNode(selectedNode)}
                    disabled={
                      !isAdmin ||
                      deletingNodeId === selectedNode.id ||
                      selectedNode.node_key === BOT_ROOT_NODE_KEY
                    }
                  >
                    <span className="flex items-center gap-2">
                      <Trash2Icon className="h-4 w-4" />
                      Remover
                    </span>
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Input
                  label="Chave da etapa"
                  value={selectedNode.node_key}
                  disabled={
                    !isAdmin || selectedNode.node_key === BOT_ROOT_NODE_KEY
                  }
                  onChange={(e) =>
                    updateNodeLocal(selectedNode.id, {
                      node_key: e.target.value,
                    })
                  }
                />
                <Input
                  label="Título"
                  value={selectedNode.title}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    updateNodeLocal(selectedNode.id, { title: e.target.value })
                  }
                />
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Input
                  label="Ordem"
                  type="number"
                  value={String(selectedNode.sort_order ?? 1)}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    updateNodeLocal(selectedNode.id, {
                      sort_order: Number(e.target.value),
                    })
                  }
                />
              </div>

              <div className="mt-4">
                <Textarea
                  label="Mensagem"
                  value={selectedNode.message}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    updateNodeLocal(selectedNode.id, {
                      message: e.target.value,
                    })
                  }
                  placeholder="Texto enviado quando esta etapa e executada."
                />
              </div>
            </Card>

            <Card className="p-4 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Opções da etapa
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Configure as opções numeradas e suas ações.
                  </p>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleAddOptionDraft(selectedNode.id)}
                  disabled={!isAdmin}
                >
                  <span className="flex items-center gap-2">
                    <PlusIcon className="h-4 w-4" />
                    Nova opção
                  </span>
                </Button>
              </div>

              {optionsLoadingNodeId === selectedNode.id ? (
                <div className="mt-4 space-y-3">
                  {[1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white"
                    />
                  ))}
                </div>
              ) : selectedOptions.length === 0 ? (
                <div className="mt-4 text-sm text-slate-500">
                  Nenhuma opção cadastrada.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {selectedOptions
                    .slice()
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map((opt) => {
                      const optId =
                        (opt as OptionDraft).__draftId ??
                        (opt as BotOptionRow).id;
                      const saving = savingOptionId === optId;
                      const actionValues = ensureValueInList(
                        [...BOT_OPTION_ACTION_TYPE_VALUES],
                        String(opt.action_type ?? ""),
                      );
                      const showNextNode = opt.action_type === "go_to_node";
                      const showDepartment =
                        opt.action_type === "transfer_to_department";
                      const showTag = opt.action_type === "add_tag";
                      const showMessage =
                        opt.action_type === "send_message" ||
                        opt.action_type === "handoff_to_human" ||
                        opt.action_type === "end_flow";
                      const normalizedEndSession =
                        normalizeOptionEndSession(opt);
                      const endSessionControl = getEndSessionControlState(opt);

                      return (
                        <div
                          key={optId}
                          className="rounded-xl border border-slate-200 bg-white p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-900">
                              Opção #{opt.sort_order}
                              {(opt as BotOptionRow).id ? null : (
                                <span className="ml-2 text-xs font-medium text-slate-500">
                                  (não salva)
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() =>
                                  handleSaveOption(selectedNode.id, opt)
                                }
                                disabled={!isAdmin || saving}
                                isLoading={saving}
                              >
                                Salvar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:bg-red-50"
                                onClick={() =>
                                  handleDeleteOption(selectedNode.id, opt)
                                }
                                disabled={!isAdmin || saving}
                              >
                                Remover
                              </Button>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-4 md:grid-cols-3">
                            <Input
                              label="Valor da opção"
                              value={opt.option_value}
                              disabled={!isAdmin}
                              onChange={(e) =>
                                updateOptionLocal(selectedNode.id, optId, {
                                  option_value: e.target.value,
                                })
                              }
                            />
                            <Input
                              label="Texto da opção"
                              value={opt.label}
                              disabled={!isAdmin}
                              onChange={(e) =>
                                updateOptionLocal(selectedNode.id, optId, {
                                  label: e.target.value,
                                })
                              }
                            />
                            <div className="w-full">
                              <label className="mb-1 block text-sm font-medium text-[#1E1E1E]">
                                Ação
                              </label>
                              <select
                                value={opt.action_type}
                                disabled={!isAdmin}
                                onChange={(e) =>
                                  updateOptionLocal(selectedNode.id, optId, {
                                    action_type: e.target.value,
                                  })
                                }
                                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
                              >
                                {actionValues.map((v) => (
                                  <option key={v} value={v}>
                                    {actionTypeToLabel[v] ?? v}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            {showNextNode ? (
                              <div className="w-full">
                                <label className="mb-1 block text-sm font-medium text-[#1E1E1E]">
                                  Proxima etapa
                                </label>
                                <select
                                  value={opt.next_node_id ?? ""}
                                  disabled={!isAdmin}
                                  onChange={(e) =>
                                    updateOptionLocal(selectedNode.id, optId, {
                                      next_node_id: e.target.value || null,
                                    })
                                  }
                                  className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
                                >
                                  <option value="">Selecione...</option>
                                  {nodeList.map((n) => (
                                    <option key={n.id} value={n.id}>
                                      {n.title} ({n.node_key})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : null}

                            {showDepartment ? (
                              <div className="w-full">
                                <label className="mb-1 block text-sm font-medium text-[#1E1E1E]">
                                  Departamento
                                </label>
                                <select
                                  value={opt.target_department_id ?? ""}
                                  disabled={!isAdmin}
                                  onChange={(e) =>
                                    updateOptionLocal(selectedNode.id, optId, {
                                      target_department_id:
                                        e.target.value || null,
                                    })
                                  }
                                  className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
                                >
                                  <option value="">Selecione...</option>
                                  {departments.map((d) => (
                                    <option key={d.id} value={d.id}>
                                      {d.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : null}

                            {showTag ? (
                              <div className="w-full">
                                <label className="mb-1 block text-sm font-medium text-[#1E1E1E]">
                                  Tag
                                </label>
                                <select
                                  value={opt.tag_id ?? ""}
                                  disabled={!isAdmin}
                                  onChange={(e) =>
                                    updateOptionLocal(selectedNode.id, optId, {
                                      tag_id: e.target.value || null,
                                    })
                                  }
                                  className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
                                >
                                  <option value="">Selecione...</option>
                                  {tags.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name ?? "(sem nome)"}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : null}

                            <Toggle
                              label="Encerrar sessão"
                              helper={endSessionControl.helper}
                              checked={normalizedEndSession}
                              onChange={(checked) =>
                                updateOptionLocal(selectedNode.id, optId, {
                                  end_session: checked,
                                })
                              }
                              disabled={!isAdmin || endSessionControl.disabled}
                            />
                          </div>

                          {showMessage ? (
                            <div className="mt-4">
                              <Textarea
                                label="Mensagem da Ação"
                                value={opt.message_to_send ?? ""}
                                disabled={!isAdmin}
                                onChange={(e) =>
                                  updateOptionLocal(selectedNode.id, optId, {
                                    message_to_send: e.target.value,
                                  })
                                }
                                placeholder="Mensagem opcional enviada junto da ação."
                              />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                </div>
              )}
            </Card>
          </>
        ) : (
          <Card className="p-4 sm:p-6">
            <div className="text-sm text-slate-600">
              Selecione uma etapa para editar.
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
