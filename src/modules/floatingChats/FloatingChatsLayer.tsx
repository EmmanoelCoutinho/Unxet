import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { XIcon } from "lucide-react";
import { ConversationView } from "../../components/chat/ConversationView";
import { SecureImage } from "../../components/ui/SecureImage";
import { useConversationList } from "../../contexts/ConversationsContext";
import type { Conversation } from "../../types";
import { useFloatingChats } from "./FloatingChatsContext";
import type { FloatingBox } from "./layout";

// Erro dentro de uma caixa derruba só a caixa, não o app inteiro
class BoxErrorBoundary extends React.Component<
  { onClose: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("Erro na caixa de conversa:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-gray-600">
          Não foi possível mostrar esta conversa.
        </p>
        <button
          type="button"
          onClick={this.props.onClose}
          className="rounded-lg bg-[#0A84FF] px-4 py-2 text-sm font-medium text-white hover:bg-[#0066d6]"
        >
          Fechar
        </button>
      </div>
    );
  }
}

const initialsOf = (name: string) =>
  name
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "--";

const UnreadBadge: React.FC<{ count: number }> = ({ count }) =>
  count > 0 ? (
    <span className="inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#0A84FF] px-1.5 text-[11px] font-semibold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  ) : null;

const Avatar: React.FC<{ name: string; avatar?: string }> = ({
  name,
  avatar,
}) => (
  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0A84FF] text-[11px] font-medium text-white">
    {avatar ? (
      <SecureImage
        src={avatar}
        alt={`Foto de ${name}`}
        className="h-full w-full object-cover"
        fallback={initialsOf(name)}
      />
    ) : (
      initialsOf(name)
    )}
  </span>
);

const MinimizedBar: React.FC<{
  name: string;
  conversation?: Conversation;
  onExpand: () => void;
  onClose: () => void;
}> = ({ name, conversation, onExpand, onClose }) => {
  const unread = conversation?.unreadCount ?? 0;
  return (
    <div
      className={`pointer-events-auto flex h-12 w-[232px] items-center gap-2 rounded-t-xl border border-b-0 pl-2 pr-1 shadow-lg ${
        unread > 0 ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white"
      }`}
    >
      <button
        type="button"
        onClick={onExpand}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={`Abrir conversa com ${name}`}
      >
        <Avatar name={name} avatar={conversation?.contactAvatar} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#1E1E1E]">
          {name}
        </span>
        <UnreadBadge count={unread} />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        aria-label={`Fechar conversa com ${name}`}
        title="Fechar"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
};

const OverflowMenu: React.FC<{
  boxes: FloatingBox[];
  nameOf: (box: FloatingBox) => string;
  conversationOf: (box: FloatingBox) => Conversation | undefined;
  onOpen: (box: FloatingBox) => void;
  onClose: (box: FloatingBox) => void;
}> = ({ boxes, nameOf, conversationOf, onOpen, onClose }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const unread = boxes.reduce(
    (sum, box) => sum + (conversationOf(box)?.unreadCount ?? 0),
    0,
  );

  return (
    <div ref={ref} className="pointer-events-auto relative">
      {open && (
        <div className="absolute bottom-full right-0 mb-2 max-h-80 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
          {boxes.map((box) => {
            const name = nameOf(box);
            return (
              <div
                key={box.id}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50"
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpen(box);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Avatar name={name} avatar={conversationOf(box)?.contactAvatar} />
                  <span className="min-w-0 flex-1 truncate text-sm text-[#1E1E1E]">
                    {name}
                  </span>
                  <UnreadBadge count={conversationOf(box)?.unreadCount ?? 0} />
                </button>
                <button
                  type="button"
                  onClick={() => onClose(box)}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                  aria-label={`Fechar conversa com ${name}`}
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-12 w-14 items-center justify-center rounded-t-xl border border-b-0 border-gray-200 bg-white text-sm font-semibold text-gray-700 shadow-lg hover:bg-gray-50"
        aria-label={`Mais ${boxes.length} conversas abertas`}
        aria-expanded={open}
        title="Outras conversas abertas"
      >
        +{boxes.length}
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 h-3 w-3 rounded-full bg-[#0A84FF] ring-2 ring-white" />
        )}
      </button>
    </div>
  );
};

/**
 * Caixas flutuantes de conversa, no canto inferior direito de qualquer tela
 * do app (computador e tablet). A primeira caixa fica no canto.
 */
export function FloatingChatsLayer() {
  const navigate = useNavigate();
  const { enabled, visible, overflow, open, minimize, expand, close } =
    useFloatingChats();
  const { conversations } = useConversationList();

  const byId = useMemo(
    () => new Map(conversations.map((c) => [c.id, c])),
    [conversations],
  );

  if (!enabled || visible.length === 0) return null;

  const conversationOf = (box: FloatingBox) => byId.get(box.id);
  const nameOf = (box: FloatingBox) =>
    conversationOf(box)?.contactName || box.title || "Conversa";

  return (
    <div className="pointer-events-none fixed bottom-0 right-4 z-40 flex flex-row-reverse items-end gap-3">
      {visible.map((box) =>
        box.minimized ? (
          <MinimizedBar
            key={box.id}
            name={nameOf(box)}
            conversation={conversationOf(box)}
            onExpand={() => expand(box.id)}
            onClose={() => close(box.id)}
          />
        ) : (
          <section
            key={box.id}
            aria-label={`Conversa com ${nameOf(box)}`}
            className="pointer-events-auto flex h-[min(560px,calc(100dvh-5.5rem))] w-[360px] flex-col overflow-hidden rounded-t-xl border border-b-0 border-gray-200 bg-white shadow-2xl"
          >
            <BoxErrorBoundary onClose={() => close(box.id)}>
              <ConversationView
                conversationId={box.id}
                variant="floating"
                onExit={() => close(box.id)}
                windowControls={{
                  onMinimize: () => minimize(box.id),
                  onMaximize: () => {
                    close(box.id);
                    navigate(`/inbox/chat/${box.id}`);
                  },
                  onClose: () => close(box.id),
                }}
              />
            </BoxErrorBoundary>
          </section>
        ),
      )}

      {overflow.length > 0 && (
        <OverflowMenu
          boxes={overflow}
          nameOf={nameOf}
          conversationOf={conversationOf}
          onOpen={(box) => open(box.id)}
          onClose={(box) => close(box.id)}
        />
      )}
    </div>
  );
}
