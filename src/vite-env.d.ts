/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_CLIENT_KEY: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  /** Origem dos vídeos dos tutoriais (padrão: bucket tutorials do VITE_SUPABASE_URL) */
  readonly VITE_TUTORIALS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
