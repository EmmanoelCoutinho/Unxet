// Formatação do WhatsApp no texto das mensagens: *negrito*, _itálico_,
// ~tachado~ e ```monoespaçado```. Segue as regras do próprio WhatsApp:
// - o marcador de abertura não pode estar colado depois de letra ou número
//   (snake_case e "2*3*4" ficam como estão), e o de fechamento não pode vir
//   colado antes de letra ou número;
// - o texto marcado não começa nem termina com espaço;
// - negrito, itálico e tachado não atravessam linhas e podem ser combinados
//   (*_assim_*); o monoespaçado pode ter várias linhas e não é formatado por
//   dentro.
// Marcador sem par fica como texto normal.

export type WhatsappStyle = "bold" | "italic" | "strike" | "mono";

export type WhatsappNode =
  | string
  | { style: WhatsappStyle; children: WhatsappNode[] };

const INLINE_MARKERS: Record<string, WhatsappStyle> = {
  "*": "bold",
  _: "italic",
  "~": "strike",
};

const MONO_MARKER = "```";

const isWordChar = (char: string | undefined) =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);

const isSpace = (char: string | undefined) =>
  char === undefined || /\s/.test(char);

/** Posição do marcador que fecha o que abre em `start`, ou -1. */
const findInlineClose = (text: string, start: number, marker: string) => {
  for (let i = start + 2; i < text.length; i++) {
    const char = text[i];
    if (char === "\n") return -1;
    if (char === marker && !isSpace(text[i - 1]) && !isWordChar(text[i + 1])) {
      return i;
    }
  }
  return -1;
};

const pushText = (nodes: WhatsappNode[], text: string) => {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (typeof last === "string") nodes[nodes.length - 1] = last + text;
  else nodes.push(text);
};

export const parseWhatsappFormatting = (text: string): WhatsappNode[] => {
  const nodes: WhatsappNode[] = [];
  if (typeof text !== "string" || !text) return nodes;

  let plainStart = 0;
  let i = 0;
  while (i < text.length) {
    const opensAfterBoundary = !isWordChar(text[i - 1]);

    if (opensAfterBoundary && text.startsWith(MONO_MARKER, i)) {
      const close = text.indexOf(MONO_MARKER, i + MONO_MARKER.length);
      if (close > i + MONO_MARKER.length) {
        pushText(nodes, text.slice(plainStart, i));
        nodes.push({
          style: "mono",
          children: [text.slice(i + MONO_MARKER.length, close)],
        });
        i = close + MONO_MARKER.length;
        plainStart = i;
        continue;
      }
    }

    const style = INLINE_MARKERS[text[i]];
    if (style && opensAfterBoundary && !isSpace(text[i + 1]) && text[i + 1] !== text[i]) {
      const close = findInlineClose(text, i, text[i]);
      if (close !== -1) {
        pushText(nodes, text.slice(plainStart, i));
        nodes.push({ style, children: parseWhatsappFormatting(text.slice(i + 1, close)) });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }

    i += 1;
  }
  pushText(nodes, text.slice(plainStart));
  return nodes;
};
