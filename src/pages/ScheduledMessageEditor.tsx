import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeftIcon } from "lucide-react";
import { useScheduledMessage } from "../modules/scheduledMessages/hooks/useScheduledMessages";
import { effectiveStatus, isEditable } from "../modules/scheduledMessages/utils/schedule";
import { CAMPAIGNS_PATH } from "../modules/scheduledMessages/paths";
import { CampaignWizard } from "../modules/scheduledMessages/components/CampaignWizard";
import { CampaignResultView } from "../modules/scheduledMessages/components/CampaignResultView";

/**
 * /inbox/campaigns/new e /inbox/campaigns/:id
 * Campanha ainda agendada abre o passo a passo (criar/editar); a que já
 * começou a sair, terminou ou foi cancelada abre o resultado.
 */
export const ScheduledMessageEditorPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const scheduledMessageId = id ?? null;

  const { scheduledMessage, loading, error } = useScheduledMessage(scheduledMessageId);

  if (scheduledMessageId && loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (scheduledMessageId && !scheduledMessage) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Campanha não encontrada</h2>
          <p className="mt-2 text-sm text-slate-500">
            {error ?? "Ela pode ter sido excluída ou pertencer a outra pessoa."}
          </p>
          <button
            type="button"
            onClick={() => navigate(CAMPAIGNS_PATH)}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Voltar para as campanhas
          </button>
        </div>
      </div>
    );
  }

  if (scheduledMessage && !isEditable(effectiveStatus(scheduledMessage))) {
    return <CampaignResultView scheduledMessage={scheduledMessage} />;
  }

  // key: o formulário é montado uma vez por campanha (as atualizações
  // periódicas da consulta não apagam o que a pessoa está digitando)
  return <CampaignWizard key={scheduledMessage?.id ?? "new"} existing={scheduledMessage} />;
};
