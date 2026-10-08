import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3Icon,
  BotIcon,
  Building2Icon,
  MegaphoneIcon,
  MessageCircleIcon,
  MessageSquareTextIcon,
  SendToBack,
  Settings2Icon,
  TagIcon,
  UsersIcon,
} from "lucide-react";
import { FiBookOpen } from "react-icons/fi";
import { FEATURES, type FeatureKey } from "../../constants/features";

export type SidebarItem = {
  label: string;
  icon: React.ElementType<{ className?: string }>;
  path: string;
  extraPaths?: string[];
  feature?: FeatureKey;
  // Só aparece no menu do celular (no desktop o painel já fica ao lado da lista)
  mobileOnly?: boolean;
};

const allSidebarItems: SidebarItem[] = [
  {
    label: "Atendimentos",
    icon: MessageCircleIcon,
    path: "/inbox",
    extraPaths: ["/inbox/chat"],
  },
  {
    label: "Painel",
    icon: BarChart3Icon,
    path: "/inbox/dashboard",
    mobileOnly: true,
  },
  { label: "Carteira de Clientes", icon: FiBookOpen, path: "/contacts" },
  { label: "Atendentes", icon: UsersIcon, path: "/inbox/attendants" },
  { label: "Departamentos", icon: Building2Icon, path: "/inbox/departments" },
  { label: "Etiquetas", icon: TagIcon, path: "/inbox/tags" },
  { label: "Bots", icon: BotIcon, path: "/inbox/bots" },
  {
    label: "Mensagens rápidas",
    icon: MessageSquareTextIcon,
    path: "/inbox/quick-messages",
  },
  {
    label: "Marketing / Campanhas",
    icon: MegaphoneIcon,
    path: "/inbox/marketing-campaigns",
    feature: "marketingCampaigns",
  },
  {
    label: "Mensagens em massa",
    icon: SendToBack,
    path: "/inbox/mass-messages",
    feature: "massMessages",
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
};

export const isSidebarItemActive = (item: SidebarItem, pathname: string) =>
  pathname === item.path ||
  Boolean(item.extraPaths?.some((path) => pathname.startsWith(path)));

export const AppSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const renderItem = (item: SidebarItem) => {
    const Icon = item.icon;
    const active = isSidebarItemActive(item, location.pathname);

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
        <Icon className="h-5 w-5 flex-shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[220px] group-hover:opacity-100">
          {item.label}
        </span>
      </button>
    );
  };

  // No celular a navegação fica no menu do Header (MobileNav)
  return (
    <aside className="group hidden h-full w-16 flex-shrink-0 flex-col overflow-hidden border-r bg-gray-50 transition-all duration-200 hover:w-64 md:flex">
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
        {sidebarItems.filter((item) => !item.mobileOnly).map(renderItem)}
      </nav>

      <div className="shrink-0 border-t bg-gray-50 p-2">
        {renderItem(settingsItem)}
      </div>
    </aside>
  );
};
