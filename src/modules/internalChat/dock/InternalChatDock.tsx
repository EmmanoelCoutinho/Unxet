import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDownIcon,
  Maximize2Icon,
  MessagesSquareIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import {
  readInternalChatSoundEnabled,
  saveInternalChatSoundEnabled,
} from "../../notifications/notificationSounds";
import { ThreadList, type ListEntry } from "../components/shared";
import { formatUnread } from "../utils/format";
import { ThreadView } from "../components/ThreadView";
import { useInternalUnreadTotal } from "../hooks/useInternalChat";
import { useInternalChatDirectory } from "../hooks/useInternalChatDirectory";
import { useInternalDockAvailable } from "./useInternalDockAvailable";
import {
  DOCK_EXPANDED_WIDTH,
  DOCK_MINIMIZED_WIDTH,
  internalDock,
  useInternalDock,
} from "./dockStore";

const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800"
    aria-label={label}
    title={label}
  >
    {children}
  </button>
);

const ExpandedDock: React.FC<{ threadId: string | null }> = ({ threadId }) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [soundOn, setSoundOn] = useState(readInternalChatSoundEnabled);
  const {
    currentUserId,
    threads,
    memberNames,
    entries,
    loading,
    threadsLoading,
    openingUserId,
    titleOf,
    subtitleOf,
    resolveEntry,
  } = useInternalChatDirectory(search);

  const selected = threads.find((thread) => thread.id === threadId) ?? null;
  // Sem conversa escolhida (ou ela sumiu): abre o canal geral
  const general = threads.find((thread) => thread.kind === "general") ?? null;
  const active = selected ?? general;

  useEffect(() => {
    if (!threadsLoading && active && active.id !== threadId) {
      internalDock.selectThread(active.id);
    }
  }, [threadsLoading, active, threadId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        const target = event.target as Node | null;
        if (target && document.getElementById("internal-chat-dock")?.contains(target)) {
          internalDock.minimize();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSelect = async (entry: ListEntry) => {
    const id = await resolveEntry(entry);
    if (id) internalDock.selectThread(id);
  };

  const toggleSound = () => {
    saveInternalChatSoundEnabled(!soundOn);
    setSoundOn(!soundOn);
  };

  return (
    <section
      id="internal-chat-dock"
      aria-label="Chat da equipe"
      style={{ width: DOCK_EXPANDED_WIDTH }}
      className="pointer-events-auto flex h-[min(560px,calc(100dvh-5.5rem))] flex-col overflow-hidden rounded-t-xl border border-b-0 border-gray-200 bg-white shadow-2xl"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-gray-200 bg-[#0A84FF] pl-3 pr-1 text-white">
        <MessagesSquareIcon className="h-4 w-4 flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          Chat da equipe
        </span>
        <div className="flex items-center [&_button]:text-white/90 [&_button:hover]:bg-white/15 [&_button:hover]:text-white">
          <IconButton
            label={soundOn ? "Silenciar o som do chat" : "Ligar o som do chat"}
            onClick={toggleSound}
          >
            {soundOn ? (
              <Volume2Icon className="h-4 w-4" />
            ) : (
              <VolumeXIcon className="h-4 w-4" />
            )}
          </IconButton>
          <IconButton
            label="Abrir em tela cheia"
            onClick={() => {
              internalDock.minimize();
              navigate(active ? `/inbox/team/${active.id}` : "/inbox/team");
            }}
          >
            <Maximize2Icon className="h-4 w-4" />
          </IconButton>
          <IconButton label="Minimizar" onClick={internalDock.minimize}>
            <ChevronDownIcon className="h-5 w-5" />
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {active && currentUserId ? (
            <ThreadView
              key={active.id}
              thread={active}
              title={titleOf(active)}
              subtitle={subtitleOf(active)}
              memberNames={memberNames}
              currentUserId={currentUserId}
              variant="dock"
            />
          ) : (
            <div className="flex flex-1 items-center justify-center bg-gray-50 p-6 text-center">
              {threadsLoading ? (
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              ) : (
                <p className="text-sm text-gray-500">
                  Escolha alguém da equipe para conversar.
                </p>
              )}
            </div>
          )}
        </div>

        <aside
          aria-label="Equipe"
          className="flex w-[232px] flex-shrink-0 flex-col border-l border-gray-200 bg-white"
        >
          <div className="shrink-0 border-b border-gray-100 p-2">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar pessoa..."
              aria-label="Buscar pessoa"
              className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ThreadList
              entries={entries}
              loading={loading}
              activeThreadId={active?.id ?? null}
              currentUserId={currentUserId}
              openingUserId={openingUserId}
              onSelect={handleSelect}
              compact
            />
          </div>
        </aside>
      </div>
    </section>
  );
};

/**
 * Chat interno sempre à mão: uma aba no canto inferior direito com o total de
 * não lidas, que expande para a conversa com a equipe listada à direita.
 */
export function InternalChatDock() {
  const available = useInternalDockAvailable();
  const { expanded, threadId } = useInternalDock();
  const unread = useInternalUnreadTotal();

  useEffect(() => {
    internalDock.setAvailable(available);
    return () => internalDock.setAvailable(false);
  }, [available]);

  if (!available) return null;

  if (expanded) return <ExpandedDock threadId={threadId} />;

  return (
    <button
      type="button"
      onClick={() => internalDock.open()}
      style={{ width: DOCK_MINIMIZED_WIDTH }}
      className={[
        "pointer-events-auto flex h-12 items-center gap-2 rounded-t-xl border border-b-0 px-3 text-left shadow-lg transition-colors",
        unread > 0
          ? "border-[#0A84FF] bg-[#0A84FF] text-white hover:bg-[#0066d6]"
          : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50",
      ].join(" ")}
      aria-label={
        unread > 0
          ? `Abrir o chat da equipe, ${unread} ${unread === 1 ? "mensagem não lida" : "mensagens não lidas"}`
          : "Abrir o chat da equipe"
      }
    >
      <MessagesSquareIcon
        className={`h-5 w-5 flex-shrink-0 ${unread > 0 ? "text-white" : "text-[#0A84FF]"}`}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        Chat da equipe
      </span>
      {unread > 0 && (
        <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-bold leading-none text-[#0A84FF]">
          {formatUnread(unread)}
        </span>
      )}
    </button>
  );
}
