import React, { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ActivityIcon,
  BotIcon,
  Building2Icon,
  ChevronDownIcon,
  FileBarChartIcon,
  KanbanSquareIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  Settings2Icon,
  SparklesIcon,
  TagIcon,
  UsersIcon,
} from "lucide-react";
import { FiBookOpen } from "react-icons/fi";
import { FEATURES, type FeatureKey } from "../../constants/features";
import type { PlanFeature } from "../../constants/plans";
import { useClinic } from "../../contexts/ClinicContext";
import { useIsBelowLg } from "../../hooks/useMediaQuery";
import { useInternalUnreadTotal } from "../../modules/internalChat/hooks/useInternalChat";

export type SidebarGroupId = "atendimento" | "vendas" | "gestao";

// Categorias do menu, na ordem em que aparecem
export const SIDEBAR_GROUPS: { id: SidebarGroupId; label: string }[] = [
  { id: "atendimento", label: "Atendimento" },
  { id: "vendas", label: "Vendas e marketing" },
  { id: "gestao", label: "Gestão" },
];

export type SidebarItem = {
  label: string;
  icon: React.ElementType<{ className?: string }>;
  path: string;
  // Categoria (Configurações fica fora, no rodapé)
  group?: SidebarGroupId;
  extraPaths?: string[];
  feature?: FeatureKey;
  // Recurso que depende do plano da empresa (some se o plano não tem)
  planFeature?: PlanFeature;
  // Só aparece no menu do celular (no desktop o painel já fica ao lado da lista)
  mobileOnly?: boolean;
  // Atendente não vê: só administradores da empresa
  adminOnly?: boolean;
  // Mostra o total de mensagens internas não lidas ao lado do item
  showsInternalUnread?: boolean;
};

export const formatUnreadBadge = (count: number) =>
  count > 99 ? "99+" : String(count);

const allSidebarItems: SidebarItem[] = [
  // Atendimento
  {
    label: "Atendimentos",
    icon: MessageCircleIcon,
    path: "/inbox",
    extraPaths: ["/inbox/chat"],
    group: "atendimento",
  },
  {
    label: "Painel",
    icon: ActivityIcon,
    path: "/inbox/dashboard",
    mobileOnly: true,
    adminOnly: true,
    planFeature: "analytics",
    group: "atendimento",
  },
  {
    label: "Chat interno",
    icon: MessagesSquareIcon,
    path: "/inbox/team",
    extraPaths: ["/inbox/team"],
    showsInternalUnread: true,
    planFeature: "internal_chat",
    group: "atendimento",
  },
  {
    label: "Mensagens rápidas",
    icon: MessageSquareTextIcon,
    path: "/inbox/quick-messages",
    group: "atendimento",
  },
  { label: "Etiquetas", icon: TagIcon, path: "/inbox/tags", group: "atendimento" },
  {
    label: "Bots",
    icon: BotIcon,
    path: "/inbox/bots",
    adminOnly: true,
    planFeature: "bots",
    group: "atendimento",
  },
  {
    // Sem o adicional a tela explica o recurso e como contratar
    label: "Assistente com IA",
    icon: SparklesIcon,
    path: "/inbox/ai-assistant",
    adminOnly: true,
    planFeature: "bots",
    group: "atendimento",
  },
  // Vendas e marketing
  {
    label: "Funil de vendas",
    icon: KanbanSquareIcon,
    path: "/inbox/leads",
    extraPaths: ["/inbox/leads"],
    planFeature: "scheduled_messages",
    group: "vendas",
  },
  {
    label: "Campanhas",
    icon: MegaphoneIcon,
    path: "/inbox/campaigns",
    extraPaths: ["/inbox/campaigns"],
    planFeature: "scheduled_messages",
    group: "vendas",
  },
  {
    // Campanhas com templates aprovados pela Meta (WhatsApp oficial)
    label: "Campanhas Meta",
    icon: MegaphoneIcon,
    path: "/inbox/marketing-campaigns",
    feature: "marketingCampaigns",
    adminOnly: true,
    group: "vendas",
  },
  {
    label: "Carteira de clientes",
    icon: FiBookOpen,
    path: "/contacts",
    adminOnly: true,
    group: "vendas",
  },
  // Gestão
  {
    label: "Relatórios",
    icon: FileBarChartIcon,
    path: "/inbox/reports",
    adminOnly: true,
    planFeature: "analytics",
    group: "gestao",
  },
  {
    label: "Atendentes",
    icon: UsersIcon,
    path: "/inbox/attendants",
    adminOnly: true,
    group: "gestao",
  },
  {
    label: "Departamentos",
    icon: Building2Icon,
    path: "/inbox/departments",
    adminOnly: true,
    planFeature: "departments",
    group: "gestao",
  },
];

/** Itens já filtrados, separados por categoria (categorias vazias somem). */
export const groupSidebarItems = (items: SidebarItem[]) =>
  SIDEBAR_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => (item.group ?? "atendimento") === group.id),
  })).filter((group) => group.items.length > 0);

const CLOSED_GROUPS_KEY = "unxet:nav:closed-groups";

const readClosedGroups = (): SidebarGroupId[] => {
  try {
    const raw = window.localStorage.getItem(CLOSED_GROUPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Categorias que a pessoa fechou (vale para o menu do computador e do
 * celular e fica guardado neste navegador).
 */
export const useClosedSidebarGroups = () => {
  const [closed, setClosed] = useState<SidebarGroupId[]>(readClosedGroups);

  const toggle = useCallback((id: SidebarGroupId) => {
    setClosed((prev) => {
      const next = prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id];
      try {
        window.localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // sem armazenamento: só não lembra na próxima visita
      }
      return next;
    });
  }, []);

  return { closed, toggle };
};

// Itens de módulos desligados em FEATURES não aparecem na navegação
export const sidebarItems = allSidebarItems.filter(
  (item) => !item.feature || FEATURES[item.feature],
);

export const settingsItem: SidebarItem = {
  label: "Configurações",
  icon: Settings2Icon,
  path: "/inbox/settings",
  extraPaths: ["/inbox/settings"],
  adminOnly: true,
};

/**
 * Itens do menu para o papel do usuário logado. Enquanto o vínculo com a
 * empresa carrega, vale a visão de atendente (não pisca item de admin).
 */
export const useSidebarNavigation = () => {
  const { membership, hasFeature } = useClinic();
  const isAdmin = membership?.role === "admin";

  return {
    items: sidebarItems.filter(
      (item) =>
        (isAdmin || !item.adminOnly) &&
        (!item.planFeature || hasFeature(item.planFeature)),
    ),
    settings: isAdmin ? settingsItem : null,
    isAdmin,
  };
};

// No desktop largo a lista de conversas fica sempre ao lado e o início do
// inbox já é o Painel do admin: o item "Atendimentos" vira "Painel".
const desktopPanelItem: SidebarItem = {
  label: "Painel",
  icon: ActivityIcon,
  path: "/inbox",
  extraPaths: ["/inbox/dashboard", "/inbox/chat"],
  adminOnly: true,
  planFeature: "analytics",
  group: "atendimento",
};

/**
 * Itens da barra lateral (md para cima). Entre md e lg a lista e o Painel
 * ocupam a tela um de cada vez, então o admin precisa dos dois itens.
 * O Painel só entra se passou pelo filtro de papel e plano (item mobileOnly
 * presente); sem ele, o início do inbox não é o Painel e fica "Atendimentos".
 */
const desktopItems = (items: SidebarItem[], isBelowLg: boolean) => {
  const hasPanel = items.some((item) => item.path === "/inbox/dashboard");
  if (!hasPanel) return items.filter((item) => !item.mobileOnly);
  if (isBelowLg) return items;
  return items
    .filter((item) => !item.mobileOnly)
    .map((item) => (item.path === "/inbox" ? desktopPanelItem : item));
};

export const isSidebarItemActive = (item: SidebarItem, pathname: string) =>
  pathname === item.path ||
  Boolean(item.extraPaths?.some((path) => pathname.startsWith(path)));

export const AppSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { items, settings } = useSidebarNavigation();
  const isBelowLg = useIsBelowLg();
  const internalUnread = useInternalUnreadTotal();
  const { closed, toggle } = useClosedSidebarGroups();

  const renderItem = (item: SidebarItem) => {
    const Icon = item.icon;
    const active = isSidebarItemActive(item, location.pathname);
    const unread = item.showsInternalUnread ? internalUnread : 0;

    return (
      <button
        key={item.label}
        type="button"
        onClick={() => navigate(item.path)}
        className={[
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
          "justify-center group-hover:justify-start",
          active
            ? "bg-blue-50 text-blue-700"
            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
        ].join(" ")}
        title={item.label}
      >
        <span className="relative flex-shrink-0">
          <Icon className="h-5 w-5" />
          {unread > 0 && (
            <span
              className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0A84FF] px-1 text-[10px] font-semibold leading-none text-white"
              aria-label={`${unread} mensagens internas não lidas`}
            >
              {formatUnreadBadge(unread)}
            </span>
          )}
        </span>
        <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[220px] group-hover:opacity-100">
          {item.label}
        </span>
      </button>
    );
  };

  // No celular a navegação fica no menu do Header (MobileNav).
  // O espaço reservado tem a largura recolhida; ao expandir, a barra passa por cima
  // do conteúdo em vez de empurrá-lo (evita reflow das telas ao passar o mouse).
  return (
    <div className="relative hidden h-full w-16 flex-shrink-0 md:block">
      <aside className="group absolute inset-y-0 left-0 z-30 flex w-16 flex-col overflow-hidden border-r bg-gray-50 transition-all duration-200 hover:w-64 hover:shadow-xl">
        <div className="border-b p-4">
          <div className="flex items-center gap-3">
            <img
              src="/logo-unxet.png"
              alt="Logo Unxet"
              className="h-9 w-9 rounded-md object-contain"
            />
            <div className="max-w-0 overflow-hidden transition-all duration-200 group-hover:max-w-[200px]">
              <div className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <p className="text-sm font-semibold leading-tight text-gray-900">
                  Unxet
                </p>
                <p className="text-xs leading-tight text-gray-500">
                  Central de mensagens
                </p>
              </div>
            </div>
          </div>
        </div>

        {/*
          Recolhido (só ícones): linhas finas separam as categorias.
          Aberto (mouse em cima): título da categoria, que fecha/abre os itens.
        */}
        <nav aria-label="Menu principal" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
          {groupSidebarItems(desktopItems(items, isBelowLg)).map((group, index) => {
            const isClosed = closed.includes(group.id);
            const hasActive = group.items.some((item) =>
              isSidebarItemActive(item, location.pathname),
            );
            const hasUnread =
              internalUnread > 0 && group.items.some((item) => item.showsInternalUnread);
            return (
              <div key={group.id}>
                {index > 0 && (
                  <div className="mx-3 my-2 h-px bg-gray-200 group-hover:hidden" aria-hidden="true" />
                )}
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  aria-expanded={!isClosed}
                  className={`hidden h-7 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 group-hover:flex ${
                    index > 0 ? "mt-3" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {group.label}
                    {isClosed && (hasActive || hasUnread) && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[#0A84FF]" aria-label="Tem item ativo ou mensagem nova" />
                    )}
                  </span>
                  <ChevronDownIcon
                    className={`h-3.5 w-3.5 transition-transform ${isClosed ? "-rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                {/* Fechada: some só com o menu aberto; recolhido mostra todos os ícones */}
                <div className={`mt-0.5 space-y-1 ${isClosed ? "group-hover:hidden" : ""}`}>
                  {group.items.map(renderItem)}
                </div>
              </div>
            );
          })}
        </nav>

        {settings && (
          <div className="shrink-0 border-t bg-gray-50 p-2">
            {renderItem(settings)}
          </div>
        )}
      </aside>
    </div>
  );
};
