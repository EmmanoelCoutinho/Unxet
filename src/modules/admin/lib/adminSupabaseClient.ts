import { createClient } from "@supabase/supabase-js";

// Cliente exclusivo do painel da Unxet (/admin). A sessão fica em outra chave
// do navegador: entrar ou sair do painel não mexe no login do app das empresas.
export const adminSupabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_CLIENT_KEY as string,
  {
    auth: {
      storageKey: "unxet.admin.auth",
      // Links de e-mail (convite, redefinição) pertencem ao app das empresas
      detectSessionInUrl: false,
    },
  },
);
