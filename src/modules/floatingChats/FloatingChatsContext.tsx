import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMatch } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useClinic } from "../../contexts/ClinicContext";
import { useIsBelowLg } from "../../hooks/useMediaQuery";
import {
  layoutBoxes,
  openBox,
  parseStoredBoxes,
  type FloatingBox,
} from "./layout";

// Espaço à esquerda (menu lateral) e à direita que as caixas não ocupam
const SIDE_MARGIN = 96 + 16;

type FloatingChatsValue = {
  /** Caixas flutuantes disponíveis (computador e tablet, com usuário logado). */
  enabled: boolean;
  visible: FloatingBox[];
  overflow: FloatingBox[];
  /** Caixas expandidas e na tela: contam como conversa sendo lida. */
  viewingIds: string[];
  open: (id: string, title?: string) => void;
  minimize: (id: string) => void;
  expand: (id: string) => void;
  close: (id: string) => void;
  /** Rascunho da mensagem: segue a conversa entre a caixa e a tela cheia. */
  getDraft: (id: string) => string;
  setDraft: (id: string, value: string) => void;
};

const FloatingChatsContext = createContext<FloatingChatsValue | null>(null);

const storageKey = (userId: string, clinicId: string) =>
  `unxet:floating-chats:${userId}:${clinicId}`;

function readStored(key: string | null) {
  if (!key) return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? parseStoredBoxes(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function useWindowWidth() {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export function FloatingChatsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { authUser } = useAuth();
  const { clinicId } = useClinic();
  const isBelowLg = useIsBelowLg();
  const windowWidth = useWindowWidth();
  // Conversa aberta em tela cheia não aparece também como caixa
  const maximizedId = useMatch("/inbox/chat/:id")?.params.id ?? null;

  const userId = authUser?.id ?? null;
  const key = userId && clinicId ? storageKey(userId, clinicId) : null;

  const [state, setState] = useState(() => ({ key, boxes: readStored(key) }));
  // Troca de usuário ou de empresa: carrega as caixas de quem entrou
  const boxes = state.key === key ? state.boxes : readStored(key);
  useEffect(() => {
    if (state.key !== key) setState({ key, boxes: readStored(key) });
  }, [key, state.key]);

  const update = useCallback(
    (fn: (current: FloatingBox[]) => FloatingBox[]) => {
      setState((current) => {
        const base = current.key === key ? current.boxes : readStored(key);
        const next = fn(base);
        if (key) {
          try {
            window.localStorage.setItem(key, JSON.stringify(next));
          } catch {
            // sem armazenamento: as caixas só não voltam depois de recarregar
          }
        }
        return { key, boxes: next };
      });
    },
    [key],
  );

  const enabled = !isBelowLg && Boolean(userId && clinicId);

  const { visible, overflow } = useMemo(() => {
    if (!enabled) return { visible: [], overflow: [] };
    const shown = boxes.filter((box) => box.id !== maximizedId);
    return layoutBoxes(shown, windowWidth - SIDE_MARGIN);
  }, [enabled, boxes, maximizedId, windowWidth]);

  const viewingKey = visible
    .filter((box) => !box.minimized)
    .map((box) => box.id)
    .join(",");
  const viewingIds = useMemo(
    () => (viewingKey ? viewingKey.split(",") : []),
    [viewingKey],
  );

  const open = useCallback(
    (id: string, title = "") => update((current) => openBox(current, id, title)),
    [update],
  );
  const setMinimized = useCallback(
    (id: string, minimized: boolean) =>
      update((current) =>
        current.map((box) => (box.id === id ? { ...box, minimized } : box)),
      ),
    [update],
  );
  const minimize = useCallback((id: string) => setMinimized(id, true), [setMinimized]);
  const expand = useCallback((id: string) => setMinimized(id, false), [setMinimized]);
  const close = useCallback(
    (id: string) => update((current) => current.filter((box) => box.id !== id)),
    [update],
  );

  const draftsRef = useRef(new Map<string, string>());
  const getDraft = useCallback(
    (id: string) => draftsRef.current.get(id) ?? "",
    [],
  );
  const setDraft = useCallback((id: string, value: string) => {
    if (value) draftsRef.current.set(id, value);
    else draftsRef.current.delete(id);
  }, []);

  const value = useMemo<FloatingChatsValue>(
    () => ({
      enabled,
      visible,
      overflow,
      viewingIds,
      open,
      minimize,
      expand,
      close,
      getDraft,
      setDraft,
    }),
    [
      enabled,
      visible,
      overflow,
      viewingIds,
      open,
      minimize,
      expand,
      close,
      getDraft,
      setDraft,
    ],
  );

  return (
    <FloatingChatsContext.Provider value={value}>
      {children}
    </FloatingChatsContext.Provider>
  );
}

export function useFloatingChats() {
  const value = useContext(FloatingChatsContext);
  if (!value) {
    throw new Error("useFloatingChats precisa do FloatingChatsProvider");
  }
  return value;
}
