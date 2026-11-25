import { useSyncExternalStore } from "react";

// Janela do chat interno no canto inferior direito (computador e tablet).
// O estado fica fora do React para o InternalChatBridge abrir a janela ao
// clicar no aviso de mensagem nova, de qualquer tela.

export type InternalDockState = {
  /** A janela está montada na tela (desligada no celular e na página do chat). */
  available: boolean;
  expanded: boolean;
  threadId: string | null;
};

// Largura ocupada no canto: as caixas de conversa de clientes ficam à esquerda
export const DOCK_MINIMIZED_WIDTH = 232;
export const DOCK_EXPANDED_WIDTH = 640;
export const DOCK_GAP = 12;

const STORAGE_KEY = "unxet:internal-chat-dock";

type Stored = Pick<InternalDockState, "expanded" | "threadId">;

export function parseStoredDock(raw: unknown): Stored {
  if (!raw || typeof raw !== "object") return { expanded: false, threadId: null };
  const { expanded, threadId } = raw as Record<string, unknown>;
  return {
    expanded: expanded === true,
    threadId: typeof threadId === "string" && threadId ? threadId : null,
  };
}

function readStored(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return parseStoredDock(raw ? JSON.parse(raw) : null);
  } catch {
    return { expanded: false, threadId: null };
  }
}

let state: InternalDockState = {
  available: false,
  ...(typeof window === "undefined"
    ? { expanded: false, threadId: null }
    : readStored()),
};
const listeners = new Set<() => void>();

function setState(patch: Partial<InternalDockState>) {
  const next = { ...state, ...patch };
  if (
    next.available === state.available &&
    next.expanded === state.expanded &&
    next.threadId === state.threadId
  ) {
    return;
  }
  state = next;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ expanded: state.expanded, threadId: state.threadId }),
    );
  } catch {
    // sem armazenamento: a janela só não volta como estava depois de recarregar
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getInternalDockState = () => state;

export const useInternalDock = () =>
  useSyncExternalStore(subscribe, getInternalDockState, getInternalDockState);

/** Largura que a janela ocupa no canto (0 quando não está na tela). */
export const internalDockWidth = (dock: InternalDockState) =>
  !dock.available
    ? 0
    : (dock.expanded ? DOCK_EXPANDED_WIDTH : DOCK_MINIMIZED_WIDTH) + DOCK_GAP;

export const internalDock = {
  setAvailable: (available: boolean) => setState({ available }),
  /** Expande a janela; com `threadId`, já abre essa conversa. */
  open: (threadId?: string) =>
    setState({ expanded: true, ...(threadId ? { threadId } : {}) }),
  minimize: () => setState({ expanded: false }),
  selectThread: (threadId: string | null) => setState({ threadId }),
};
