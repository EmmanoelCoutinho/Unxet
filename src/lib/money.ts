// Valor digitado em reais: "1.299,90", "199,90", "199.90" ou "R$ 50" → número.
// Vazio → null; texto inválido → NaN.
export const parseMoney = (value: string) => {
  const trimmed = value.trim().replace(/^R\$\s*/, "");
  if (!trimmed) return null;
  // Com vírgula (ou "1.299", só grupos de 3), o ponto é separador de milhar
  if (trimmed.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    return Number(trimmed.replace(/\./g, "").replace(",", "."));
  }
  return Number(trimmed);
};

const inputFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Número → texto para editar no campo ("1.299,90"); parseMoney lê de volta
export const moneyInput = (value: number | null) =>
  value === null || value === undefined ? "" : inputFormat.format(Number(value));
