// Links no texto das mensagens (mapa da localização, convite de grupo,
// botões com link de outras empresas, links que o cliente manda...).
// Só http(s) e "www.": nada de javascript:, data: e afins.

export type TextSegment =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string };

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

// Pontuação que encerra a frase e não faz parte do link
const TRAILING_PUNCTUATION = /[.,;:!?'"*_~]+$/;

/** Tira do fim do link a pontuação da frase e o ")" sem par. */
const trimLink = (raw: string) => {
  let link = raw;
  for (;;) {
    const before = link;
    link = link.replace(TRAILING_PUNCTUATION, "");
    if (link.endsWith(")")) {
      const opens = (link.match(/\(/g) ?? []).length;
      const closes = (link.match(/\)/g) ?? []).length;
      if (closes > opens) link = link.slice(0, -1);
    }
    if (link === before) return link;
  }
};

/** Separa o texto em trechos comuns e links. */
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  if (!text) return segments;

  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const link = trimLink(match[0]);
    // Precisa de um domínio de verdade ("www." ou "https://" sozinhos não)
    const host = link.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    if (!/^[^/?#\s.]+(?:\.[^/?#\s.]+)+/.test(host)) continue;
    if (start > last) segments.push({ kind: "text", value: text.slice(last, start) });
    const href = /^https?:\/\//i.test(link) ? link : `https://${link}`;
    segments.push({ kind: "link", value: link, href });
    last = start + link.length;
  }
  if (last < text.length) segments.push({ kind: "text", value: text.slice(last) });
  return segments;
}
