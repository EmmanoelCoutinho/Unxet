// Consumo do mês do Assistente com IA: "warning" a partir de 80% (mesma conta
// de clinic_ai_warning_threshold no banco), "exhausted" quando acabou.
// Sem dependências: usado pelo app e pelo painel da Unxet.
export type AiUsageLevel = "ok" | "warning" | "exhausted";

// Conta inteira: limit * 0.8 em ponto flutuante arredondaria errado (55 -> 45)
export const aiWarningThreshold = (limit: number) => Math.max(1, Math.ceil((limit * 4) / 5));

export const aiUsageLevel = (used: number, limit: number): AiUsageLevel =>
  used >= limit ? "exhausted" : used >= aiWarningThreshold(limit) ? "warning" : "ok";
