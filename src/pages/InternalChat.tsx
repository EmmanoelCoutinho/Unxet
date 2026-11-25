import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MessagesSquareIcon } from "lucide-react";
import { Input } from "../components/ui/Input";
import { ThreadList, type ListEntry } from "../modules/internalChat/components/shared";
import { ThreadView } from "../modules/internalChat/components/ThreadView";
import { useInternalChatDirectory } from "../modules/internalChat/hooks/useInternalChatDirectory";

export const InternalChatPage: React.FC = () => {
  const navigate = useNavigate();
  const { threadId = null } = useParams<{ threadId: string }>();
  const [search, setSearch] = useState("");
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

  const activeThread = threads.find((thread) => thread.id === threadId) ?? null;

  const handleSelect = async (entry: ListEntry) => {
    const id = await resolveEntry(entry);
    if (id) navigate(`/inbox/team/${id}`);
  };

  // Abaixo de xl mostramos um painel por vez: a lista ou a conversa aberta
  return (
    <div className="flex min-h-0 w-full flex-1 bg-white">
      <div
        className={[
          "min-h-0 w-full flex-col border-r xl:flex xl:w-80 xl:flex-shrink-0",
          threadId ? "hidden" : "flex",
        ].join(" ")}
      >
        <div className="shrink-0 border-b p-3 sm:p-4">
          <h2 className="mb-3 text-xl font-semibold">Chat interno</h2>
          <Input
            type="search"
            placeholder="Buscar pessoa..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ThreadList
            entries={entries}
            loading={loading}
            activeThreadId={threadId}
            currentUserId={currentUserId}
            openingUserId={openingUserId}
            onSelect={handleSelect}
          />
        </div>
      </div>

      <div
        className={[
          "min-h-0 min-w-0 flex-1 flex-col xl:flex",
          threadId ? "flex" : "hidden",
        ].join(" ")}
      >
        {activeThread && currentUserId ? (
          <ThreadView
            key={activeThread.id}
            thread={activeThread}
            title={titleOf(activeThread)}
            subtitle={subtitleOf(activeThread)}
            memberNames={memberNames}
            currentUserId={currentUserId}
            onBack={() => navigate("/inbox/team")}
          />
        ) : (
          <div className="flex h-full flex-1 flex-col items-center justify-center bg-gray-50 p-6 text-center">
            {threadId && threadsLoading ? (
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            ) : (
              <>
                <MessagesSquareIcon className="mb-3 h-16 w-16 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900">
                  {threadId ? "Conversa não encontrada" : "Chat interno"}
                </h3>
                <p className="text-sm text-gray-500">
                  {threadId
                    ? "Ela pode ter sido removida ou você não participa dela."
                    : "Escolha alguém da equipe ou o canal Geral para conversar."}
                </p>
                {threadId && (
                  <button
                    type="button"
                    onClick={() => navigate("/inbox/team")}
                    className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700 xl:hidden"
                  >
                    Voltar para a lista
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
