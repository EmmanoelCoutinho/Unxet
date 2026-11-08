import { supabase } from "../../../lib/supabaseClient";
import type {
  MetaTemplate,
  MetaTemplateInput,
  OfficialWhatsapp,
} from "../types/scheduledMessages";

// Modelos da Meta (WhatsApp oficial). O app só lê message_templates; criar,
// atualizar o status e apagar passam pela edge function whatsapp-templates,
// que fala com a Meta.

type TemplateRow = {
  id: string;
  name: string;
  category: MetaTemplate["category"];
  body: string;
  footer: string | null;
  buttons: unknown;
  status: MetaTemplate["status"];
  rejection_reason: string | null;
  channel_connection_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  "id, name, category, body, footer, buttons, status, rejection_reason, channel_connection_id, created_by, created_at, updated_at";

const mapTemplate = (row: TemplateRow): MetaTemplate => ({
  id: row.id,
  name: row.name,
  category: row.category,
  body: row.body,
  footer: row.footer,
  buttons: Array.isArray(row.buttons)
    ? row.buttons.filter((b): b is string => typeof b === "string")
    : [],
  status: row.status,
  rejectionReason: row.rejection_reason,
  channelConnectionId: row.channel_connection_id,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// A edge function devolve { error } com o texto para a tela
const functionErrorMessage = async (error: unknown, fallback: string) => {
  const context = (error as { context?: unknown })?.context;
  const payload =
    context instanceof Response
      ? ((await context
          .clone()
          .json()
          .catch(() => null)) as { error?: string } | null)
      : null;
  return payload?.error ?? fallback;
};

const callTemplates = async (body: Record<string, unknown>, fallback: string) => {
  const { data, error } = await supabase.functions.invoke("whatsapp-templates", { body });
  if (error) throw new Error(await functionErrorMessage(error, fallback));
  return data as { success: boolean; updated?: number };
};

export const listMetaTemplates = async (clinicId: string | null): Promise<MetaTemplate[]> => {
  if (!clinicId) return [];

  const { data, error } = await supabase
    .from("message_templates")
    .select(COLUMNS)
    .eq("clinic_id", clinicId)
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as TemplateRow[]).map(mapTemplate);
};

export const createMetaTemplate = (input: MetaTemplateInput) =>
  callTemplates(
    {
      action: "create",
      name: input.name,
      category: input.category,
      body: input.body,
      footer: input.footer,
      buttons: input.buttons,
    },
    "Não foi possível enviar o modelo para a Meta.",
  );

export const syncMetaTemplates = async () => {
  const result = await callTemplates({ action: "sync" }, "Não foi possível consultar a Meta.");
  return result.updated ?? 0;
};

export const deleteMetaTemplate = (templateId: string) =>
  callTemplates({ action: "delete", templateId }, "Não foi possível apagar o modelo.");

// WhatsApp oficial da empresa (há no máximo um), ou null
export const getOfficialWhatsapp = async (
  clinicId: string | null,
): Promise<OfficialWhatsapp | null> => {
  if (!clinicId) return null;

  const { data, error } = await supabase
    .from("channel_connections")
    .select("id, status, display_name")
    .eq("clinic_id", clinicId)
    .eq("provider", "meta")
    .eq("channel", "whatsapp")
    .is("archived_at", null)
    .limit(1);

  if (error) throw error;

  const row = data?.[0];
  if (!row) return null;

  const { data: number } = await supabase
    .from("whatsapp_numbers")
    .select("display_phone_number")
    .eq("channel_connection_id", row.id)
    .maybeSingle();

  const phone = (number?.display_phone_number as string | null) ?? null;
  const nickname = (row.display_name as string | null)?.trim() || null;

  return {
    id: row.id as string,
    // Telefone (com o apelido na frente, se a empresa deu um)
    label: [nickname, phone].filter(Boolean).join(" · ") || "WhatsApp oficial",
    connected: row.status === "connected",
  };
};
