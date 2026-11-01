import type { QuickMessage } from "../services/quickMessages";

// "/" no começo do texto ou depois de um espaço abre o menu; o que vem
// depois dele (até a posição do cursor) filtra as mensagens
export type SlashToken = { start: number; query: string };

export const findSlashToken = (
  text: string,
  caret: number,
): SlashToken | null => {
  const before = text.slice(0, caret);
  const match = before.match(/(?:^|\s)\/([^\n/]{0,40})$/);
  if (!match) return null;
  return { start: before.length - match[1].length - 1, query: match[1] };
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Todas as palavras digitadas precisam aparecer na mensagem; as que começam
// com o texto digitado vêm primeiro
export const filterQuickMessages = (items: QuickMessage[], query: string) => {
  const q = normalize(query.trim());
  if (!q) return items;
  const words = q.split(/\s+/);
  const starts: QuickMessage[] = [];
  const others: QuickMessage[] = [];
  items.forEach((item) => {
    const text = normalize(item.message);
    if (!words.every((word) => text.includes(word))) return;
    (text.startsWith(q) ? starts : others).push(item);
  });
  return [...starts, ...others];
};
