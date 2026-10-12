import React from "react";
import { NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { LogOut } from "lucide-react";
import logo from "../../assets/logo-unxet.png";
import { AdminAuthProvider, useAdminAuth } from "./contexts/AdminAuthContext";
import { AdminLogin } from "./pages/AdminLogin";
import { MetricsPage } from "./pages/MetricsPage";
import { OnboardingPage } from "./pages/OnboardingPage";

// Novas abas do painel (planos etc.) entram aqui e nas rotas abaixo
const ADMIN_TABS = [
  { to: "/admin/overview", label: "Visão geral" },
  { to: "/admin/onboarding", label: "Onboarding" },
];

const AdminLoadingScreen = () => (
  <div className="min-h-dvh w-full flex items-center justify-center bg-white">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003366] border-t-transparent" />
  </div>
);

const AdminLayout: React.FC = () => {
  const { adminUser, signOut } = useAdminAuth();

  if (!adminUser) return <Navigate to="/admin/login" replace />;

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-[#E5E7EB] bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Unxet" className="h-8 object-contain" />
            <span className="rounded-full bg-[#003366] px-3 py-1 text-xs font-medium text-white">
              Painel administrativo
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span className="hidden sm:inline">{adminUser.email}</span>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-[#1E1E1E] hover:bg-[#E5E7EB]"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 px-4 sm:px-8">
          {ADMIN_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                [
                  "border-b-2 px-3 py-2 text-sm font-medium",
                  isActive
                    ? "border-[#003366] text-[#003366]"
                    : "border-transparent text-gray-500 hover:text-[#1E1E1E]",
                ].join(" ")
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="px-4 py-8 sm:px-8">
        <Outlet />
      </main>
    </div>
  );
};

const AdminRoutes: React.FC = () => {
  const { loading } = useAdminAuth();

  if (loading) return <AdminLoadingScreen />;

  return (
    <Routes>
      <Route path="login" element={<AdminLogin />} />
      <Route element={<AdminLayout />}>
        <Route path="overview" element={<MetricsPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin/overview" replace />} />
    </Routes>
  );
};

export const AdminApp: React.FC = () => (
  <AdminAuthProvider>
    <AdminRoutes />
  </AdminAuthProvider>
);
