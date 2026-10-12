import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { adminSupabase } from "../lib/adminSupabaseClient";

type AdminAuthContextType = {
  adminUser: User | null;
  loading: boolean; // bootstrap da sessão
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: { code?: string; message?: string } | null }>;
  signOut: () => Promise<void>;
};

export const NOT_PLATFORM_ADMIN = "not_platform_admin";

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(
  undefined,
);

// A regra de verdade está no servidor (RLS + edge functions); aqui só decidimos
// se mostramos o painel.
const isPlatformAdmin = async (userId: string) => {
  const { data, error } = await adminSupabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
};

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const init = async () => {
      try {
        const { data } = await adminSupabase.auth.getSession();
        const sessionUser = data.session?.user ?? null;
        if (!sessionUser) return;

        if (await isPlatformAdmin(sessionUser.id)) {
          if (active) setAdminUser(sessionUser);
        } else {
          await adminSupabase.auth.signOut({ scope: "local" });
        }
      } catch (e) {
        console.error("Erro ao inicializar sessão do painel:", e);
      } finally {
        if (active) setLoading(false);
      }
    };

    init();

    const { data: listener } = adminSupabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setAdminUser(null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await adminSupabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return { error };

    try {
      if (data.user && (await isPlatformAdmin(data.user.id))) {
        setAdminUser(data.user);
        return { error: null };
      }
    } catch (e: any) {
      await adminSupabase.auth.signOut({ scope: "local" });
      return { error: { message: e?.message } };
    }

    // Conta válida, mas não é da equipe da Unxet
    await adminSupabase.auth.signOut({ scope: "local" });
    return { error: { code: NOT_PLATFORM_ADMIN } };
  }, []);

  const signOut = useCallback(async () => {
    await adminSupabase.auth.signOut({ scope: "local" });
    setAdminUser(null);
  }, []);

  const value = useMemo(
    () => ({ adminUser, loading, signIn, signOut }),
    [adminUser, loading, signIn, signOut],
  );

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth must be used inside <AdminAuthProvider />");
  }
  return ctx;
}
