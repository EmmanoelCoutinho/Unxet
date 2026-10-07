import React, { ReactNode } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Login } from "./pages/Login";
import { ForgotPassword } from "./pages/ForgotPassword"; 
import { Inbox } from "./pages/Inbox";
import { Chat } from "./pages/Chat";
import { Header } from "./components/layout/Header";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { InboxAnalyticsDashboard } from "./pages/InboxAnalyticsDashboard";
import { Tags } from "./pages/Tags";
import { ClinicProvider } from "./contexts/ClinicContext";
import { DepartmentsPage } from "./pages/DepartmentsPage";
import { AttendantsPage } from "./pages/AttendantsPage";
import { AuthCallback } from "./pages/Callback";
import { SetPassword } from "./pages/SetPassword";
import { MetaIntegrationsPage } from "./pages/IntegrationsMetaPage";
import { MetaCallbackPage } from "./pages/IntegrationCallbackPage";
import { ConversationAutomationSettingsPage } from "./pages/ConversationAutomationSettingsPage";
import { BotsSettingsPage } from "./pages/BotsSettingsPage";
import { BotEditorPage } from "./pages/BotEditorPage";
import { QuickMessagesPage } from "./pages/QuickMessagesPage";
import { MarketingCampaignsPage } from "./pages/MarketingCampaignsPage";
import { ContactsPage } from "./pages/Contacts";
// 1. IMPORTAR A NOVA PÁGINA DE MENSAGENS EM MASSA
import { MassMessagesPage } from "./pages/MassMessages"; 
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { FEATURES, type FeatureKey } from "./constants/features";

type RequireAuthProps = {
  children: ReactNode;
};

const AuthLoadingScreen = () => (
  <div className="min-h-screen w-full flex items-center justify-center bg-white">
    <div className="flex flex-col items-center gap-3 text-gray-600">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      <span className="text-sm">Carregando sessão...</span>
    </div>
  </div>
);

const RequireAuth = ({ children }: RequireAuthProps) => {
  const { authUser, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (!authUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
};

// Módulos desligados em FEATURES redirecionam para o início do inbox
const FeatureGate = ({
  feature,
  children,
}: {
  feature: FeatureKey;
  children: ReactNode;
}) => (FEATURES[feature] ? <>{children}</> : <Navigate to="/inbox" replace />);

function RoutedApp() {
  const location = useLocation();
  
  // Otimizado: Evita exibir o Header em qualquer rota de autenticação/recuperação
  const authRoutes = ["/login", "/forgot-password", "/auth/callback", "/auth/set-password"];
  const showHeader = !authRoutes.includes(location.pathname);
  const { loading } = useAuth();

  // Garante que o loading não trave a tela se o usuário estiver nas telas públicas de auth
  if (loading && showHeader) {
    return <AuthLoadingScreen />;
  }

  return (
    <>
      {showHeader && <Header />}
      <main
        className={
          showHeader
            ? "pt-16 h-screen box-border overflow-hidden"
            : "min-h-screen"
        }
      >
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/auth/set-password" element={<SetPassword />} />
          
          <Route
            path="/inbox"
            element={
              <RequireAuth>
                <Inbox />
              </RequireAuth>
            }
          >
            <Route index element={<InboxAnalyticsDashboard />} />
            <Route path="chat/:id" element={<Chat />} />
            <Route path="tags" element={<Tags />} />
            <Route path="departments" element={<DepartmentsPage />} />
            <Route path="attendants" element={<AttendantsPage />} />
            <Route path="quick-messages" element={<QuickMessagesPage />} />
            <Route
              path="marketing-campaigns"
              element={
                <FeatureGate feature="marketingCampaigns">
                  <MarketingCampaignsPage />
                </FeatureGate>
              }
            />
            
            <Route
              path="mass-messages"
              element={
                <FeatureGate feature="massMessages">
                  <MassMessagesPage />
                </FeatureGate>
              }
            />

            <Route
              path="settings/integrations/meta"
              element={<MetaIntegrationsPage />}
            />
            <Route
              path="settings/integrations/meta/callback"
              element={<MetaCallbackPage />}
            />
            <Route
              path="settings/automations/conversations"
              element={<ConversationAutomationSettingsPage />}
            />
            <Route path="bots" element={<BotsSettingsPage />} />
            <Route path="bots/new" element={<BotEditorPage mode="new" />} />
            <Route path="bots/edit" element={<BotEditorPage mode="edit" />} />
            <Route
              path="settings"
              element={
                <Navigate
                  to="/inbox/settings/automations/conversations"
                  replace
                />
              }
            />
          </Route>
          <Route
            path="/contacts"
            element={
              <RequireAuth>
                <ContactsPage />
              </RequireAuth>
            }
          />
          <Route path="/" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>
    </>
  );
}

export function App() {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AuthProvider>
          <ClinicProvider>
            <ToastContainer position="top-right" autoClose={3000} />
            <RoutedApp />
          </ClinicProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
