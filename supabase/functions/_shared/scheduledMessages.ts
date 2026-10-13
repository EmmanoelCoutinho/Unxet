// Helpers das mensagens programadas (sem dependência de Deno: testados no Vitest).

// Nome sem nenhuma letra é telefone gravado como nome (contato criado pelo
// WhatsApp sem nome de perfil): não serve para saudar o cliente.
const usableName = (name: unknown) => {
  const value = typeof name === "string" ? name.trim() : "";
  return /\p{L}/u.test(value) ? value : "";
};

/**
 * Troca {nome} pelo nome do destinatário. Sem nome, a marcação some e a
 * pontuação é ajustada ("Olá {nome}, tudo bem?" vira "Olá, tudo bem?").
 */
export const renderScheduledText = (template: string, name: unknown) => {
  const text = String(template ?? "");
  const resolved = usableName(name);
  if (resolved) return text.replace(/\{nome\}/gi, resolved);

  return text
    .replace(/[ \t]*\{nome\}/gi, "")
    .replace(/^[ \t]*[,;:][ \t]*/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

/** Pausa entre dois envios da mesma empresa, em ms (aleatória dentro da faixa). */
export const sendDelayMs = (minMs: number, maxMs: number, random = Math.random) =>
  Math.round(minMs + (maxMs - minMs) * random());

/** Texto curto do erro devolvido pela Evolution, para mostrar na tela. */
export const describeProviderError = (status: number, body: any) => {
  const raw =
    body?.response?.message ?? body?.message ?? body?.error ?? null;
  const flat = Array.isArray(raw) ? raw : [raw];
  // "exists: false" é a resposta da Evolution para número sem WhatsApp
  const notOnWhatsapp = flat.some(
    (item) => item && typeof item === "object" && item.exists === false,
  );
  if (notOnWhatsapp) return "Este número não tem WhatsApp.";

  const text = flat.find((item) => typeof item === "string" && item.trim());
  if (text) return `Falha no envio: ${String(text).slice(0, 200)}`;
  return `Falha no envio (código ${status}).`;
};
