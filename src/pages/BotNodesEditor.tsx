import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { Link } from "react-router-dom";
import { CheckIcon, ListIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { useClinic } from "../contexts/ClinicContext";
import { botsService } from "../services/bots";
import {
  BOT_ROOT_NODE_KEY,
  type DepartmentRow,
  type TagRow,
} from "../types/bots";
import { FlowMap } from "./botFlow/FlowMap";
import { OptionsCard } from "./botFlow/OptionsCard";
import { PhonePreview } from "./botFlow/PhonePreview";
import {
  buildFlowTree,
  canAddOption,
  countChanges,
  fromRows,
  getOptionWarning,
  makeDraftId,
  nextNodeKey,
  optionsOf,
  type FlowOption,
  type FlowStage,
  type FlowState,
} from "./botFlow/flowModel";
import { saveFlow } from "./botFlow/saveFlow";

export const BotNodesEditor = ({
  clinicId,
  botId,
  isAdmin,
  startMessage,
  onDirtyChange,
}: {
  clinicId: string;
  botId: string;
  isAdmin: boolean;
  startMessage: string;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const confirm = useConfirm();
  const { clinic, subscription } = useClinic();
  const aiContracted = (subscription?.ai_replies_addon ?? null) !== null;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingRoot, setCreatingRoot] = useState(false);
  // Último estado gravado e o estado em edição
  const [saved, setSaved] = useState<FlowState | null>(null);
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openOptionId, setOpenOptionId] = useState<string | null>(null);
  const [tagOpenIds, setTagOpenIds] = useState<Set<string>>(new Set());
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);

  const load = useCallback(
    async (keepSelected?: string | null) => {
      setLoading(true);
      const [nodesRes, depsRes, tagsRes] = await Promise.all([
        botsService.listNodes(botId),
        botsService.listDepartments(clinicId),
        botsService.listTags(clinicId),
      ]);
      if (depsRes.error) toast.error(depsRes.error.message);
      if (tagsRes.error) toast.error(tagsRes.error.message);
      setDepartments(depsRes.data ?? []);
      setTags(tagsRes.data ?? []);
      if (nodesRes.error) {
        setLoading(false);
        toast.error(nodesRes.error.message);
        return;
      }

      const optsRes = await botsService.listOptionsByNodeIds(
        nodesRes.data.map((n) => n.id),
      );
      setLoading(false);
      if (optsRes.error) {
        toast.error(optsRes.error.message);
        return;
      }

      const next = fromRows(nodesRes.data, optsRes.data);
      setSaved(next);
      setFlow(next);
      setOpenOptionId(null);
      setTagOpenIds(new Set());
      setSelectedId(
        keepSelected && next.stages.some((s) => s.id === keepSelected)
          ? keepSelected
          : (next.stages.find((s) => s.isRoot)?.id ?? next.stages[0]?.id ?? null),
      );
    },
    [botId, clinicId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const changes = saved && flow ? countChanges(saved, flow) : 0;

  useEffect(() => {
    onDirtyChange?.(changes > 0);
  }, [changes, onDirtyChange]);

  useEffect(() => {
    if (changes === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes]);

  const root = flow?.stages.find((s) => s.isRoot) ?? null;
  const current =
    flow?.stages.find((s) => s.id === selectedId) ?? root ?? null;
  const currentOptions = useMemo(
    () => (flow && current ? optionsOf(flow, current.id) : []),
    [flow, current],
  );

  const editable = isAdmin && !saving;

  const mutate = (fn: (draft: FlowState) => FlowState) =>
    setFlow((prev) => (prev ? fn(prev) : prev));

  const selectStage = (id: string) => {
    setSelectedId(id);
    setOpenOptionId(null);
  };

  const makeStage = (name: string): FlowStage => ({
    id: makeDraftId("stage"),
    isNew: true,
    isRoot: false,
    kind: "menu",
    aiInstructions: "",
    aiDepartmentId: "",
    name,
    message: "",
    // Inclui as chaves das etapas removidas ainda não salvas
    nodeKey: nextNodeKey([...(saved?.stages ?? []), ...(flow?.stages ?? [])]),
  });

  const updateStage = (patch: Partial<FlowStage>) => {
    if (!current) return;
    mutate((f) => ({
      ...f,
      stages: f.stages.map((s) => (s.id === current.id ? { ...s, ...patch } : s)),
    }));
  };

  const handleChangeKind = async (kind: FlowStage["kind"]) => {
    if (!current || !flow || current.kind === kind) return;
    const buttons = optionsOf(flow, current.id).length;
    if (kind === "ai" && buttons > 0) {
      const ok = await confirm({
        title: "Trocar para atendimento com IA?",
        description:
          buttons === 1
            ? "O botão desta etapa sai: quem conduz a conversa a partir daqui é a IA."
            : `Os ${buttons} botões desta etapa saem: quem conduz a conversa a partir daqui é a IA.`,
        confirmLabel: "Trocar para IA",
      });
      if (!ok) return;
    }
    const stageId = current.id;
    mutate((f) => ({
      stages: f.stages.map((s) => (s.id === stageId ? { ...s, kind } : s)),
      options:
        kind === "ai" ? f.options.filter((o) => o.stageId !== stageId) : f.options,
    }));
    setOpenOptionId(null);
  };

  const handleNewStage = () => {
    const stage = makeStage("Nova etapa");
    mutate((f) => ({ ...f, stages: [...f.stages, stage] }));
    selectStage(stage.id);
  };

  const handleDeleteStage = async () => {
    if (!current || current.isRoot) return;
    const ok = await confirm({
      title: `Excluir a etapa "${current.name || "sem nome"}"?`,
      description:
        "Os botões dela também saem, e os botões que abriam esta etapa ficam sem destino.",
      confirmLabel: "Excluir etapa",
      tone: "danger",
    });
    if (!ok) return;
    const removedId = current.id;
    mutate((f) => ({
      stages: f.stages.filter((s) => s.id !== removedId),
      options: f.options
        .filter((o) => o.stageId !== removedId)
        .map((o) => (o.target === removedId ? { ...o, target: "" } : o)),
    }));
    if (root) selectStage(root.id);
  };

  const changeOption = (id: string, patch: Partial<FlowOption>) =>
    mutate((f) => ({
      ...f,
      options: f.options.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));

  const handleAddOption = () => {
    if (!flow || !current || !canAddOption(flow, current.id)) return;
    const option: FlowOption = {
      id: makeDraftId("option"),
      isNew: true,
      stageId: current.id,
      label: "",
      action: "",
      target: "",
      departmentId: "",
      reply: "",
      tagId: "",
      savedValue: "",
    };
    mutate((f) => ({ ...f, options: [...f.options, option] }));
    setOpenOptionId(option.id);
  };

  const handleMoveOption = (id: string, dir: -1 | 1) =>
    mutate((f) => {
      const option = f.options.find((o) => o.id === id);
      if (!option) return f;
      const siblings = f.options.filter((o) => o.stageId === option.stageId);
      const neighbor = siblings[siblings.indexOf(option) + dir];
      if (!neighbor) return f;
      const next = [...f.options];
      const a = next.indexOf(option);
      const b = next.indexOf(neighbor);
      [next[a], next[b]] = [next[b], next[a]];
      return { ...f, options: next };
    });

  const handleRemoveOption = (id: string) => {
    mutate((f) => ({ ...f, options: f.options.filter((o) => o.id !== id) }));
    if (openOptionId === id) setOpenOptionId(null);
  };

  const handleCreateStageFor = (optionId: string) => {
    const option = flow?.options.find((o) => o.id === optionId);
    if (!option) return;
    const stage = makeStage(option.label.trim() || "Nova etapa");
    mutate((f) => ({
      stages: [...f.stages, stage],
      options: f.options.map((o) =>
        o.id === optionId ? { ...o, target: stage.id } : o,
      ),
    }));
  };

  const handleCreateRoot = async () => {
    if (!isAdmin) return;
    setCreatingRoot(true);
    const res = await botsService.createNode({
      bot_id: botId,
      clinic_id: clinicId,
      node_key: BOT_ROOT_NODE_KEY,
      title: "Boas-vindas",
      message: "Olá! Como podemos ajudar?",
      node_type: "menu",
      sort_order: 1,
    });
    setCreatingRoot(false);
    if (res.error) return toast.error(res.error.message);
    await load(res.data.id);
  };

  const handleSave = async () => {
    if (!flow || !saved || !isAdmin) return;

    for (const stage of flow.stages) {
      const opts = optionsOf(flow, stage.id);
      const index = opts.findIndex((o) => getOptionWarning(o) !== null);
      if (index === -1) continue;
      const warning = getOptionWarning(opts[index]);
      selectStage(stage.id);
      setOpenOptionId(opts[index].id);
      toast.error(
        `Etapa "${stage.name || "sem nome"}", botão ${index + 1}: ${warning}.`,
      );
      return;
    }

    setSaving(true);
    const res = await saveFlow({ clinicId, botId, saved, current: flow });
    setSaving(false);
    const keep = selectedId ? (res.stageIds[selectedId] ?? selectedId) : null;
    if (res.error) {
      toast.error(
        `Não foi possível salvar tudo: ${res.error.message} O fluxo foi recarregado com o que ficou salvo.`,
      );
    } else {
      toast.success("Fluxo salvo.");
    }
    await load(keep);
  };

  if (loading && !flow) {
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

  if (!flow || !root || !current) {
    return (
      <Card className="p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Comece pela primeira mensagem
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          É o que o bot envia quando o cliente chama pela primeira vez.
        </p>
        <Button
          variant="primary"
          size="sm"
          className="mt-4"
          onClick={handleCreateRoot}
          isLoading={creatingRoot}
          disabled={!isAdmin}
        >
          Criar primeira etapa
        </Button>
      </Card>
    );
  }

  const { orphans } = buildFlowTree(flow);
  const isOrphan = !current.isRoot && orphans.includes(current.id);
  const incoming = flow.options
    .filter(
      (o) =>
        o.action === "stage" &&
        o.target === current.id &&
        o.stageId !== current.id,
    )
    .map((o) => ({
      option: o,
      from: flow.stages.find((s) => s.id === o.stageId),
    }));

  return (
    <div className="flex flex-col gap-4">
      {isAdmin ? (
        <div className="sticky top-0 z-10 -mx-1 flex items-center justify-end gap-3 bg-gray-50/95 px-1 py-2 backdrop-blur">
          {changes > 0 ? (
            <span className="text-[13px] font-medium text-orange-700">
              {changes === 1
                ? "1 alteração não salva"
                : `${changes} alterações não salvas`}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[13px] text-green-700">
              <CheckIcon className="h-4 w-4" strokeWidth={2.4} />
              Tudo salvo
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            isLoading={saving}
            disabled={changes === 0 || saving}
          >
            Salvar
          </Button>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)] min-[1400px]:grid-cols-[260px_minmax(0,1fr)_340px]">
        <FlowMap
          state={flow}
          selectedId={current.id}
          disabled={!editable}
          onSelect={selectStage}
          onNewStage={handleNewStage}
        />

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3.5 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <label htmlFor="stage-name" className="sr-only">
                  Nome da etapa
                </label>
                <input
                  id="stage-name"
                  value={current.name}
                  disabled={!editable}
                  onChange={(e) => updateStage({ name: e.target.value })}
                  placeholder="Dê um nome para a etapa"
                  title="Só a sua equipe vê este nome"
                  className="-ml-2 w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-bold text-slate-900 hover:border-slate-200 focus:border-blue-500 focus:outline-none focus:ring-[3px] focus:ring-blue-500/20 disabled:hover:border-transparent"
                />
                <div className="flex flex-wrap items-center gap-1 text-[13px] text-slate-500">
                  {current.isRoot ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-green-600" />
                      Primeira mensagem que o cliente recebe
                    </span>
                  ) : null}
                  {incoming.length > 0 ? (
                    <>
                      <span>
                        {current.isRoot
                          ? "· Também aberta pelo botão"
                          : "Aberta pelo botão"}
                      </span>
                      {incoming.map(({ option, from }, i) => (
                        <span key={option.id}>
                          <button
                            type="button"
                            onClick={() => from && selectStage(from.id)}
                            className="text-blue-700 hover:text-blue-900"
                          >
                            “{option.label.trim() || "sem texto"}” em{" "}
                            {from?.name || "sem nome"}
                          </button>
                          {i < incoming.length - 1 ? "," : ""}
                        </span>
                      ))}
                    </>
                  ) : null}
                  {isOrphan ? (
                    <span className="text-orange-700">
                      Nenhum botão leva até aqui ainda
                    </span>
                  ) : null}
                </div>
              </div>
              {!current.isRoot && isAdmin ? (
                <button
                  type="button"
                  onClick={handleDeleteStage}
                  disabled={!editable}
                  aria-label="Excluir etapa"
                  title="Excluir etapa"
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2Icon className="h-[17px] w-[17px]" />
                </button>
              ) : null}
            </div>

            {aiContracted || current.kind === "ai" ? (
              <div
                role="radiogroup"
                aria-label="Tipo da etapa"
                className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
              >
                {(
                  [
                    { kind: "menu", label: "Mensagem com botões", Icon: ListIcon },
                    { kind: "ai", label: "Atendimento com IA", Icon: SparklesIcon },
                  ] as const
                ).map(({ kind, label, Icon }) => {
                  const active = current.kind === kind;
                  return (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={!editable || (kind === "ai" && !aiContracted)}
                      onClick={() => handleChangeKind(kind)}
                      className={[
                        "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed",
                        active
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-800 disabled:opacity-50",
                      ].join(" ")}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {current.kind === "ai" && !aiContracted ? (
              <p className="rounded-lg bg-orange-50 px-3 py-2 text-[13px] text-orange-800">
                O adicional de IA não está ativo: quando o cliente chegar nesta
                etapa, a conversa vai direto para a equipe.
              </p>
            ) : null}

            <div>
              <label
                htmlFor="stage-message"
                className="mb-1.5 block text-[13px] font-semibold text-slate-700"
              >
                {current.kind === "ai" ? "Mensagem de abertura (opcional)" : "Mensagem"}
              </label>
              {current.kind === "ai" ? (
                <p className="mb-2 text-xs leading-relaxed text-slate-500">
                  Enviada ao chegar nesta etapa. Sem ela, a IA responde direto o
                  que o cliente escreveu.
                </p>
              ) : null}
              <textarea
                id="stage-message"
                rows={3}
                value={current.message}
                disabled={!editable}
                onChange={(e) => updateStage({ message: e.target.value })}
                placeholder={
                  current.kind === "ai"
                    ? "Ex.: Oi! Sou a assistente da loja. Como posso ajudar?"
                    : "Escreva o que o bot diz nesta etapa…"
                }
                className="w-full resize-y rounded-[10px] border border-slate-100 bg-slate-50 p-3 text-sm leading-relaxed text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-blue-500/20"
              />
            </div>
          </div>

          {current.kind === "ai" ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5">
              <div>
                <label
                  htmlFor="stage-ai-instructions"
                  className="mb-1.5 block text-[13px] font-semibold text-slate-700"
                >
                  Objetivo da IA nesta etapa
                </label>
                <p className="mb-2 text-xs leading-relaxed text-slate-500">
                  O que ela deve fazer aqui. As informações da empresa ficam em{" "}
                  <Link to="/inbox/ai-assistant" className="text-blue-700 hover:text-blue-900">
                    Assistente com IA
                  </Link>
                  .
                </p>
                <textarea
                  id="stage-ai-instructions"
                  rows={4}
                  maxLength={4000}
                  value={current.aiInstructions}
                  disabled={!editable}
                  onChange={(e) => updateStage({ aiInstructions: e.target.value })}
                  placeholder="Ex.: Tire dúvidas sobre os serviços. Se o cliente quiser agendar, pergunte nome e melhor horário e passe para a equipe."
                  className="w-full resize-y rounded-[10px] border border-slate-100 bg-slate-50 p-3 text-sm leading-relaxed text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-blue-500/20"
                />
              </div>
              {departments.length > 0 ? (
                <div>
                  <label
                    htmlFor="stage-ai-department"
                    className="mb-1.5 block text-[13px] font-semibold text-slate-700"
                  >
                    Quando precisar de uma pessoa, passar para
                  </label>
                  <select
                    id="stage-ai-department"
                    value={current.aiDepartmentId}
                    disabled={!editable}
                    onChange={(e) => updateStage({ aiDepartmentId: e.target.value })}
                    className="w-full rounded-[10px] border border-slate-200 bg-white p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-[3px] focus:ring-blue-500/20"
                  >
                    <option value="">Fila geral da equipe</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <p className="text-xs leading-relaxed text-slate-500">
                A IA passa a conversa para a equipe quando o cliente pede uma
                pessoa, quando não sabe a resposta ou quando o objetivo foi
                cumprido. Se o cliente se despedir, ela encerra.
              </p>
            </div>
          ) : (
          <OptionsCard
            options={currentOptions}
            openOptionId={openOptionId}
            tagOpenIds={tagOpenIds}
            disabled={!editable}
            currentStageId={current.id}
            lookups={{ stages: flow.stages, departments, tags }}
            onToggle={(id) =>
              setOpenOptionId((prev) => (prev === id ? null : id))
            }
            onChange={changeOption}
            onMove={handleMoveOption}
            onRemove={handleRemoveOption}
            onAdd={handleAddOption}
            onCreateStage={handleCreateStageFor}
            onOpenStage={selectStage}
            onOpenTag={(id) =>
              setTagOpenIds((prev) => new Set(prev).add(id))
            }
          />
          )}
        </div>

        <div className="lg:col-span-2 min-[1400px]:sticky min-[1400px]:top-16 min-[1400px]:col-span-1">
          <PhonePreview
            state={flow}
            stageId={current.id}
            rootStageId={root.id}
            companyName={clinic?.name?.trim() || "Sua empresa"}
            startMessage={startMessage}
            departments={departments}
            tags={tags}
            onNavigate={(id) => setSelectedId(id)}
          />
        </div>
      </div>
    </div>
  );
};
