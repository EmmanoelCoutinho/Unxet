// Funil de vendas: funis, etapas e negociações (cartões do Kanban)

export type StageKind = "open" | "won" | "lost";
export type DealStatus = StageKind;
export type DealSource = "manual" | "conversation" | "campaign";
export type TaskType = "call" | "message" | "meeting" | "other";

export type PipelineStage = {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  position: number;
  kind: StageKind;
};

export type Pipeline = {
  id: string;
  name: string;
  position: number;
  stages: PipelineStage[];
};

export type LossReason = {
  id: string;
  name: string;
  position: number;
  archivedAt: string | null;
};

export type DealContact = {
  id: string;
  name: string | null;
  phone: string | null;
  imageUrl: string | null;
};

// Tarefa resumida que vem junto com o cartão (para "próxima tarefa")
export type DealTaskSummary = {
  id: string;
  title: string;
  dueAt: string;
  doneAt: string | null;
};

export type Deal = {
  id: string;
  clinicId: string;
  pipelineId: string;
  stageId: string;
  contact: DealContact;
  title: string;
  value: number | null;
  ownerUserId: string | null;
  source: DealSource;
  sourceConversationId: string | null;
  sourceCampaignId: string | null;
  status: DealStatus;
  lostReasonId: string | null;
  lostNote: string | null;
  position: number;
  stageEnteredAt: string;
  closedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
  tasks: DealTaskSummary[];
};

export type DealEventType =
  | "created"
  | "stage_changed"
  | "value_changed"
  | "owner_changed"
  | "note"
  | "task_done"
  | "message_scheduled"
  | "campaign_converted";

export type DealEvent = {
  id: string;
  type: DealEventType;
  userId: string | null;
  note: string | null;
  payload: Record<string, any>;
  createdAt: string;
};

export type DealTask = {
  id: string;
  dealId: string;
  title: string;
  taskType: TaskType;
  dueAt: string;
  assignedUserId: string | null;
  doneAt: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type DealScheduledMessage = {
  id: string;
  message: string;
  scheduledAt: string;
  status: "scheduled" | "processing" | "sent" | "partial" | "failed" | "cancelled";
  recipientStatus: string | null;
  recipientError: string | null;
  createdBy: string | null;
};

export type CreateDealInput = {
  stageId: string;
  contactId: string;
  title: string;
  value: number | null;
  ownerUserId: string | null;
  source: DealSource;
  sourceConversationId?: string | null;
  position: number;
};

export type DealPatch = Partial<{
  stageId: string;
  title: string;
  value: number | null;
  ownerUserId: string | null;
  position: number;
  lostReasonId: string | null;
  lostNote: string | null;
}>;

export type DealFilters = {
  search: string;
  // "all" | "mine" | "none" | user id
  owner: string;
  tagId: string | null;
  stalledOnly: boolean;
};
