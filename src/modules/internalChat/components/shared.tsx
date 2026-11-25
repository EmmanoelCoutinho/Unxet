import React from "react";
import { UsersIcon } from "lucide-react";
import type { InternalThread, TeamMember } from "../types/internalChat";
import {
  formatListTime,
  formatUnread,
  getInitials,
  roleLabel,
} from "../utils/format";

export const Avatar: React.FC<{
  name?: string;
  general?: boolean;
  size?: "md" | "sm";
}> = ({ name, general, size = "md" }) => (
  <div
    className={[
      "flex flex-shrink-0 items-center justify-center rounded-full font-semibold",
      size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm",
      general ? "bg-blue-50 text-blue-700" : "bg-gray-200 text-gray-700",
    ].join(" ")}
  >
    {general ? (
      <UsersIcon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    ) : (
      getInitials(name ?? "")
    )}
  </div>
);

export type ListEntry = {
  key: string;
  name: string;
  general: boolean;
  member?: TeamMember;
  thread?: InternalThread;
};

type ThreadListProps = {
  entries: ListEntry[];
  loading: boolean;
  activeThreadId: string | null;
  currentUserId?: string;
  openingUserId: string | null;
  onSelect: (entry: ListEntry) => void;
  /** Lista estreita da janela flutuante: sem prévia da última mensagem. */
  compact?: boolean;
};

export const ThreadList: React.FC<ThreadListProps> = ({
  entries,
  loading,
  activeThreadId,
  currentUserId,
  openingUserId,
  onSelect,
  compact,
}) => {
  if (loading) {
    return (
      <div className="space-y-3 p-4">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-14 animate-pulse rounded bg-gray-200" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-gray-500">
        Ninguém encontrado.
      </p>
    );
  }

  // Na janela flutuante o canal geral fica fixo e as pessoas vêm abaixo de um título
  const firstPersonIndex = entries.findIndex((entry) => !entry.general);

  return (
    <div className={compact ? "" : "divide-y"}>
      {entries.map((entry, index) => {
        const { thread } = entry;
        const active = !!thread && thread.id === activeThreadId;
        const unread = thread?.unreadCount ?? 0;
        const preview = thread?.lastMessageBody
          ? `${thread.lastMessageSenderId === currentUserId ? "Você: " : ""}${thread.lastMessageBody}`
          : entry.general
            ? "Toda a equipe"
            : roleLabel(entry.member?.role ?? "agent");

        return (
          <React.Fragment key={entry.key}>
            {compact && index === firstPersonIndex && (
              <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Pessoas
              </p>
            )}
            <button
              type="button"
              disabled={openingUserId === entry.member?.userId}
              onClick={() => onSelect(entry)}
              title={compact ? entry.name : undefined}
              className={[
                "flex w-full items-center text-left transition disabled:opacity-60",
                compact ? "gap-2 px-3 py-2" : "gap-3 px-3 py-3 sm:px-4",
                active ? "bg-blue-50" : "hover:bg-gray-50",
                compact && entry.general ? "border-b border-gray-100" : "",
              ].join(" ")}
            >
              <Avatar
                name={entry.name}
                general={entry.general}
                size={compact ? "sm" : "md"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={[
                      "truncate text-sm text-gray-900",
                      compact && unread > 0 ? "font-semibold" : "font-medium",
                    ].join(" ")}
                  >
                    {entry.name}
                  </span>
                  {compact
                    ? unread > 0 && (
                        <span className="flex-shrink-0 rounded-full bg-[#0A84FF] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                          {formatUnread(unread)}
                        </span>
                      )
                    : thread?.lastMessageAt && (
                        <span className="flex-shrink-0 text-xs text-gray-500">
                          {formatListTime(thread.lastMessageAt)}
                        </span>
                      )}
                </div>
                {!compact && (
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={[
                        "truncate text-sm",
                        unread > 0 ? "font-medium text-gray-900" : "text-gray-500",
                      ].join(" ")}
                    >
                      {preview}
                    </span>
                    {unread > 0 && (
                      <span className="flex-shrink-0 rounded-full bg-[#0A84FF] px-2 py-0.5 text-xs font-semibold text-white">
                        {formatUnread(unread)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};
