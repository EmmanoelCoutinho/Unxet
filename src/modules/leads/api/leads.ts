import { supabase } from "../../../lib/supabaseClient";
import type {
  CreateDealInput,
  Deal,
  DealEvent,
  DealPatch,
  DealScheduledMessage,
  DealTask,
  LossReason,
  Pipeline,
  PipelineStage,
  StageKind,
  TaskType,
} from "../types/leads";
import { CLOSED_VISIBLE_DAYS } from "../utils/board";

// numeric chega como texto pelo PostgREST
const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapStage = (row: any): PipelineStage => ({
  id: row.id,
  pipelineId: row.pipeline_id,
  name: row.name,
  color: row.color,
  position: row.position,
  kind: row.kind,
});

/* --------------------------------- Funis --------------------------------- */

// Cria o funil padrão na primeira vez (idempotente)
export const ensureDefaultPipeline = async () => {
  const { error } = await supabase.rpc("ensure_default_pipeline");
  if (error) throw error;
};

export const listPipelines = async (clinicId: string | null): Promise<Pipeline[]> => {
  if (!clinicId) return [];
  const { data, error } = await supabase
    .from("pipelines")
    .select("id, name, position, created_at, stages:pipeline_stages(id, pipeline_id, name, color, position, kind)")
    .eq("clinic_id", clinicId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    stages: (row.stages ?? []).map(mapStage).sort((a: PipelineStage, b: PipelineStage) => a.position - b.position),
  }));
};

export const listLossReasons = async (clinicId: string | null): Promise<LossReason[]> => {
  if (!clinicId) return [];
  const { data, error } = await supabase
    .from("deal_loss_reasons")
    .select("id, name, position, archived_at")
    .eq("clinic_id", clinicId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    archivedAt: row.archived_at,
  }));
};

/* ------------------------------ Negociações ------------------------------ */

const DEAL_SELECT =
  "id, clinic_id, pipeline_id, stage_id, title, value, owner_user_id, source, source_conversation_id, " +
  "source_campaign_id, status, lost_reason_id, lost_note, position, stage_entered_at, closed_at, created_by, " +
  "created_at, updated_at, contact:contacts(id, name, phone, image_url), tags:deal_tags(tag_id), " +
  "tasks:deal_tasks(id, title, due_at, done_at)";

const mapDeal = (row: any): Deal => {
  const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    contact: {
      id: contact?.id ?? "",
      name: contact?.name ?? null,
      phone: contact?.phone ?? null,
      imageUrl: contact?.image_url ?? null,
    },
    title: row.title,
    value: toNumber(row.value),
    ownerUserId: row.owner_user_id,
    source: row.source,
    sourceConversationId: row.source_conversation_id,
    sourceCampaignId: row.source_campaign_id,
    status: row.status,
    lostReasonId: row.lost_reason_id,
    lostNote: row.lost_note,
    position: Number(row.position ?? 0),
    stageEnteredAt: row.stage_entered_at,
    closedAt: row.closed_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tagIds: (row.tags ?? []).map((t: any) => t.tag_id),
    tasks: (row.tasks ?? []).map((t: any) => ({
      id: t.id,
      title: t.title,
      dueAt: t.due_at,
      doneAt: t.done_at,
    })),
  };
};

// Abertas + fechadas nos últimos 30 dias (o RLS já limita o que o atendente vê)
export const listDeals = async (pipelineId: string | null): Promise<Deal[]> => {
  if (!pipelineId) return [];
  const since = new Date(Date.now() - CLOSED_VISIBLE_DAYS * 86400000).toISOString();
  const { data, error } = await supabase
    .from("deals")
    .select(DEAL_SELECT)
    .eq("pipeline_id", pipelineId)
    .or(`status.eq.open,closed_at.gte.${since}`)
    .order("position", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map(mapDeal);
};

export const getDeal = async (id: string): Promise<Deal | null> => {
  const { data, error } = await supabase.from("deals").select(DEAL_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapDeal(data) : null;
};

// Negociações abertas de um cliente (faixa na conversa)
export const listOpenDealsForContact = async (contactId: string): Promise<Deal[]> => {
  const { data, error } = await supabase
    .from("deals")
    .select(DEAL_SELECT)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data ?? []).map(mapDeal);
};

export const createDeal = async (input: CreateDealInput): Promise<string> => {
  const { data, error } = await supabase
    .from("deals")
    // Empresa e funil vêm da etapa (gatilho deals_before_write)
    .insert({
      stage_id: input.stageId,
      contact_id: input.contactId,
      title: input.title.trim(),
      value: input.value,
      owner_user_id: input.ownerUserId,
      source: input.source,
      source_conversation_id: input.sourceConversationId ?? null,
      position: input.position,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
};

export const updateDeal = async (id: string, patch: DealPatch) => {
  const row: Record<string, unknown> = {};
  if (patch.stageId !== undefined) row.stage_id = patch.stageId;
  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.value !== undefined) row.value = patch.value;
  if (patch.ownerUserId !== undefined) row.owner_user_id = patch.ownerUserId;
  if (patch.position !== undefined) row.position = patch.position;
  if (patch.lostReasonId !== undefined) row.lost_reason_id = patch.lostReasonId;
  if (patch.lostNote !== undefined) row.lost_note = patch.lostNote;

  const { error } = await supabase.from("deals").update(row).eq("id", id);
  if (error) throw error;
};

export const deleteDeal = async (id: string) => {
  const { error } = await supabase.from("deals").delete().eq("id", id);
  if (error) throw error;
};

export const setDealTags = async (dealId: string, current: string[], next: string[]) => {
  const toAdd = next.filter((id) => !current.includes(id));
  const toRemove = current.filter((id) => !next.includes(id));
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("deal_tags")
      .delete()
      .eq("deal_id", dealId)
      .in("tag_id", toRemove);
    if (error) throw error;
  }
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("deal_tags")
      .insert(toAdd.map((tagId) => ({ deal_id: dealId, tag_id: tagId })));
    if (error) throw error;
  }
};

/* ------------------------------- Histórico ------------------------------- */

export const listDealEvents = async (dealId: string): Promise<DealEvent[]> => {
  const { data, error } = await supabase
    .from("deal_events")
    .select("id, type, user_id, note, payload, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    type: row.type,
    userId: row.user_id,
    note: row.note,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  }));
};

export const addDealNote = async (dealId: string, userId: string, note: string) => {
  const { error } = await supabase
    .from("deal_events")
    .insert({ deal_id: dealId, user_id: userId, type: "note", note: note.trim() });
  if (error) throw error;
};

export const deleteDealNote = async (eventId: string) => {
  const { error } = await supabase.from("deal_events").delete().eq("id", eventId);
  if (error) throw error;
};

/* -------------------------------- Tarefas -------------------------------- */

const mapTask = (row: any): DealTask => ({
  id: row.id,
  dealId: row.deal_id,
  title: row.title,
  taskType: row.task_type,
  dueAt: row.due_at,
  assignedUserId: row.assigned_user_id,
  doneAt: row.done_at,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

export const listDealTasks = async (dealId: string): Promise<DealTask[]> => {
  const { data, error } = await supabase
    .from("deal_tasks")
    .select("id, deal_id, title, task_type, due_at, assigned_user_id, done_at, created_by, created_at")
    .eq("deal_id", dealId)
    .order("due_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapTask);
};

export const createDealTask = async (input: {
  dealId: string;
  title: string;
  taskType: TaskType;
  dueAt: string;
  assignedUserId: string | null;
}) => {
  // A empresa vem da negociação (gatilho deal_tasks_before_write)
  const { error } = await supabase.from("deal_tasks").insert({
    deal_id: input.dealId,
    title: input.title.trim(),
    task_type: input.taskType,
    due_at: input.dueAt,
    assigned_user_id: input.assignedUserId,
  });
  if (error) throw error;
};

export const setDealTaskDone = async (taskId: string, done: boolean) => {
  const { error } = await supabase
    .from("deal_tasks")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("id", taskId);
  if (error) throw error;
};

export const deleteDealTask = async (taskId: string) => {
  const { error } = await supabase.from("deal_tasks").delete().eq("id", taskId);
  if (error) throw error;
};

/* -------------------------- Mensagem agendada --------------------------- */

export const scheduleDealMessage = async (input: {
  dealId: string;
  message: string;
  scheduledAt: string | null;
  sendNow: boolean;
  channelConnectionId: string | null;
}) => {
  const { data, error } = await supabase.rpc("deal_schedule_message", {
    p_deal_id: input.dealId,
    p_message: input.message.trim(),
    p_scheduled_at: input.sendNow ? null : input.scheduledAt,
    p_send_now: input.sendNow,
    p_channel_connection_id: input.channelConnectionId,
  });
  if (error) throw error;
  return data as string;
};

// O RLS das mensagens vale: cada um vê as que criou (o admin vê todas)
export const listDealScheduledMessages = async (
  dealId: string,
): Promise<DealScheduledMessage[]> => {
  const { data, error } = await supabase
    .from("scheduled_messages")
    .select("id, message, scheduled_at, status, created_by, recipients:scheduled_message_recipients(status, error)")
    .eq("deal_id", dealId)
    .order("scheduled_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    message: row.message,
    scheduledAt: row.scheduled_at,
    status: row.status,
    recipientStatus: row.recipients?.[0]?.status ?? null,
    recipientError: row.recipients?.[0]?.error ?? null,
    createdBy: row.created_by,
  }));
};

// Última conversa do cliente (para "Abrir conversa")
export const findLatestConversation = async (contactId: string): Promise<string | null> => {
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.id as string) ?? null;
};

/* ------------------------------ Campanhas ------------------------------- */

export const campaignToDeals = async (campaignId: string, onlyReplied: boolean) => {
  const { data, error } = await supabase.rpc("campaign_to_deals", {
    p_campaign_id: campaignId,
    p_only_replied: onlyReplied,
  });
  if (error) throw error;
  return (data as number) ?? 0;
};

/* ---------------------- Configuração (só admin) ------------------------- */

export const createPipeline = async (clinicId: string, name: string, position: number) => {
  const { data, error } = await supabase
    .from("pipelines")
    .insert({ clinic_id: clinicId, name: name.trim(), position })
    .select("id")
    .single();
  if (error) throw error;
  const pipelineId = data.id as string;
  // Funil novo já nasce com as etapas de fechamento
  const { error: stagesError } = await supabase.from("pipeline_stages").insert([
    { pipeline_id: pipelineId, clinic_id: clinicId, name: "Novo", color: "#3b82f6", position: 0, kind: "open" },
    { pipeline_id: pipelineId, clinic_id: clinicId, name: "Ganho", color: "#22c55e", position: 1, kind: "won" },
    { pipeline_id: pipelineId, clinic_id: clinicId, name: "Perdido", color: "#ef4444", position: 2, kind: "lost" },
  ]);
  if (stagesError) throw stagesError;
  return pipelineId;
};

export const renamePipeline = async (id: string, name: string) => {
  const { error } = await supabase
    .from("pipelines")
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
};

export const deletePipeline = async (id: string) => {
  const { error } = await supabase.from("pipelines").delete().eq("id", id);
  if (error) {
    // FK: ainda há negociações no funil
    if ((error as any).code === "23503") {
      throw new Error("Mova ou exclua as negociações deste funil antes de excluí-lo.");
    }
    throw error;
  }
};

export const createStage = async (input: {
  clinicId: string;
  pipelineId: string;
  name: string;
  color: string;
  position: number;
  kind: StageKind;
}) => {
  const { error } = await supabase.from("pipeline_stages").insert({
    pipeline_id: input.pipelineId,
    clinic_id: input.clinicId,
    name: input.name.trim(),
    color: input.color,
    position: input.position,
    kind: input.kind,
  });
  if (error) throw error;
};

export const updateStage = async (
  id: string,
  patch: Partial<{ name: string; color: string; position: number }>,
) => {
  const { error } = await supabase.from("pipeline_stages").update(patch).eq("id", id);
  if (error) throw error;
};

export const deleteStage = async (id: string) => {
  const { error } = await supabase.from("pipeline_stages").delete().eq("id", id);
  if (error) {
    if ((error as any).code === "23503") {
      throw new Error("Mova as negociações desta etapa antes de excluí-la.");
    }
    throw error;
  }
};

export const createLossReason = async (clinicId: string, name: string, position: number) => {
  const { error } = await supabase
    .from("deal_loss_reasons")
    .insert({ clinic_id: clinicId, name: name.trim(), position });
  if (error) throw error;
};

export const archiveLossReason = async (id: string, archived: boolean) => {
  const { error } = await supabase
    .from("deal_loss_reasons")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
};
