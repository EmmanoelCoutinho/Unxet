import { useCallback, useRef, useState } from "react";

// Elementos que têm clique ou arraste próprio: ali o arraste do quadro não começa
const INTERACTIVE =
  "button, a, input, textarea, select, label, [role='button'], [draggable='true'], [data-no-drag-scroll]";

// Abaixo disso o movimento conta como clique, não como arraste
const THRESHOLD = 5;

/**
 * Clicar e arrastar o fundo de um contêiner com rolagem horizontal para
 * rolá-lo, como "pegar e puxar" o quadro. Só para mouse: no toque a rolagem
 * nativa já funciona.
 */
export function useDragToScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((event: React.PointerEvent<T>) => {
    const el = ref.current;
    if (!el || event.pointerType !== "mouse" || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    if (el.scrollWidth <= el.clientWidth) return;

    const startX = event.clientX;
    const startScroll = el.scrollLeft;
    let moved = false;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < THRESHOLD) return;
      if (!moved) {
        moved = true;
        setDragging(true);
      }
      e.preventDefault();
      el.scrollLeft = startScroll - dx;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!moved) return;
      setDragging(false);
      // O clique que vem logo depois de soltar não deve abrir nada
      const swallow = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    };

    // Evita selecionar texto enquanto arrasta
    event.preventDefault();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  return { ref, dragging, onPointerDown };
}
