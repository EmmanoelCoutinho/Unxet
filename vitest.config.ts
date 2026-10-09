import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "supabase/functions/**/*.test.ts"],
    // Variáveis lidas por import.meta.env nos módulos testados
    env: {
      VITE_SUPABASE_URL: "https://test-project.supabase.co",
      VITE_SUPABASE_CLIENT_KEY: "test-publishable-key",
    },
    restoreMocks: true,
  },
});
