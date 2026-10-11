export const BOT_ROOT_NODE_KEY = "root" as const;

// Aceita qualquer texto, mantendo o autocompletar dos valores conhecidos
type OpenString = string & Record<never, never>;

export const BOT_STATUS_VALUES = ["active", "inactive"] as const;
export type BotStatus = (typeof BOT_STATUS_VALUES)[number] | OpenString;

export const BOT_NODE_TYPE_VALUES = [
  "menu",
  "message",
  "handoff",
  "end",
] as const;
export type BotNodeType = (typeof BOT_NODE_TYPE_VALUES)[number] | OpenString;

export const BOT_OPTION_ACTION_TYPE_VALUES = [
  "go_to_node",
  "transfer_to_department",
  "add_tag",
  "send_message",
  "handoff_to_human",
  "end_flow",
] as const;
export type BotOptionActionType =
  | (typeof BOT_OPTION_ACTION_TYPE_VALUES)[number]
  | OpenString;

export const BOT_CHANNEL_BINDING_TRIGGER_TYPE_VALUES = [
  "first_inbound",
] as const;
export type BotChannelBindingTriggerType =
  | (typeof BOT_CHANNEL_BINDING_TRIGGER_TYPE_VALUES)[number]
  | OpenString;

export const CONVERSATION_BOT_SESSION_STATUS_VALUES = [
  "active",
  "ended",
  "running",
] as const;
export type ConversationBotSessionStatus =
  | (typeof CONVERSATION_BOT_SESSION_STATUS_VALUES)[number]
  | OpenString;

export const CONVERSATION_BOT_SESSION_ENDED_REASON_VALUES = [
  "end_flow",
  "handoff_to_human",
  "timeout",
  "manual",
] as const;
export type ConversationBotSessionEndedReason =
  | (typeof CONVERSATION_BOT_SESSION_ENDED_REASON_VALUES)[number]
  | OpenString;

export type BotRow = {
  id: string;
  clinic_id: string;
  name: string;
  description: string | null;
  status: BotStatus;
  type: string;
  published: boolean;
  start_message: string;
  invalid_option_message: string;
  timeout_message: string | null;
  session_timeout_hours: number;
  human_handoff_enabled: boolean;
  max_invalid_attempts: number;
  is_deleted: boolean;
  created_by?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type BotNodeRow = {
  id: string;
  bot_id: string;
  clinic_id: string;
  node_key: string;
  title: string;
  message: string;
  node_type: BotNodeType;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CreateBotNodeInput = {
  bot_id: string;
  clinic_id: string;
  node_key: string;
  title: string;
  message: string;
  node_type: BotNodeType;
  sort_order: number;
};

export type UpdateBotNodeInput = Partial<
  Pick<
    BotNodeRow,
    "node_key" | "title" | "message" | "node_type" | "sort_order"
  >
>;

export type BotOptionRow = {
  id: string;
  bot_node_id: string;
  clinic_id: string;
  option_value: string;
  label: string;
  action_type: BotOptionActionType;
  next_node_id: string | null;
  target_department_id: string | null;
  tag_id: string | null;
  message_to_send: string | null;
  end_session: boolean;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CreateBotOptionInput = {
  bot_node_id: string;
  clinic_id: string;
  option_value: string;
  label: string;
  action_type: BotOptionActionType;
  next_node_id: string | null;
  target_department_id: string | null;
  tag_id: string | null;
  message_to_send: string | null;
  end_session: boolean;
  sort_order: number;
};

export type UpdateBotOptionInput = Partial<
  Pick<
    BotOptionRow,
    | "option_value"
    | "label"
    | "action_type"
    | "next_node_id"
    | "target_department_id"
    | "tag_id"
    | "message_to_send"
    | "end_session"
    | "sort_order"
  >
>;

export type BotChannelBindingRow = {
  id: string;
  clinic_id: string;
  bot_id: string;
  channel_connection_id: string;
  enabled: boolean;
  trigger_type: BotChannelBindingTriggerType;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type UpsertBotChannelBindingInput = {
  clinic_id: string;
  bot_id: string;
  channel_connection_id: string;
  enabled: boolean;
  trigger_type: BotChannelBindingTriggerType;
  created_by: string | null;
};

// Somente colunas seguras: tokens e chaves de API nunca vão para o navegador
export type ChannelConnectionRow = {
  id: string;
  clinic_id: string;
  provider?: "meta" | "evolution" | OpenString | null;
  channel: "whatsapp" | "instagram" | "messenger" | OpenString;
  status?: "connected" | "disconnected" | "needs_reauth" | OpenString | null;
  connected_phone?: string | null;
  connected_name?: string | null;
  updated_at?: string | null;
};

// Canais em que o bot-engine realmente responde hoje
export const BOT_SUPPORTED_CHANNELS = ["whatsapp"] as const;

export const isBotSupportedChannel = (channel?: string | null) =>
  (BOT_SUPPORTED_CHANNELS as readonly string[]).includes(String(channel ?? ""));

// Tempo sem interação até o bot encerrar a sessão. O teto é 24h: depois disso
// o WhatsApp oficial não deixa mais enviar mensagem livre ao cliente.
export const BOT_SESSION_TIMEOUT_HOUR_OPTIONS = [1, 2, 5, 12, 24] as const;
export const BOT_SESSION_TIMEOUT_DEFAULT_HOURS = 24;

// Limites das listas interativas do WhatsApp (API oficial)
export const BOT_OPTION_LABEL_MAX_LENGTH = 24;
export const BOT_MENU_MAX_OPTIONS = 10;

export type DepartmentRow = {
  id: string;
  clinic_id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  updated_at?: string | null;
  created_at?: string | null;
};

export type TagRow = {
  id: string;
  clinic_id: string;
  name: string | null;
  color: string | null;
  created_at?: string | null;
};
