// Liga/desliga módulos que ainda não estão prontos para os clientes.
// Desligado = some da navegação e a rota redireciona para o início.
// (Envio em massa pelo WhatsApp QR Code fica em "Campanhas", sempre ligado.)
export const FEATURES = {
  // Depende do envio de templates para aprovação da Meta e da conta real de WhatsApp
  marketingCampaigns: false,
} as const;

export type FeatureKey = keyof typeof FEATURES;
