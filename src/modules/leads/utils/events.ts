import type { DealEvent, TaskType } from "../types/leads";

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  call: "Ligar",
  message: "Mandar mensagem",
  meeting: "Reunião",
  other: "Outra",
};

const money = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "sem valor";
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "sem valor";
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "criada no funil",
  conversation: "criada pela conversa",
  campaign: "veio de uma campanha",
};

/** Frase de uma linha do histórico do cartão. */
export const describeDealEvent = (
  event: Pick<DealEvent, "type" | "payload" | "userId">,
  userNames: Record<string, string>,
) => {
  const p = event.payload ?? {};
  const person = (id: unknown) =>
    typeof id === "string" && id ? userNames[id] ?? "Atendente" : "ninguém";

  switch (event.type) {
    case "created":
      return `Negociação ${SOURCE_LABEL[p.source] ?? "criada"}${
        p.stage_name ? ` em "${p.stage_name}"` : ""
      }`;
    case "stage_changed": {
      const to = p.to_stage_name ?? "outra etapa";
      if (p.status === "won") return `Marcada como ganha ("${to}")`;
      if (p.status === "lost") {
        return `Marcada como perdida${p.lost_reason ? `: ${p.lost_reason}` : ""}`;
      }
      return `Movida de "${p.from_stage_name ?? "?"}" para "${to}"`;
    }
    case "value_changed":
      return `Valor alterado de ${money(p.from)} para ${money(p.to)}`;
    case "owner_changed":
      return p.to ? `Responsável: ${person(p.to)}` : "Ficou sem responsável";
    case "task_done":
      return `Tarefa concluída: ${p.title ?? ""}`.trim();
    case "message_scheduled": {
      const at = p.scheduled_at ? new Date(p.scheduled_at) : null;
      return at
        ? `Mensagem agendada para ${at.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
        : "Mensagem agendada";
    }
    case "campaign_converted":
      return "Aderiu à campanha";
    case "note":
      return "Nota";
    default:
      return "Atualização";
  }
};
