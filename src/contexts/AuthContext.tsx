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
import { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { disablePush } from "../lib/pushNotifications";
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

const readStorage = <T,>(key: string): T | null => {
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
  const [authUser, setAuthUser] = useState<User | null>(null);

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
    await supabase.auth.signOut();
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