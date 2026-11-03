// Em qual ambiente o app está rodando, a partir do banco que ele usa.
// O que importa é de quem são os dados: só o projeto da produção tem
// clientes reais. Develop, previews da Vercel e a máquina local são testes.

/** Ref do projeto Supabase da produção (sa-east-1) */
export const PRODUCTION_SUPABASE_REF = "karmtrldanuxqisgzlhk";

export type AppEnvironment = "production" | "develop" | "local";

export function detectEnvironment(supabaseUrl: string | undefined): AppEnvironment {
  const url = supabaseUrl ?? "";
  if (url.includes(`${PRODUCTION_SUPABASE_REF}.supabase.co`)) return "production";
  if (/\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:|\/|$)/.test(url)) {
    return "local";
  }
  return "develop";
}

export const APP_ENVIRONMENT = detectEnvironment(
  import.meta.env.VITE_SUPABASE_URL,
);

export const IS_PRODUCTION = APP_ENVIRONMENT === "production";
