import React from "react";
import { SparklesIcon } from "lucide-react";
import type { ConversationEvent } from "../../types";

interface SystemEventBubbleProps {
  event: ConversationEvent;
}

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return time;
};

const getActorLabel = (event: ConversationEvent) =>
  event.performedByName || "Sistema";

const getStatusLabel = (status?: string) => {
  switch (status) {
    case "open":
      return "em andamento";
    case "pending":
      return "pendente";
    case "closed":
      return "finalizada";
    default:
      return status || "novo status";
  }
};

const getEventText = (event: ConversationEvent) => {
  const actor = getActorLabel(event);
  const meta = event.metadata ?? {};

  switch (event.type) {
    case "conversation_accepted":
      return `${actor} aceitou a conversa`;

    case "conversation_closed":
      return `${actor} finalizou a conversa`;

    case "conversation_reopened":
      return `${actor} reabriu a conversa`;

    case "message_deleted":
      return meta.deleted_for_everyone
        ? `${actor} apagou uma mensagem para todos`
        : `${actor} removeu uma mensagem do Unxet`;

    case "satisfaction_survey_sent":
      return "Sistema enviou a pesquisa de satisfação";

    case "satisfaction_survey_answered": {
      const score = meta.score;
      return score
        ? `Cliente avaliou o atendimento com nota ${score}`
        : "Cliente respondeu a pesquisa de satisfação";
    }

    case "reopened_automatically": {
      const reason = meta.reason;
      if (reason === "incoming_message") {
        return "Sistema reabriu a conversa automaticamente por nova mensagem do cliente";
      }
      return "Sistema reabriu a conversa automaticamente";
    }

    case "closed_automatically": {
      const reason = meta.reason;
      if (reason === "window_expired") {
        return "Sistema fechou a conversa automaticamente por expiração da janela";
      }
      return "Sistema fechou a conversa automaticamente";
    }

    case "returned_to_pending_automatically":
      return "Sistema retornou a conversa automaticamente para pendente";

    case "sla_first_response_breached":
      return "Sistema registrou violação do SLA da primeira resposta";

    case "conversation_transferred": {
      const toDepartment =
        meta.to_department_name ?? meta.department_name ?? meta.to_sector_name;
      const toUser = meta.to_user_name ?? meta.assigned_user_name;

      if (toUser) {
        return `${actor} atribuiu a conversa para ${toUser}`;
      }

      if (toDepartment) {
        return `${actor} transferiu a conversa para ${toDepartment}`;
      }

      return `${actor} transferiu a conversa`;
    }

    case "sector_transferred": {
      const toSector =
        meta.to_department_name ?? meta.to_sector_name ?? "outro setor";
      return `${actor} transferiu para ${toSector}`;
    }

    case "user_transferred": {
      const toUser = meta.to_user_name ?? "outro atendente";
      return `${actor} atribuiu a conversa para ${toUser}`;
    }

    case "participant_added":
      return `${actor} adicionou ${meta.participant_name ?? "um atendente"} à conversa`;

    case "participant_removed":
      return `${actor} removeu ${meta.participant_name ?? "um atendente"} da conversa`;

    case "participant_left":
      return `${actor} saiu da conversa`;

    case "tag_added": {
      const tag = meta.tag_name ?? "uma etiqueta";
      return `${actor} adicionou ${tag}`;
    }

    case "tag_removed": {
      const tag = meta.tag_name ?? "uma etiqueta";
      return `${actor} removeu ${tag}`;
    }

    case "status_changed": {
      const nextStatus = getStatusLabel(meta.to_status);
      return `${actor} alterou o status para ${nextStatus}`;
    }

    case "bot_session_started": {
      const botName = meta.bot_name;
      if (botName) {
        return `Bot ${botName} iniciou o atendimento automático`;
      }
      return "Bot iniciou o atendimento automático";
    }

    case "bot_option_selected": {
      const optionLabel = meta.option_label ?? meta.option_value ?? "uma opção";
      return `Cliente selecionou a opção ${optionLabel}`;
    }

    case "bot_invalid_option":
      return "Cliente informou uma opção inválida no bot";

    case "bot_transferred": {
      const toDepartment = meta.to_department_name;
      if (toDepartment) {
        return `Bot encaminhou a conversa para ${toDepartment}`;
      }
      return "Bot encaminhou a conversa";
    }

    case "bot_handoff_requested":
      return "Cliente solicitou atendimento humano";

    case "bot_handoff_to_human": {
      const toDepartment = meta.to_department_name;
      if (toDepartment) {
        return `Bot encaminhou a conversa para atendimento humano em ${toDepartment}`;
      }
      return "Bot encaminhou a conversa para atendimento humano";
    }

    case "bot_message_sent": {
      const botName = meta.bot_name;
      if (botName) {
        return `Bot ${botName} enviou uma mensagem automática`;
      }
      return "Bot enviou uma mensagem automática";
    }

    case "bot_session_ended": {
      const reason = meta.reason;
      if (reason === "handoff_to_human") {
        return "Bot encerrou a sessão para transferir ao atendimento humano";
      }
      if (reason === "flow_finished") {
        return "Bot encerrou a sessão após concluir o fluxo";
      }
      if (reason === "max_invalid_attempts") {
        return "Bot encerrou a sessão após várias tentativas inválidas";
      }
      if (reason === "timeout") {
        return "Bot encerrou a sessão por falta de resposta do cliente";
      }
      return "Bot encerrou a sessão";
    }

    default:
      return `${actor} registrou um evento`;
  }
};

export const SystemEventBubble: React.FC<SystemEventBubbleProps> = ({
  event,
}) => {
  // Resumo que a IA escreve ao passar a conversa para a equipe
  const aiSummary =
    event.type === "bot_handoff_to_human" &&
    typeof event.metadata?.ai_summary === "string"
      ? event.metadata.ai_summary.trim()
      : "";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
        <span>{getEventText(event)}</span>
        <span className="ml-2 text-gray-400">
          {formatTime(event.createdAt)}
        </span>
      </div>
      {aiSummary ? (
        <div className="w-full max-w-md rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-blue-900">
          <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-blue-700">
            <SparklesIcon className="h-3.5 w-3.5" />
            Resumo da IA · só a equipe vê
          </div>
          <p className="whitespace-pre-wrap break-words">{aiSummary}</p>
        </div>
      ) : null}
    </div>
  );
};
