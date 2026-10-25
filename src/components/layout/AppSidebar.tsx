import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ActivityIcon,
  BotIcon,
  Building2Icon,
  FileBarChartIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  Settings2Icon,
  TagIcon,
  UsersIcon,
} from "lucide-react";
import { FiBookOpen } from "react-icons/fi";
import { FEATURES, type FeatureKey } from "../../constants/features";
import type { PlanFeature } from "../../constants/plans";
import { useClinic } from "../../contexts/ClinicContext";
import { useIsBelowLg } from "../../hooks/useMediaQuery";
import { useInternalUnreadTotal } from "../../modules/internalChat/hooks/useInternalChat";

export type SidebarItem = {
  label: string;
  icon: React.ElementType<{ className?: string }>;
  path: string;
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
  {
    label: "Atendimentos",
    icon: MessageCircleIcon,
    path: "/inbox",
    extraPaths: ["/inbox/chat"],
  },
  {
    label: "Chat interno",
    icon: MessagesSquareIcon,
    path: "/inbox/team",
    extraPaths: ["/inbox/team"],
    showsInternalUnread: true,
    planFeature: "internal_chat",
  },
  {
    label: "Painel",
    icon: ActivityIcon,
    path: "/inbox/dashboard",
    mobileOnly: true,
    adminOnly: true,
    planFeature: "analytics",
  },
  {
    label: "Relatórios",
    icon: FileBarChartIcon,
    path: "/inbox/reports",
    adminOnly: true,
    planFeature: "analytics",
  },
  {
    label: "Carteira de Clientes",
    icon: FiBookOpen,
    path: "/contacts",
    adminOnly: true,
  },
  {
    label: "Atendentes",
    icon: UsersIcon,
    path: "/inbox/attendants",
    adminOnly: true,
  },
  {
    label: "Departamentos",
    icon: Building2Icon,
    path: "/inbox/departments",
    adminOnly: true,
    planFeature: "departments",
  },
  { label: "Etiquetas", icon: TagIcon, path: "/inbox/tags" },
  {
    label: "Bots",
    icon: BotIcon,
    path: "/inbox/bots",
    adminOnly: true,
    planFeature: "bots",
  },
  {
    label: "Mensagens rápidas",
    icon: MessageSquareTextIcon,
    path: "/inbox/quick-messages",
  },
  {
    label: "Campanhas",
    icon: MegaphoneIcon,
    path: "/inbox/campaigns",
    extraPaths: ["/inbox/campaigns"],
    planFeature: "scheduled_messages",
  },
  {
    // Campanhas com templates aprovados pela Meta (WhatsApp oficial)
    label: "Campanhas Meta",
    icon: MegaphoneIcon,
    path: "/inbox/marketing-campaigns",
    feature: "marketingCampaigns",
    adminOnly: true,
  },
];

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

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {desktopItems(items, isBelowLg).map(renderItem)}
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
