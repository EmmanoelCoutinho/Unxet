// Conversas abertas em caixas flutuantes no canto inferior direito da tela.
// A ordem do array é a ordem na tela: o índice 0 fica no canto.

export type FloatingBox = {
  id: string;
  minimized: boolean;
  // Nome do contato no momento em que a caixa foi aberta (usado até a lista carregar)
  title: string;
};

export const BOX_WIDTH = 360;
export const MINIMIZED_WIDTH = 232;
export const BOX_GAP = 12;
export const OVERFLOW_WIDTH = 56;
// Acima disso a caixa mais antiga é fechada ao abrir uma nova
export const MAX_BOXES = 8;

const boxWidth = (box: FloatingBox) =>
  box.minimized ? MINIMIZED_WIDTH : BOX_WIDTH;

/**
 * Separa as caixas que cabem na largura disponível das que vão para o
 * botão "+N". A primeira caixa sempre aparece, mesmo em telas estreitas.
 */
export function layoutBoxes(boxes: FloatingBox[], availableWidth: number) {
  const visible: FloatingBox[] = [];
  let used = 0;

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    const width = (visible.length > 0 ? BOX_GAP : 0) + boxWidth(box);
    // Se ainda houver caixas depois desta, sobra espaço para o botão "+N"
    const reserve = i < boxes.length - 1 ? BOX_GAP + OVERFLOW_WIDTH : 0;

    if (visible.length > 0 && used + width + reserve > availableWidth) break;

    visible.push(box);
    used += width;
  }

  return { visible, overflow: boxes.slice(visible.length) };
}

/** Abre (ou traz para o canto) a caixa da conversa, expandida. */
export function openBox(
  boxes: FloatingBox[],
  id: string,
  title: string,
): FloatingBox[] {
  const existing = boxes.find((box) => box.id === id);
  const next: FloatingBox = {
    id,
    minimized: false,
    title: title || existing?.title || "",
  };
  return [next, ...boxes.filter((box) => box.id !== id)].slice(0, MAX_BOXES);
}

export function parseStoredBoxes(raw: unknown): FloatingBox[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const boxes: FloatingBox[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { id, minimized, title } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    boxes.push({
      id,
      minimized: minimized === true,
      title: typeof title === "string" ? title : "",
    });
  }
  return boxes.slice(0, MAX_BOXES);
}
