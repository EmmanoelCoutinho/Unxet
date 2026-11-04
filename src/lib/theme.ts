import { useEffect, useState } from "react";

// Tema do sistema. A escolha fica salva neste aparelho; "system" segue o
// modo claro/escuro do celular ou do computador.
// O index.html aplica o tema salvo antes do React carregar, para a tela não
// piscar em branco: mantenha a mesma chave e as mesmas cores de lá.

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "unxet-theme";

const THEME_COLORS = { light: "#ffffff", dark: "#151d2c" };

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // navegação privada ou armazenamento bloqueado
  }
  return "system";
}

export function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") return media().matches ? "dark" : "light";
  return pref;
}

export function applyTheme(pref: ThemePreference) {
  const theme = resolveTheme(pref);
  document.documentElement.classList.toggle("dark", theme === "dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

const listeners = new Set<(pref: ThemePreference) => void>();

export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // segue só nesta aba
  }
  applyTheme(pref);
  listeners.forEach((fn) => fn(pref));
}

export function useThemePreference() {
  const [pref, setPref] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    listeners.add(setPref);
    return () => {
      listeners.delete(setPref);
    };
  }, []);

  // No automático, acompanha quando o aparelho troca de modo
  useEffect(() => {
    if (pref !== "system") return;
    const mq = media();
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  // Outra aba mudou o tema
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next = readThemePreference();
      applyTheme(next);
      setPref(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return [pref, setThemePreference] as const;
}
