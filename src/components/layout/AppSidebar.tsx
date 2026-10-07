import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
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

type SidebarItem = {
  label: string;
  icon: React.ElementType<{ className?: string }>;
  path: string;
  extraPaths?: string[];
  feature?: FeatureKey;
};

const allSidebarItems: SidebarItem[] = [
  {
    label: "Atendimentos",
    icon: MessageCircleIcon,
    path: "/inbox",
    extraPaths: ["/inbox/chat"],
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
const sidebarItems = allSidebarItems.filter(
  (item) => !item.feature || FEATURES[item.feature],
);

export const AppSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (item: SidebarItem) =>
    location.pathname === item.path ||
    Boolean(
      item.extraPaths?.some((path) => location.pathname.startsWith(path)),
    );

  return (
    <aside className="group flex h-screen w-16 flex-shrink-0 flex-col overflow-hidden border-r bg-gray-50 transition-all duration-200 hover:w-64">
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

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {sidebarItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item);

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
        })}
        <div className="absolute bottom-0 left-0 mt-auto w-16 border-t bg-gray-50 p-2 transition-all duration-200 group-hover:w-64">
          <button
            type="button"
            onClick={() => navigate("/inbox/settings")}
            className={[
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
              "justify-center group-hover:justify-start",
              location.pathname.startsWith("/inbox/settings")
                ? "bg-blue-50 text-blue-700"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
            ].join(" ")}
            title="Configurações"
          >
            <Settings2Icon className="h-5 w-5 flex-shrink-0" />
            <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[220px] group-hover:opacity-100">
              Configurações
            </span>
          </button>
        </div>
      </nav>
    </aside>
  );
};
