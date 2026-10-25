// Planos da Unxet. Limites e recursos de verdade vêm do banco
// (subscription_plans); aqui ficam os tipos, os nomes na tela e o que cada
// plano oferece para mostrar no painel e nos avisos de "recurso de outro plano".

export type PlanCode = "essencial" | "profissional" | "empresarial";

export type PlanFeature =
  | "social_channels"
  | "bots"
  | "departments"
  | "scheduled_messages"
  | "analytics"
  | "audio_transcription"
  | "internal_chat";

export type SubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "suspended"
  | "canceled";

export type BillingCycle = "monthly" | "annual";

export type PaymentMethod =
  | "pix"
  | "boleto"
  | "credit_card"
  | "debit_card"
  | "bank_transfer"
  | "cash"
  | "other";

export type SubscriptionPlan = {
  code: PlanCode;
  name: string;
  position: number;
  // null = ilimitado
  max_attendants: number | null;
  max_whatsapp_numbers: number | null;
  features: PlanFeature[];
};

export const PLAN_CODES: PlanCode[] = ["essencial", "profissional", "empresarial"];

export const PLAN_NAMES: Record<PlanCode, string> = {
  essencial: "Essencial",
  profissional: "Profissional",
  empresarial: "Empresarial",
};

// O que aparece na proposta comercial de cada plano
export const PLAN_HIGHLIGHTS: Record<PlanCode, string[]> = {
  essencial: [
    "Até 3 atendentes",
    "1 número de WhatsApp",
    "Caixa de entrada unificada",
    "Etiquetas e mensagens rápidas",
    "Carteira de clientes",
    "Painel em tempo real e relatórios em PDF",
    "App no celular com notificações",
    "Suporte por e-mail",
  ],
  profissional: [
    "Até 10 atendentes",
    "WhatsApp, Instagram e Messenger",
    "Bots com editor visual",
    "Departamentos e transferências",
    "Campanhas no WhatsApp com resultado",
    "Transcrição de áudios",
    "Chat interno da equipe",
    "Suporte prioritário no WhatsApp",
  ],
  empresarial: [
    "Atendentes ilimitados",
    "Vários números e canais",
    "Tudo do Profissional",
    "Campanhas com templates da Meta (em breve)",
    "Implantação assistida",
    "Treinamento da equipe",
    "Gerente de conta dedicado",
  ],
};

export const FEATURE_LABELS: Record<PlanFeature, string> = {
  social_channels: "Instagram e Messenger",
  bots: "Bots",
  departments: "Departamentos e transferências",
  scheduled_messages: "Campanhas",
  analytics: "Painel de desempenho",
  audio_transcription: "Transcrição de áudios",
  internal_chat: "Chat interno",
};

// Nomes no plural pedem "fazem parte"
export const FEATURE_IS_PLURAL: Record<PlanFeature, boolean> = {
  social_channels: true,
  bots: true,
  departments: true,
  scheduled_messages: true,
  analytics: false,
  audio_transcription: false,
  internal_chat: false,
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trial: "Em teste",
  active: "Ativa",
  past_due: "Inadimplente",
  suspended: "Suspensa",
  canceled: "Cancelada",
};

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: "Mensal",
  annual: "Anual",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: "Pix",
  boleto: "Boleto",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  bank_transfer: "Transferência",
  cash: "Dinheiro",
  other: "Outro",
};

// Carência padrão entre o vencimento e a suspensão (mesmo padrão do banco)
export const DEFAULT_GRACE_DAYS = 10;
