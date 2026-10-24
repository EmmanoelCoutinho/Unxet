import React, { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useMatch } from "react-router-dom";
import { MessageSquareIcon, SlidersHorizontalIcon } from "lucide-react";

import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { AppSidebar } from "../components/layout/AppSidebar";
import { ConversationItem } from "../components/inbox/ConversationItem";
import { ChannelFilter } from "../components/inbox/ChannelFilter";
import { TagFilter } from "../components/inbox/TagFilter";
import { useConversationList } from "../contexts/ConversationsContext";
import { useOpenConversation } from "../modules/floatingChats/useOpenConversation";
import {
  getAssigneeLabel,
  useClinicUserNames,
} from "../hooks/useClinicUserNames";
import { useWhatsappConnections } from "../hooks/useWhatsappConnections";
import { useAuth } from "../contexts/AuthContext";
import { useClinic } from "../contexts/ClinicContext";
import { setAppBadge } from "../lib/pushNotifications";
import { PushNotificationsPrompt } from "../components/inbox/PushNotificationsPrompt";
import type { Channel } from "../types";

type InboxTab = "open" | "pending" | "bot";

export const Inbox: React.FC = () => {
  const location = useLocation();
  // Abaixo de lg mostramos um painel por vez: a lista em /inbox e as demais telas no lugar dela
  const isInboxRoot = location.pathname.replace(/\/+$/, "") === "/inbox";
  // O chat interno tem a própria lista; a de conversas com clientes some ali
  const isInternalChat = location.pathname.startsWith("/inbox/team");

  const activeConversationId = useMatch("/inbox/chat/:id")?.params.id ?? null;

  // A lista vive acima das rotas: as caixas flutuantes também usam
  const {
    conversations,
    loading: isLoading,
    totalUnreadCount,
    totalUnreadOpen,
    totalUnreadPending,
  } = useConversationList();
  const openConversation = useOpenConversation();

  const { authUser } = useAuth();
  const { clinicId, membership, hasFeature } = useClinic();
  const isAdmin = membership?.role === "admin";
  // No início do inbox o admin vê o painel ao lado da lista; o atendente,
  // uma tela vazia, que dá lugar à lista inteira
  const listFillsScreen =
    isInboxRoot && !(isAdmin && hasFeature("analytics"));
  const userNames = useClinicUserNames(clinicId, isAdmin);
  const { hasMultiple: hasMultipleWhatsapp } = useWhatsappConnections(clinicId);

  useEffect(() => {
    const baseTitle = "Unxet";
    document.title =
      totalUnreadCount > 0 ? `(${totalUnreadCount}) ${baseTitle}` : baseTitle;
    setAppBadge(totalUnreadCount);

    return () => {
      document.title = baseTitle;
    };
  }, [totalUnreadCount]);

  const [tab, setTab] = useState<InboxTab>("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<Channel[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFiltersCount = selectedChannels.length + selectedTagIds.length;

  useEffect(() => {
    const handleTabChange = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail === "open") {
        setTab("open");
      }
    };

    window.addEventListener("inbox:tab", handleTabChange);
    return () => window.removeEventListener("inbox:tab", handleTabChange);
  }, []);

  const visibleConversations = useMemo(() => {
    return conversations.filter((conversation) => conversation.status !== "closed");
  }, [conversations]);

  const filtered = useMemo(() => {
    const query = searchQuery.toLowerCase();

    return visibleConversations.filter((conversation) => {
      const matchesSearch =
        conversation.contactName?.toLowerCase().includes(query) ||
        conversation.contactNumber?.includes(query) ||
        conversation.lastMessage?.toLowerCase().includes(query);

      const matchesChannel =
        selectedChannels.length === 0 ||
        selectedChannels.includes(conversation.channel);

      const matchesTag =
        selectedTagIds.length === 0 ||
        (conversation.tags ?? []).some((tag) => selectedTagIds.includes(tag.id));

      return matchesSearch && matchesChannel && matchesTag;
    });
  }, [visibleConversations, searchQuery, selectedChannels, selectedTagIds]);

  const openConversations = useMemo(() => {
    return filtered.filter((conversation) => conversation.status === "open");
  }, [filtered]);

  const pendingConversations = useMemo(() => {
    return filtered.filter(
      (conversation) =>
        conversation.status === "pending" && !conversation.inBotFlow,
    );
  }, [filtered]);

  // Clientes que o bot ainda conduz (não escolheram uma opção, não chegaram a um setor)
  const botConversations = useMemo(() => {
    return filtered.filter(
      (conversation) =>
        conversation.status === "pending" && conversation.inBotFlow,
    );
  }, [filtered]);

  const currentList =
    tab === "open"
      ? openConversations
      : tab === "pending"
        ? pendingConversations
        : botConversations;

  return (
    <div className="flex h-full w-full overflow-x-hidden bg-white">
      <AppSidebar />

      <div
        className={[
          "h-full min-h-0 w-full flex-col border-r",
          // Sem conversa em tela cheia nem painel ao lado, a lista ocupa a tela
          // (as conversas abrem em caixas flutuantes por cima)
          listFillsScreen ? "lg:min-w-0 lg:flex-1" : "lg:w-96 lg:flex-shrink-0",
          isInboxRoot ? "flex" : "hidden",
          isInternalChat ? "lg:hidden" : "lg:flex",
        ].join(" ")}
      >
        <div className="shrink-0 border-b p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4">
            <h2 className="text-xl font-semibold">Conversas</h2>
            {totalUnreadCount > 0 && (
              <Badge variant="warning">{totalUnreadCount} não lidas</Badge>
            )}
          </div>

          <PushNotificationsPrompt />

          <div className="mb-3 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Input
                type="search"
                placeholder="Buscar..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((value) => !value)}
              className={[
                "relative flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-lg border transition lg:hidden",
                filtersOpen || activeFiltersCount > 0
                  ? "border-blue-500 bg-blue-50 text-blue-600"
                  : "border-[#E5E7EB] text-gray-600 hover:bg-gray-50",
              ].join(" ")}
              aria-label="Filtros"
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontalIcon className="h-5 w-5" />
              {activeFiltersCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0A84FF] px-1 text-[11px] font-semibold text-white">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>

          <div className={filtersOpen ? "block" : "hidden lg:block"}>
            <ChannelFilter
              selectedChannels={selectedChannels}
              onChange={setSelectedChannels}
            />

            <TagFilter
              selectedTagIds={selectedTagIds}
              onChange={setSelectedTagIds}
            />
          </div>

          <div className="mt-3 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTab("open")}
              className={[
                "h-10 flex-auto whitespace-nowrap px-2 text-sm font-medium transition",
                tab === "open"
                  ? "border-b-4 border-blue-500 text-blue-500"
                  : "bg-white text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                Abertas
                <span className="text-xs opacity-90">
                  ({openConversations.length})
                </span>
                {totalUnreadOpen > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0A84FF] px-1.5 text-[11px] font-semibold leading-none text-white">
                    {totalUnreadOpen}
                  </span>
                )}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTab("pending")}
              className={[
                "h-10 flex-auto whitespace-nowrap px-2 text-sm font-medium transition",
                tab === "pending"
                  ? "border-b-4 border-blue-500 text-blue-500"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                Pendentes
                <span className="text-xs opacity-90">
                  ({pendingConversations.length})
                </span>
                {totalUnreadPending > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0A84FF] px-1.5 text-[11px] font-semibold leading-none text-white">
                    {totalUnreadPending}
                  </span>
                )}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTab("bot")}
              title="Clientes que ainda estão no atendimento automático"
              className={[
                "h-10 flex-auto whitespace-nowrap px-2 text-sm font-medium transition",
                tab === "bot"
                  ? "border-b-4 border-blue-500 text-blue-500"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                No bot
                <span className="text-xs opacity-90">
                  ({botConversations.length})
                </span>
              </span>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-20 animate-pulse rounded bg-gray-200"
                />
              ))}
            </div>
          ) : currentList.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-5 sm:p-8 text-center">
              <MessageSquareIcon className="mb-3 h-12 w-12 text-gray-300" />
              <p className="font-medium">
                {tab === "open"
                  ? "Nenhuma conversa aberta"
                  : tab === "pending"
                    ? "Nenhuma conversa pendente"
                    : "Nenhum cliente no bot"}
              </p>
              <p className="text-sm text-gray-500">
                {tab === "bot"
                  ? "Quem não concluir o atendimento automático aparece aqui."
                  : "Novas conversas aparecem aqui automaticamente."}
              </p>
            </div>
          ) : (
            <div className="divide-y pb-6 lg:pb-20">
              {currentList.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  assigneeName={
                    isAdmin
                      ? getAssigneeLabel(
                          conversation.assignedTo,
                          authUser?.id,
                          userNames,
                        )
                      : undefined
                  }
                  connectionLabel={
                    hasMultipleWhatsapp && conversation.channel === "whatsapp"
                      ? conversation.connectionLabel
                      : undefined
                  }
                  onClick={() =>
                    openConversation(conversation.id, {
                      title: conversation.contactName,
                      // Com uma conversa em tela cheia, a próxima também abre assim
                      fullScreen: Boolean(activeConversationId),
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        className={[
          "min-h-0 min-w-0 flex-1 flex-col",
          listFillsScreen ? "lg:hidden" : "lg:flex",
          isInboxRoot ? "hidden" : "flex",
        ].join(" ")}
      >
        <Outlet />
      </div>
    </div>
  );
};

