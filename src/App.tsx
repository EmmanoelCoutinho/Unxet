import React, { ReactNode, Suspense, lazy } from "react";
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
import { MaintenanceBanner } from "./components/layout/MaintenanceBanner";
import { PushNotificationsBridge } from "./components/PushNotificationsBridge";
import { PresenceHeartbeat } from "./components/PresenceHeartbeat";
import { InternalChatBridge } from "./components/InternalChatBridge";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { ConfirmDialogProvider } from "./components/ui/ConfirmDialog";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { InboxEmpty } from "./pages/InboxEmpty";
import { ClinicProvider, useClinic } from "./contexts/ClinicContext";
import { AuthCallback } from "./pages/Callback";
import { SetPassword } from "./pages/SetPassword";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { FEATURES, type FeatureKey } from "./constants/features";

// Telas fora do atendimento do dia a dia são baixadas só quando abertas
const InboxAnalyticsDashboard = lazy(() =>
  import("./pages/InboxAnalyticsDashboard").then((m) => ({
    default: m.InboxAnalyticsDashboard,
  })),
);
const Tags = lazy(() =>
  import("./pages/Tags").then((m) => ({ default: m.Tags })),
);
const DepartmentsPage = lazy(() =>
  import("./pages/DepartmentsPage").then((m) => ({
    default: m.DepartmentsPage,
  })),
);
const AttendantsPage = lazy(() =>
  import("./pages/AttendantsPage").then((m) => ({ default: m.AttendantsPage })),
);
const MetaIntegrationsPage = lazy(() =>
  import("./pages/IntegrationsMetaPage").then((m) => ({
    default: m.MetaIntegrationsPage,
  })),
);
const MetaCallbackPage = lazy(() =>
  import("./pages/IntegrationCallbackPage").then((m) => ({
    default: m.MetaCallbackPage,
  })),
);
const ConversationAutomationSettingsPage = lazy(() =>
  import("./pages/ConversationAutomationSettingsPage").then((m) => ({
    default: m.ConversationAutomationSettingsPage,
  })),
);
const BotsSettingsPage = lazy(() =>
  import("./pages/BotsSettingsPage").then((m) => ({
    default: m.BotsSettingsPage,
  })),
);
const BotEditorPage = lazy(() =>
  import("./pages/BotEditorPage").then((m) => ({ default: m.BotEditorPage })),
);
const QuickMessagesPage = lazy(() =>
  import("./pages/QuickMessagesPage").then((m) => ({
    default: m.QuickMessagesPage,
  })),
);
const MarketingCampaignsPage = lazy(() =>
  import("./pages/MarketingCampaignsPage").then((m) => ({
    default: m.MarketingCampaignsPage,
  })),
);
const ContactsPage = lazy(() =>
  import("./pages/Contacts").then((m) => ({ default: m.ContactsPage })),
);
const InternalChatPage = lazy(() =>
  import("./pages/InternalChat").then((m) => ({
    default: m.InternalChatPage,
  })),
);
const MassMessagesPage = lazy(() =>
  import("./pages/MassMessages").then((m) => ({
    default: m.MassMessagesPage,
  })),
);

const ScheduledMessagesPage = lazy(() =>
  import("./pages/ScheduledMessages").then((m) => ({
    default: m.ScheduledMessagesPage,
  })),
);
const ScheduledMessageEditorPage = lazy(() =>
  import("./pages/ScheduledMessageEditor").then((m) => ({
    default: m.ScheduledMessageEditorPage,
  })),
);

// Painel da Unxet: login e sessão próprios, fora do app das empresas
const AdminApp = lazy(() =>
  import("./modules/admin/AdminApp").then((m) => ({ default: m.AdminApp })),
);

type RequireAuthProps = {
  children: ReactNode;
};

const AuthLoadingScreen = () => (
  <div className="min-h-dvh w-full flex items-center justify-center bg-white">
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

const PageLoading = () => (
  <div className="flex h-full min-h-[40dvh] w-full items-center justify-center">
    <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
  </div>
);

// Telas de gestão: atendente é mandado de volta para os atendimentos
const AdminOnly = ({ children }: { children: ReactNode }) => {
  const { membership, loading } = useClinic();

  if (loading) return <PageLoading />;
  if (membership?.role !== "admin") return <Navigate to="/inbox" replace />;

  return <>{children}</>;
};

// Ao lado da lista de conversas: painel para o admin, tela neutra para o atendente
const InboxHome = () => {
  const { membership, loading } = useClinic();

  if (loading) return <PageLoading />;
  return membership?.role === "admin" ? (
    <InboxAnalyticsDashboard />
  ) : (
    <InboxEmpty />
  );
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
      <PushNotificationsBridge />
      <PresenceHeartbeat />
      <InternalChatBridge />
      {showHeader && <Header />}
      <main
        className={
          showHeader
            ? "pt-16 h-dvh box-border overflow-hidden flex flex-col"
            : "min-h-screen"
        }
      >
        {showHeader && <MaintenanceBanner />}
        <div className={showHeader ? "min-h-0 flex-1" : undefined}>
        <AppErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<PageLoading />}>
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
            <Route index element={<InboxHome />} />
            {/* No celular o índice mostra a lista de conversas; o painel fica aqui */}
            <Route
              path="dashboard"
              element={
                <AdminOnly>
                  <InboxAnalyticsDashboard />
                </AdminOnly>
              }
            />
            <Route path="chat/:id" element={<Chat />} />
            <Route path="team" element={<InternalChatPage />} />
            <Route path="team/:threadId" element={<InternalChatPage />} />
            <Route path="tags" element={<Tags />} />
            <Route path="departments" element={<AdminOnly><DepartmentsPage /></AdminOnly>} />
            <Route path="attendants" element={<AdminOnly><AttendantsPage /></AdminOnly>} />
            <Route path="quick-messages" element={<QuickMessagesPage />} />
            <Route path="scheduled-messages" element={<ScheduledMessagesPage />} />
            <Route path="scheduled-messages/new" element={<ScheduledMessageEditorPage />} />
            <Route path="scheduled-messages/:id" element={<ScheduledMessageEditorPage />} />
            <Route
              path="marketing-campaigns"
              element={
                <FeatureGate feature="marketingCampaigns">
                  <AdminOnly>
                    <MarketingCampaignsPage />
                  </AdminOnly>
                </FeatureGate>
              }
            />
            
            <Route
              path="mass-messages"
              element={
                <FeatureGate feature="massMessages">
                  <AdminOnly>
                    <MassMessagesPage />
                  </AdminOnly>
                </FeatureGate>
              }
            />

            <Route
              path="settings/integrations/meta"
              element={<AdminOnly><MetaIntegrationsPage /></AdminOnly>}
            />
            <Route
              path="settings/integrations/meta/callback"
              element={<AdminOnly><MetaCallbackPage /></AdminOnly>}
            />
            <Route
              path="settings/automations/conversations"
              element={<AdminOnly><ConversationAutomationSettingsPage /></AdminOnly>}
            />
            <Route path="bots" element={<AdminOnly><BotsSettingsPage /></AdminOnly>} />
            <Route path="bots/new" element={<AdminOnly><BotEditorPage mode="new" /></AdminOnly>} />
            <Route
              path="bots/edit/:botId?"
              element={<AdminOnly><BotEditorPage mode="edit" /></AdminOnly>}
            />
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
                <AdminOnly>
                  <ContactsPage />
                </AdminOnly>
              </RequireAuth>
            }
          />
          <Route path="/" element={<Navigate to="/login" replace />} />
          {/* Endereço desconhecido: volta para o início (o login cuida de quem não está logado) */}
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Routes>
        </Suspense>
        </AppErrorBoundary>
        </div>
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
      <ConfirmDialogProvider>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <ToastContainer position="top-right" autoClose={3000} />
          <Routes>
            <Route
              path="/admin/*"
              element={
                <Suspense fallback={<PageLoading />}>
                  <AdminApp />
                </Suspense>
              }
            />
            <Route
              path="*"
              element={
                <AuthProvider>
                  <ClinicProvider>
                    <RoutedApp />
                  </ClinicProvider>
                </AuthProvider>
              }
            />
          </Routes>
        </BrowserRouter>
      </ConfirmDialogProvider>
    </QueryClientProvider>
  );
}
