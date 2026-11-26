import React, { useCallback, useEffect, useRef, useState } from "react";
import { MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { CloseButton } from "../ui/CloseButton";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const STEP = 1.5;
const DOUBLE_CLICK_SCALE = 2.5;
// Movimento acima disso é arrastar, não clique (não fecha o visualizador)
const DRAG_THRESHOLD = 4;

type View = { scale: number; x: number; y: number };
const INITIAL: View = { scale: 1, x: 0, y: 0 };

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

type ZoomableImageProps = {
  src: string;
  alt: string;
  /** Clique fora da imagem sem zoom (para fechar o visualizador) */
  onBackgroundClick?: () => void;
  className?: string;
};

/**
 * Imagem com zoom no próprio visualizador, sem baixar: roda do mouse ou
 * pinça no celular, duplo clique/toque, botões + e −, e arrastar para mover
 * quando ampliada. Teclas + / − / 0 também funcionam.
 */
export const ZoomableImage: React.FC<ZoomableImageProps> = ({
  src,
  alt,
  onBackgroundClick,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(INITIAL);
  const viewRef = useRef(view);
  viewRef.current = view;

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startView: View;
    startPoint: { x: number; y: number };
    startDistance: number;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef(0);

  // Não deixa a imagem sair da tela: com zoom, a borda para na borda da área
  const clamp = useCallback((next: View): View => {
    const container = containerRef.current;
    const image = imageRef.current;
    const scale = clampScale(next.scale);
    if (!container || !image || scale === 1) return { scale, x: 0, y: 0 };
    const maxX = Math.max(0, (image.offsetWidth * scale - container.clientWidth) / 2);
    const maxY = Math.max(0, (image.offsetHeight * scale - container.clientHeight) / 2);
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, []);

  // Ponto relativo ao centro da área (a origem da transformação)
  const toCenter = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }, []);

  // Amplia mantendo parado o ponto sob o cursor/dedos
  const zoomAt = useCallback(
    (from: View, nextScale: number, point: { x: number; y: number }) => {
      const scale = clampScale(nextScale);
      const ratio = scale / from.scale;
      return clamp({
        scale,
        x: point.x - (point.x - from.x) * ratio,
        y: point.y - (point.y - from.y) * ratio,
      });
    },
    [clamp],
  );

  const zoomBy = useCallback(
    (factor: number) => setView((v) => zoomAt(v, v.scale * factor, { x: 0, y: 0 })),
    [zoomAt],
  );
  const reset = useCallback(() => setView(INITIAL), []);

  // Imagem nova (próxima foto do álbum): volta ao tamanho normal
  useEffect(() => {
    setView(INITIAL);
  }, [src]);

  // Roda do mouse: o React registra wheel como passivo, sem preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      setView((v) => zoomAt(v, v.scale * factor, toCenter(event.clientX, event.clientY)));
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [zoomAt, toCenter]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "+" || event.key === "=") zoomBy(STEP);
      else if (event.key === "-") zoomBy(1 / STEP);
      else if (event.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, reset]);

  const startGesture = () => {
    const points = [...pointers.current.values()];
    const center =
      points.length >= 2
        ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
        : points[0];
    gesture.current = {
      startView: viewRef.current,
      startPoint: center,
      startDistance:
        points.length >= 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0,
      moved: gesture.current?.moved ?? false,
    };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) gesture.current = null;
    startGesture();
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    const points = [...pointers.current.values()];

    if (points.length >= 2 && g.startDistance > 0) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const pinched = zoomAt(
        g.startView,
        g.startView.scale * (distance / g.startDistance),
        toCenter(g.startPoint.x, g.startPoint.y),
      );
      g.moved = true;
      setView(
        clamp({
          ...pinched,
          x: pinched.x + (mid.x - g.startPoint.x),
          y: pinched.y + (mid.y - g.startPoint.y),
        }),
      );
      return;
    }

    const dx = event.clientX - g.startPoint.x;
    const dy = event.clientY - g.startPoint.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) g.moved = true;
    if (g.startView.scale > 1) {
      setView(clamp({ ...g.startView, x: g.startView.x + dx, y: g.startView.y + dy }));
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    const moved = gesture.current?.moved ?? false;

    if (pointers.current.size > 0) {
      // Saiu um dedo da pinça: o outro continua arrastando dali
      startGesture();
      return;
    }
    gesture.current = null;
    if (moved) return;

    // Com o ponteiro capturado o alvo é sempre a área: confere pela posição
    const rect = imageRef.current?.getBoundingClientRect();
    const onImage = Boolean(
      rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom,
    );
    // Toque duplo no celular (o dblclick do navegador cuida do mouse)
    if (event.pointerType !== "mouse" && onImage) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        toggleZoom(event.clientX, event.clientY);
        return;
      }
      lastTap.current = now;
    }
    if (!onImage && viewRef.current.scale === 1) onBackgroundClick?.();
  };

  const toggleZoom = (clientX: number, clientY: number) =>
    setView((v) =>
      v.scale > 1 ? INITIAL : zoomAt(v, DOUBLE_CLICK_SCALE, toCenter(clientX, clientY)),
    );

  const zoomed = view.scale > 1;

  return (
    <div className={`relative flex min-h-0 w-full flex-1 flex-col ${className}`}>
      <div
        ref={containerRef}
        className={`relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden ${
          zoomed ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(event) => toggleZoom(event.clientX, event.clientY)}
        onClick={(event) => event.stopPropagation()}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          className={`max-h-full max-w-full rounded-lg object-contain ${zoomed ? "" : "cursor-zoom-in"}`}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: gesture.current ? "none" : "transform 120ms ease-out",
          }}
        />
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-white shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => zoomBy(1 / STEP)}
            disabled={view.scale <= MIN_SCALE}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-40"
            aria-label="Diminuir zoom"
            title="Diminuir zoom (−)"
          >
            <MinusIcon className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums">{Math.round(view.scale * 100)}%</span>
          <button
            type="button"
            onClick={() => zoomBy(STEP)}
            disabled={view.scale >= MAX_SCALE}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-40"
            aria-label="Aumentar zoom"
            title="Aumentar zoom (+)"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={!zoomed}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-40"
            aria-label="Tamanho original"
            title="Tamanho original (0)"
          >
            <RotateCcwIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

/** Visualizador em tela cheia de uma imagem, com zoom. Esc fecha. */
export const ImageViewer: React.FC<{ src: string; alt?: string; onClose: () => void }> = ({
  src,
  alt = "Imagem",
  onClose,
}) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black/85"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Visualizar imagem"
    >
      <div className="flex items-center justify-end p-3" onClick={(event) => event.stopPropagation()}>
        <CloseButton onClick={onClose} className="text-white hover:bg-white/10 hover:text-white" />
      </div>
      <div className="flex min-h-0 flex-1 px-4 pb-4">
        <ZoomableImage src={src} alt={alt} onBackgroundClick={onClose} />
      </div>
    </div>
  );
};
