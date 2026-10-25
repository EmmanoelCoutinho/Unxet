import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { KanbanSquareIcon, PlusIcon, SearchIcon, Settings2Icon } from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../contexts/ClinicContext";
import { useAuth } from "../contexts/AuthContext";
import { useClinicUserNames } from "../hooks/useClinicUserNames";
import { Button } from "../components/ui/Button";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { useCampaignTags } from "../modules/scheduledMessages/hooks/useScheduledMessages";
import { DealCard } from "../modules/leads/components/DealCard";
import { DealDrawer } from "../modules/leads/components/DealDrawer";
import { LostDealModal } from "../modules/leads/components/LostDealModal";
import { NewDealModal, type OwnerOption } from "../modules/leads/components/NewDealModal";
import { PipelineSettingsModal } from "../modules/leads/components/PipelineSettingsModal";
import {
  useDealFromQuery,
  useDeals,
  useLeadActions,
  useLossReasons,
  usePipelines,
} from "../modules/leads/hooks/useLeads";
import type { Deal, DealFilters, PipelineStage } from "../modules/leads/types/leads";
import {
  CLOSED_VISIBLE_DAYS,
  dropPosition,
  filterDeals,
  formatCompactCurrency,
  sortByPosition,
  stageTotals,
  topPosition,
} from "../modules/leads/utils/board";

export const LEADS_PATH = "/inbox/leads";
const PIPELINE_STORAGE_KEY = "unxet:leads:pipeline";

const readStoredPipeline = () => {
  try {
    return window.localStorage.getItem(PIPELINE_STORAGE_KEY);
  } catch {
    return null;
  }
};

const DEFAULT_FILTERS: DealFilters = { search: "", owner: "all", tagId: null, stalledOnly: false };

type PendingLost = { deal: Deal; stage: PipelineStage; position: number };
type DropTarget = { stageId: string; index: number };

export const LeadsKanbanPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { clinicId, membership } = useClinic();
  const { authUser } = useAuth();
  const currentUserId = authUser?.id ?? null;
  const isAdmin = membership?.role === "admin";

  const { pipelines, loading: loadingPipelines, error: pipelinesError } = usePipelines(clinicId);
  const lossReasons = useLossReasons(clinicId);
  const { tags } = useCampaignTags(clinicId);
  const userNames = useClinicUserNames(clinicId);
  const actions = useLeadActions();

  const [pipelineId, setPipelineId] = useState<string | null>(readStoredPipeline);
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0] ?? null;

  useEffect(() => {
    if (!pipeline) return;
    try {
      window.localStorage.setItem(PIPELINE_STORAGE_KEY, pipeline.id);
    } catch {
      // sem armazenamento: só não lembra o funil
    }
  }, [pipeline]);

  const { deals, loading: loadingDeals, error: dealsError } = useDeals(pipeline?.id ?? null);
  const [filters, setFilters] = useState<DealFilters>(DEFAULT_FILTERS);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [newDealStage, setNewDealStage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingLost, setPendingLost] = useState<PendingLost | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ?deal=<id> (lembrete por push, link da conversa) abre o cartão
  useDealFromQuery(location.search, (id) => setOpenDealId(id));

  const closeDeal = useCallback(() => {
    setOpenDealId(null);
    if (new URLSearchParams(location.search).has("deal")) {
      navigate(LEADS_PATH, { replace: true });
    }
  }, [location.search, navigate]);

  const ownerOptions: OwnerOption[] = useMemo(() => {
    const meLabel = currentUserId && userNames[currentUserId] ? `Você (${userNames[currentUserId]})` : "Você";
    if (!isAdmin) {
      return [
        { id: currentUserId, label: meLabel },
        { id: null, label: "Sem responsável" },
      ];
    }
    const others = Object.entries(userNames)
      .filter(([id]) => id !== currentUserId)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, label]) => ({ id, label }));
    return [{ id: currentUserId, label: meLabel }, ...others, { id: null, label: "Sem responsável" }];
  }, [isAdmin, currentUserId, userNames]);

  const visibleDeals = useMemo(
    () => filterDeals(deals, filters, currentUserId),
    [deals, filters, currentUserId],
  );

  const dealsByStage = useMemo(() => {
    const map: Record<string, Deal[]> = {};
    for (const stage of pipeline?.stages ?? []) map[stage.id] = [];
    for (const deal of visibleDeals) {
      (map[deal.stageId] ??= []).push(deal);
    }
    for (const id of Object.keys(map)) map[id] = sortByPosition(map[id]);
    return map;
  }, [visibleDeals, pipeline]);

  const dealCountByStage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const deal of deals) counts[deal.stageId] = (counts[deal.stageId] ?? 0) + 1;
    return counts;
  }, [deals]);

  const openTotals = stageTotals(visibleDeals.filter((d) => d.status === "open"));

  const topPositionFor = (stageId: string) =>
    topPosition(deals.filter((d) => d.stageId === stageId));

  /* ----------------------------- Mover cartão ----------------------------- */

  const moveDeal = async (
    deal: Deal,
    stage: PipelineStage,
    position: number,
    lost?: { reasonId: string; note: string | null },
  ) => {
    try {
      await actions.updateDeal({
        id: deal.id,
        patch: {
          stageId: stage.id,
          position,
          ...(lost ? { lostReasonId: lost.reasonId, lostNote: lost.note } : {}),
        },
      });
      if (stage.id !== deal.stageId) {
        if (stage.kind === "won") toast.success(`"${deal.title}" ganha!`);
        else if (stage.kind === "lost") toast.info(`"${deal.title}" marcada como perdida.`);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível mover a negociação.");
    }
  };

  // Perda pede o motivo antes; o resto move direto
  const requestMove = (deal: Deal, stage: PipelineStage, position?: number) => {
    const pos = position ?? topPositionFor(stage.id);
    if (stage.kind === "lost" && stage.id !== deal.stageId) {
      setPendingLost({ deal, stage, position: pos });
      return;
    }
    void moveDeal(deal, stage, pos);
  };

  /* ---------------------------- Arrastar/soltar --------------------------- */

  const indexFromPointer = (stageId: string, clientY: number) => {
    const column = columnRefs.current[stageId];
    if (!column) return 0;
    const cards = Array.from(column.querySelectorAll<HTMLElement>("[data-deal-id]")).filter(
      (el) => el.dataset.dealId !== draggingId,
    );
    const index = cards.findIndex((el) => {
      const rect = el.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    return index === -1 ? cards.length : index;
  };

  const onColumnDragOver = (event: React.DragEvent, stageId: string) => {
    if (!draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const index = indexFromPointer(stageId, event.clientY);
    setDropTarget((current) =>
      current?.stageId === stageId && current.index === index ? current : { stageId, index },
    );
  };

  const onColumnDrop = (event: React.DragEvent, stage: PipelineStage) => {
    event.preventDefault();
    const dealId = draggingId ?? event.dataTransfer.getData("text/plain");
    const deal = deals.find((d) => d.id === dealId);
    const index = dropTarget?.stageId === stage.id ? dropTarget.index : indexFromPointer(stage.id, event.clientY);
    setDraggingId(null);
    setDropTarget(null);
    if (!deal) return;
    const others = (dealsByStage[stage.id] ?? []).filter((d) => d.id !== deal.id);
    const position = dropPosition(others, index, deal.id);
    if (deal.stageId === stage.id && Math.abs(position - deal.position) < 1e-9) return;
    requestMove(deal, stage, position);
  };

  /* -------------------------------- Tela ---------------------------------- */

  if (pipelinesError || dealsError) {
    return (
      <div className="p-6 text-sm text-red-600">
        Não foi possível carregar o funil: {pipelinesError ?? dealsError}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="border-b bg-white px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <PreTitleIcon icon={KanbanSquareIcon} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-gray-900">Funil de vendas</h1>
                {pipelines.length > 1 && pipeline && (
                  <select
                    value={pipeline.id}
                    onChange={(event) => setPipelineId(event.target.value)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700"
                    aria-label="Funil"
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {openTotals.count} em andamento
                {openTotals.value > 0 ? ` · ${formatCompactCurrency(openTotals.value)} em negociação` : ""}
                {` · ganhos e perdidos dos últimos ${CLOSED_VISIBLE_DAYS} dias`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && pipeline && (
              <Button type="button" variant="ghost" onClick={() => setSettingsOpen(true)} className="border border-slate-200">
                <span className="flex items-center gap-2">
                  <Settings2Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">Configurar funil</span>
                </span>
              </Button>
            )}
            <Button
              type="button"
              onClick={() => pipeline && setNewDealStage(pipeline.stages.find((s) => s.kind === "open")?.id ?? null)}
              disabled={!pipeline}
              className="rounded-full"
            >
              <span className="flex items-center gap-2">
                <PlusIcon className="h-4 w-4" />
                Nova negociação
              </span>
            </Button>
          </div>
        </div>

        {/* Filtros */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={filters.search}
              onChange={(event) => setFilters((f) => ({ ...f, search: event.target.value }))}
              placeholder="Buscar negociação ou cliente"
              className="w-full rounded-full border border-slate-200 py-1.5 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              aria-label="Buscar"
            />
          </div>
          <select
            value={filters.owner}
            onChange={(event) => setFilters((f) => ({ ...f, owner: event.target.value }))}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
            aria-label="Responsável"
          >
            <option value="all">Todos os responsáveis</option>
            <option value="mine">Minhas</option>
            <option value="none">Sem responsável</option>
            {isAdmin &&
              Object.entries(userNames)
                .filter(([id]) => id !== currentUserId)
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
          </select>
          {tags.length > 0 && (
            <select
              value={filters.tagId ?? ""}
              onChange={(event) => setFilters((f) => ({ ...f, tagId: event.target.value || null }))}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
              aria-label="Etiqueta"
            >
              <option value="">Todas as etiquetas</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, stalledOnly: !f.stalledOnly }))}
            aria-pressed={filters.stalledOnly}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              filters.stalledOnly
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Paradas há 7+ dias
          </button>
          {(filters.search || filters.owner !== "all" || filters.tagId || filters.stalledOnly) && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="text-sm font-medium text-slate-500 hover:text-slate-800"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Quadro */}
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        {loadingPipelines || (loadingDeals && deals.length === 0) ? (
          <div className="flex h-full gap-4 p-4 sm:p-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-64 w-72 flex-shrink-0 animate-pulse rounded-2xl bg-white" />
            ))}
          </div>
        ) : (
          <div className="flex h-full gap-3 p-4 sm:p-6">
            {(pipeline?.stages ?? []).map((stage) => {
              const stageDeals = dealsByStage[stage.id] ?? [];
              const totals = stageTotals(stageDeals);
              const isTarget = dropTarget?.stageId === stage.id;
              return (
                <section
                  key={stage.id}
                  aria-label={stage.name}
                  onDragOver={(event) => onColumnDragOver(event, stage.id)}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                      setDropTarget((t) => (t?.stageId === stage.id ? null : t));
                    }
                  }}
                  onDrop={(event) => onColumnDrop(event, stage)}
                  className={`flex h-full w-72 flex-shrink-0 flex-col rounded-2xl border transition ${
                    isTarget ? "border-blue-300 bg-blue-50/60" : "border-slate-200 bg-slate-100/70"
                  }`}
                >
                  <header className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                      <h2 className="truncate text-sm font-semibold text-slate-800">{stage.name}</h2>
                      <span className="rounded-full bg-white px-1.5 text-xs font-medium text-slate-500">
                        {totals.count}
                      </span>
                    </div>
                    {stage.kind === "open" && (
                      <button
                        type="button"
                        onClick={() => setNewDealStage(stage.id)}
                        className="rounded-full p-1 text-slate-400 hover:bg-white hover:text-blue-600"
                        aria-label={`Nova negociação em ${stage.name}`}
                      >
                        <PlusIcon className="h-4 w-4" />
                      </button>
                    )}
                  </header>
                  <p className="px-3 pb-2 text-xs text-slate-500">
                    {totals.value > 0 ? formatCompactCurrency(totals.value) : " "}
                  </p>
                  <div
                    ref={(el) => {
                      columnRefs.current[stage.id] = el;
                    }}
                    className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-3"
                  >
                    {stageDeals.map((deal, index) => (
                      <React.Fragment key={deal.id}>
                        {isTarget && dropTarget?.index === index && draggingId !== deal.id && (
                          <div className="h-1 rounded-full bg-blue-400" />
                        )}
                        <DealCard
                          deal={deal}
                          ownerName={deal.ownerUserId ? userNames[deal.ownerUserId] ?? "Atendente" : null}
                          tags={tags}
                          onOpen={() => setOpenDealId(deal.id)}
                          dragging={draggingId === deal.id}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", deal.id);
                            setDraggingId(deal.id);
                          }}
                          onDragEnd={() => {
                            setDraggingId(null);
                            setDropTarget(null);
                          }}
                        />
                      </React.Fragment>
                    ))}
                    {isTarget && dropTarget && dropTarget.index >= stageDeals.filter((d) => d.id !== draggingId).length && (
                      <div className="h-1 rounded-full bg-blue-400" />
                    )}
                    {stageDeals.length === 0 && !isTarget && (
                      <p className="px-2 py-6 text-center text-xs text-slate-400">
                        {stage.kind === "open" ? "Arraste um cartão para cá" : "Nada nos últimos 30 dias"}
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {openDealId && (
        <DealDrawer
          dealId={openDealId}
          pipelines={pipelines}
          lossReasons={lossReasons}
          tags={tags}
          ownerOptions={ownerOptions}
          userNames={userNames}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          clinicId={clinicId}
          onClose={closeDeal}
          onMove={(deal, stage) => requestMove(deal, stage)}
        />
      )}

      {newDealStage && pipeline && (
        <NewDealModal
          clinicId={clinicId}
          pipeline={pipeline}
          defaultStageId={newDealStage}
          ownerOptions={ownerOptions}
          defaultOwnerId={currentUserId}
          topPositionFor={topPositionFor}
          onClose={() => setNewDealStage(null)}
          onCreated={(id) => {
            setNewDealStage(null);
            setOpenDealId(id);
          }}
        />
      )}

      {pendingLost && (
        <LostDealModal
          dealTitle={pendingLost.deal.title}
          reasons={lossReasons}
          onClose={() => setPendingLost(null)}
          onConfirm={async (reasonId, note) => {
            await moveDeal(pendingLost.deal, pendingLost.stage, pendingLost.position, { reasonId, note });
            setPendingLost(null);
          }}
        />
      )}

      {settingsOpen && pipeline && clinicId && (
        <PipelineSettingsModal
          clinicId={clinicId}
          pipelines={pipelines}
          activePipelineId={pipeline.id}
          lossReasons={lossReasons}
          dealCountByStage={dealCountByStage}
          onClose={() => setSettingsOpen(false)}
          onSelectPipeline={setPipelineId}
        />
      )}
    </div>
  );
};
