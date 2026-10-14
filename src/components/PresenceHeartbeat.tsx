import { useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

// O painel da plataforma considera online quem deu sinal nos últimos 2 min
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_MIN_GAP_MS = 20 * 1000;

/**
 * Avisa o servidor, a cada minuto, que o usuário está com o app aberto.
 * Alimenta o "online agora" do painel administrativo da Unxet.
 */
export function PresenceHeartbeat() {
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;

  useEffect(() => {
    if (!userId) return;

    let lastSentAt = 0;

    const beat = (force = false) => {
      if (!navigator.onLine) return;
      if (!force && Date.now() - lastSentAt < HEARTBEAT_MIN_GAP_MS) return;
      lastSentAt = Date.now();
      supabase.rpc("touch_presence").then(({ error }) => {
        if (error) console.warn("Falha ao registrar presença:", error.message);
      });
    };

    beat(true);

    const interval = setInterval(() => beat(true), HEARTBEAT_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    const onFocus = () => beat();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [userId]);

  return null;
}
