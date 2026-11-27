// Nome do arquivo dentro do caminho do Storage.
//
// O Storage recusa caminho com acento, "°", "ç" e outros caracteres fora do
// ASCII ("Invalid key"): o upload falhava e a mensagem entrava sem o arquivo
// (ex.: "Orçamento n. 233.pdf", "CERTIDÃO.pdf"). Aqui o nome perde o acento
// ("Orcamento", "CERTIDAO") e o que sobrar fora da lista vira "_".
//
// O nome original continua salvo na mensagem (coluna filename), que é o que a
// conversa mostra e usa ao baixar.

const MAX_LENGTH = 120;

export const storageFileName = (raw: string | null | undefined, fallback: string): string => {
  const cleaned = String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._() -]/g, "_")
    .replace(/_+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s_]+/, "");
  if (!cleaned || /^[._ -]*$/.test(cleaned)) return fallback;
  if (cleaned.length <= MAX_LENGTH) return cleaned;

  // Nome comprido: corta o meio e mantém a extensão
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, MAX_LENGTH - ext.length).trimEnd() + ext;
};
