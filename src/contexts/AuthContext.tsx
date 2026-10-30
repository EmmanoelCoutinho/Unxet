"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  AuthError,
  User,
  isAuthApiError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import { toast } from "react-toastify";
import { supabase } from "../lib/supabaseClient";
import { disablePush, keepOnlyThisDevicePush } from "../lib/pushNotifications";
import { getAuthCallbackUrl } from "../lib/appUrl";

export type ClinicUser = {
  id: string;
  user_id: string;
  clinic_id: string;
  role: string;
  name: string;
  created_at: string;
};

type AuthContextType = {
  authUser: User | null;
  profile: ClinicUser | null;
  loading: boolean; // ✅ apenas bootstrap de sessão
  signInWithEmail: (email: string, password: string) => Promise<{ error: any }>;
  // 1. ADICIONADO A TIPAGEM DO NOVO MÉTODO
  sendPasswordResetEmail: (email: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  // Recarrega o perfil (clinic_users) do usuário logado, ignorando o cache
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_PROFILE_KEY = "medflow.auth.profile.v1";

// cache do profile com metadados (pra validar se é do mesmo user)
type StoredProfile = {
  userId: string;
  savedAt: number;
  profile: ClinicUser;
};

// TTL opcional (se quiser sempre usar cache “fresco”)
const PROFILE_TTL_MS = 10 * 60 * 1000; // 10 min (ajuste ou coloque 0 para “infinito”)

// Conferência periódica da sessão com o servidor (ver verifySession)
const SESSION_CHECK_INTERVAL_MS = 60 * 1000;
const SESSION_CHECK_MIN_GAP_MS = 10 * 1000;

// Erro de rede não conta: só desloga quando o servidor recusa a sessão/usuário
const isSessionRevokedError = (error: AuthError) =>
  isAuthSessionMissingError(error) ||
  (isAuthApiError(error) && (error.status === 401 || error.status === 403));

const sessionChannelName = (userId: string) => `user-session:${userId}`;

// Por que a sessão caiu, quando o aviso pelo canal informa
type RevokeReason = "other_device";

const revokedMessage = (reason: RevokeReason | null) =>
  reason === "other_device"
    ? "Sua conta entrou em outro aparelho, por isso esta sessão foi encerrada."
    : "Sua sessão foi encerrada. Entre novamente.";

// Encerra as outras sessões da conta e avisa esses aparelhos na hora. Falha
// aqui não impede o login: a conferência periódica dos outros aparelhos
// (ver verifySession) é que garante o logout deles.
const endOtherSessions = async (userId: string) => {
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    console.error("Erro ao encerrar as outras sessões:", error);
    return;
  }

  // Os aparelhos deslogados também param de receber notificações
  await keepOnlyThisDevicePush().catch((e) => {
    console.error("Erro ao remover o push dos outros aparelhos:", e);
  });

  const channel = supabase.channel(sessionChannelName(userId));
  try {
    await channel.httpSend("revoked", { reason: "other_device" });
  } catch (e) {
    console.error("Erro ao avisar os outros aparelhos:", e);
  } finally {
    supabase.removeChannel(channel);
  }
};

const readStorage =<T,>(key: string): T | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  try {
    if (value === null || value === undefined) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUserState] = useState<User | null>(null);

  // O Supabase reemite a sessão ao voltar para a aba (e ao renovar o token)
  // com um objeto novo do mesmo usuário. Manter a referência evita que tudo
  // que depende de authUser recarregue a tela sem necessidade.
  const setAuthUser = (next: User | null) => {
    setAuthUserState((prev) => (prev?.id === next?.id ? prev : next));
  };

  const [profile, setProfile] = useState<ClinicUser | null>(() => {
    const cached = readStorage<StoredProfile>(STORAGE_PROFILE_KEY);
    return cached?.profile ?? null;
  });

  const [loading, setLoading] = useState(true);

  const mountedRef = useRef(true);

  const refreshProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from("clinic_users")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (!mountedRef.current) return;

    if (error) {
      console.error("Erro ao carregar clinic_users:", error);
      if (!profile) {
        setProfile(null);
        writeStorage(STORAGE_PROFILE_KEY, null);
      }
      return;
    }

    setProfile(data);
    const payload: StoredProfile = {
      userId,
      savedAt: Date.now(),
      profile: data,
    };
    writeStorage(STORAGE_PROFILE_KEY, payload);
  };

  const shouldUseCachedProfile = (userId: string) => {
    const cached = readStorage<StoredProfile>(STORAGE_PROFILE_KEY);
    if (!cached) return false;
    if (cached.userId !== userId) return false;
    if (!PROFILE_TTL_MS) return true;
    return Date.now() - cached.savedAt <= PROFILE_TTL_MS;
  };

  // ✅ Bootstrap da sessão (não depende de profile)
  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (!mountedRef.current) return;

        const sessionUser = data.session?.user ?? null;
        setAuthUser(sessionUser);

        if (!sessionUser) {
          setProfile(null);
          writeStorage(STORAGE_PROFILE_KEY, null);
          return;
        }

        if (shouldUseCachedProfile(sessionUser.id)) {
          const cached = readStorage<StoredProfile>(STORAGE_PROFILE_KEY);
          if (cached?.profile) setProfile(cached.profile);
        } else {
          refreshProfile(sessionUser.id);
        }
      } catch (e) {
        console.error("Erro ao inicializar sessão:", e);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        const sessionUser = newSession?.user ?? null;
        setAuthUser(sessionUser);

        if (!sessionUser) {
          setProfile(null);
          writeStorage(STORAGE_PROFILE_KEY, null);
          return;
        }

        if (!shouldUseCachedProfile(sessionUser.id)) {
          refreshProfile(sessionUser.id);
        } else {
          const cached = readStorage<StoredProfile>(STORAGE_PROFILE_KEY);
          if (cached?.profile) setProfile(cached.profile);
        }
      }
    );

    return () => {
      mountedRef.current = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Conta excluída ou login em outro aparelho: o token salvo aqui segue válido
  // até expirar, mas a sessão já não existe no servidor. Confere com o servidor
  // e, se a sessão foi encerrada, desloga este aparelho.
  const authUserId = authUser?.id ?? null;
  useEffect(() => {
    if (!authUserId) return;

    let active = true;
    let checking = false;
    let lastCheckAt = 0;
    let revokeReason: RevokeReason | null = null;

    const verifySession = async (force = false) => {
      if (checking) return;
      if (!force && Date.now() - lastCheckAt < SESSION_CHECK_MIN_GAP_MS) return;
      checking = true;
      lastCheckAt = Date.now();

      try {
        const { error } = await supabase.auth.getUser();
        if (!active || !error || !isSessionRevokedError(error)) return;

        // A sessão não existe mais no servidor: limpa só este aparelho
        await supabase.auth.signOut({ scope: "local" });
        if (!mountedRef.current) return;
        setAuthUser(null);
        setProfile(null);
        writeStorage(STORAGE_PROFILE_KEY, null);
        toast.error(revokedMessage(revokeReason), {
          toastId: "session-revoked",
        });
      } finally {
        checking = false;
      }
    };

    verifySession(true);

    const onVisible = () => {
      if (document.visibilityState === "visible") verifySession();
    };
    const onFocus = () => verifySession();
    const interval = setInterval(onVisible, SESSION_CHECK_INTERVAL_MS);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);

    // Aviso imediato da edge function delete-attendant e do login em outro
    // aparelho. O aviso só dispara a conferência: quem decide o logout é o
    // servidor de autenticação (então um aviso falso não derruba ninguém).
    const channel = supabase
      .channel(sessionChannelName(authUserId))
      .on("broadcast", { event: "revoked" }, ({ payload }) => {
        revokeReason = payload?.reason === "other_device" ? "other_device" : null;
        verifySession(true);
      })
      .subscribe();

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      supabase.removeChannel(channel);
    };
  }, [authUserId]);

  const signInWithEmail = async (email: string, password: string) => {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setLoading(false);
      return { error };
    }

    const user = data.user ?? null;

    // Uma conta, um aparelho: o login novo encerra as sessões anteriores, para
    // que várias pessoas não usem a mesma conta ao mesmo tempo
    if (user) await endOtherSessions(user.id);

    setAuthUser(user);
    setLoading(false);

    if (user) {
      if (!shouldUseCachedProfile(user.id)) {
        refreshProfile(user.id);
      } else {
        const cached = readStorage<StoredProfile>(STORAGE_PROFILE_KEY);
        if (cached?.profile) setProfile(cached.profile);
      }
    } else {
      setProfile(null);
      writeStorage(STORAGE_PROFILE_KEY, null);
    }

    return { error: null };
  };

  // 2. ADICIONADA A IMPLEMENTAÇÃO DO MÉTODO DO SUPABASE
  const sendPasswordResetEmail = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // O Supabase enviará o token para o seu fluxo de callback já existente (/auth/callback)
      // que depois redirecionará o usuário logado para redefinir a senha
      redirectTo: getAuthCallbackUrl(),
    });
    return { error };
  };

  const signOut = async () => {
    setLoading(true);
    // Para de notificar este aparelho antes de perder a sessão (a RPC exige login)
    await disablePush().catch((error) => {
      console.error("Erro ao desativar notificações no logout:", error);
    });
    // Só este aparelho: sem "local" o Supabase encerra a sessão em todos, e os
    // outros aparelhos caíam no aviso de sessão encerrada
    await supabase.auth.signOut({ scope: "local" });
    setAuthUser(null);
    setProfile(null);
    writeStorage(STORAGE_PROFILE_KEY, null);
    setLoading(false);
  };

  // 3. INCLUÍDO O NOVO MÉTODO NO USEMEMO E NO RETORNO DO PROVIDER
  const reloadProfile = async () => {
    if (authUser?.id) await refreshProfile(authUser.id);
  };

  const value = useMemo(
    () => ({
      authUser,
      profile,
      loading,
      signInWithEmail,
      sendPasswordResetEmail,
      signOut,
      refreshProfile: reloadProfile,
    }),
    [authUser, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider />");
  return ctx;
}