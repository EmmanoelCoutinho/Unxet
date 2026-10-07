// Liga/desliga módulos que ainda não estão prontos para os clientes.
// Desligado = some da navegação e a rota redireciona para o início.
export const FEATURES = {
  // Depende do envio de templates para aprovação da Meta e da conta real de WhatsApp
  marketingCampaigns: false,
  // Envio em massa sem template viola a janela de 24h do WhatsApp oficial
  massMessages: false,
} as const;

export type FeatureKey = keyof typeof FEATURES;
