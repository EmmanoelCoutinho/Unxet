import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLinkIcon, KanbanSquareIcon, PlusIcon } from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../../../contexts/ClinicContext";
import { useAuth } from "../../../contexts/AuthContext";
import { useClinicUserNames } from "../../../hooks/useClinicUserNames";
import { useContactOpenDeals, useLeadActions, useLossReasons, usePipelines } from "../hooks/useLeads";
import type { Deal, PipelineStage } from "../types/leads";
import { formatCompactCurrency } from "../utils/board";
import { LostDealModal } from "./LostDealModal";
import { NewDealModal, type OwnerOption } from "./NewDealModal";

/**
 * Faixa do funil na conversa: a etapa da negociação aberta do cliente (dá para
 * trocar sem sair do chat) ou o botão para levar o cliente ao funil.
 */
export const ConversationDealBar: React.FC<{
  conversationId: string;
  contactId: string;
  contactName: string | null;
  contactPhone: string | null;
  compact?: boolean;
}> = ({ conversationId, contactId, contactName, contactPhone, compact = false }) => {
  const navigate = useNavigate();
  const { clinicId, membership } = useClinic();
  const { authUser } = useAuth();
  const isAdmin = membership?.role === "admin";
  const currentUserId = authUser?.id ?? null;
  const { deals } = useContactOpenDeals(contactId);
  const { pipelines } = usePipelines(clinicId);
  const lossReasons = useLossReasons(clinicId);
  const userNames = useClinicUserNames(clinicId);
  const actions = useLeadActions();
  const [creating, setCreating] = useState(false);
  const [pendingLost, setPendingLost] = useState<{ deal: Deal; stage: PipelineStage } | null>(null);

  const ownerOptions: OwnerOption[] = useMemo(() => {
    const me = { id: currentUserId, label: "Você" };
    if (!isAdmin) return [me, { id: null, label: "Sem responsável" }];
    const others = Object.entries(userNames)
      .filter(([id]) => id !== currentUserId)
      .map(([id, label]) => ({ id, label }));
    return [me, ...others, { id: null, label: "Sem responsável" }];
  }, [isAdmin, currentUserId, userNames]);

  const deal = deals[0] ?? null;
  const pipeline = deal
    ? pipelines.find((p) => p.id === deal.pipelineId) ?? null
    : pipelines[0] ?? null;
  const stage = deal ? pipeline?.stages.find((s) => s.id === deal.stageId) ?? null : null;

  const move = async (target: PipelineStage, lost?: { reasonId: string; note: string | null }) => {
    if (!deal) return;
    try {
      await actions.updateDeal({
        id: deal.id,
        patch: {
          stageId: target.id,
          // Sem o quadro carregado aqui: um número bem baixo põe o cartão no topo
          position: -Date.now() / 1000,
          ...(lost ? { lostReasonId: lost.reasonId, lostNote: lost.note } : {}),
        },
      });
      toast.success(
        target.kind === "won"
          ? "Negociação ganha!"
          : target.kind === "lost"
            ? "Negociação marcada como perdida."
            : `Movida para "${target.name}".`,
      );
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível mover.");
    }
  };

  const onSelectStage = (stageId: string) => {
    const target = pipeline?.stages.find((s) => s.id === stageId);
    if (!target || !deal || target.id === deal.stageId) return;
    if (target.kind === "lost") {
      setPendingLost({ deal, stage: target });
      return;
    }
    void move(target);
  };

  if (!pipeline) return null;
  // Na caixa flutuante, sem negociação, a faixa não ocupa espaço
  if (!deal && compact) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
        <KanbanSquareIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
        {deal && stage ? (
          <>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-slate-800">{deal.title}</span>
              {deal.value !== null && !compact && (
                <span className="text-green-700"> · {formatCompactCurrency(deal.value)}</span>
              )}
              {deals.length > 1 && <span className="text-slate-400"> · +{deals.length - 1}</span>}
            </span>
            <label className="sr-only" htmlFor={`deal-stage-${conversationId}`}>
              Etapa no funil
            </label>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white pl-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
              <select
                id={`deal-stage-${conversationId}`}
                value={deal.stageId}
                onChange={(event) => onSelectStage(event.target.value)}
                className="rounded-full bg-transparent py-0.5 pr-1 text-xs font-medium text-slate-700 outline-none"
              >
                {pipeline.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </span>
            <button
              type="button"
              onClick={() => navigate(`/inbox/leads?deal=${deal.id}`)}
              className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
            >
              <ExternalLinkIcon className="h-3 w-3" />
              {compact ? "" : "Abrir"}
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 text-slate-500">Este cliente não está no funil de vendas.</span>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
            >
              <PlusIcon className="h-3 w-3" />
              Criar negociação
            </button>
          </>
        )}
      </div>

      {creating && (
        <NewDealModal
          clinicId={clinicId}
          pipeline={pipeline}
          presetContact={{ id: contactId, name: contactName, phone: contactPhone }}
          source="conversation"
          sourceConversationId={conversationId}
          ownerOptions={ownerOptions}
          defaultOwnerId={currentUserId}
          topPositionFor={() => -Date.now() / 1000}
          onClose={() => setCreating(false)}
          onCreated={() => setCreating(false)}
        />
      )}

      {pendingLost && (
        <LostDealModal
          dealTitle={pendingLost.deal.title}
          reasons={lossReasons}
          onClose={() => setPendingLost(null)}
          onConfirm={async (reasonId, note) => {
            await move(pendingLost.stage, { reasonId, note });
            setPendingLost(null);
          }}
        />
      )}
    </>
  );
};
