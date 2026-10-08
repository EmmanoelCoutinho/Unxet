import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { XIcon } from "lucide-react";
import {
  isSidebarItemActive,
  settingsItem,
  sidebarItems,
  type SidebarItem,
} from "./AppSidebar";

type MobileNavProps = {
  open: boolean;
  onClose: () => void;
  clinicName?: string | null;
};

// Gaveta de navegação usada abaixo do breakpoint md (substitui o AppSidebar)
export const MobileNav: React.FC<MobileNavProps> = ({
  open,
  onClose,
  clinicName,
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Fecha ao trocar de rota
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const renderItem = (item: SidebarItem) => {
    const Icon = item.icon;
    const active = isSidebarItemActive(item, location.pathname);

    return (
      <button
        key={item.label}
        type="button"
        onClick={() => navigate(item.path)}
        className={[
          "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition",
          active
            ? "bg-blue-50 text-blue-700"
            : "text-gray-700 hover:bg-gray-100 active:bg-gray-100",
        ].join(" ")}
      >
        <Icon className="h-5 w-5 flex-shrink-0" />
        <span className="truncate">{item.label}</span>
      </button>
    );
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-[60] md:hidden ${
        open ? "" : "pointer-events-none"
      }`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navegação"
        className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/logo-unxet.png"
              alt="Logo Unxet"
              className="h-9 w-9 flex-shrink-0 rounded-md object-contain"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight text-gray-900">
                Unxet
              </p>
              <p className="truncate text-xs leading-tight text-gray-500">
                {clinicName || "Central de mensagens"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Fechar menu"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {sidebarItems.map(renderItem)}
        </nav>

        <div className="shrink-0 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {renderItem(settingsItem)}
        </div>
      </aside>
    </div>,
    document.body,
  );
};
