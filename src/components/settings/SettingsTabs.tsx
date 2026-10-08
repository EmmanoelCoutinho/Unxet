import React from "react";
import { useLocation, useNavigate } from "react-router-dom";

type SettingsTabItem = {
  label: string;
  path: string;
  isActive: (pathname: string) => boolean;
};

const SETTINGS_TABS: SettingsTabItem[] = [
  {
    label: "Automações de conversa",
    path: "/inbox/settings/automations/conversations",
    isActive: (pathname) => pathname.startsWith("/inbox/settings/automations"),
  },
  {
    label: "Integrações",
    path: "/inbox/settings/integrations/meta",
    isActive: (pathname) => pathname.startsWith("/inbox/settings/integrations"),
  },
];

export const SettingsTabs: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="-mx-4 mt-4 flex min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {SETTINGS_TABS.map((tab) => {
        const active = tab.isActive(location.pathname);

        return (
          <button
            key={tab.path}
            type="button"
            onClick={() => navigate(tab.path)}
            className={[
              "shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium transition",
              active
                ? "border-b-2 border-blue-600 text-blue-600"
                : "bg-white text-slate-700 hover:bg-slate-50 border-b-2 border-gray-200",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
