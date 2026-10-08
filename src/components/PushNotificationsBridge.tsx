import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { syncPushSubscription } from "../lib/pushNotifications";

/**
 * Liga o app ao service worker: abre a conversa quando o usuário toca numa
 * notificação e reenvia a inscrição do aparelho a cada login.
 */
export function PushNotificationsBridge() {
  const navigate = useNavigate();
  const { authUser } = useAuth();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const url = event.data?.type === "open-url" ? event.data.url : null;
      if (typeof url === "string" && url.startsWith("/")) navigate(url);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);

  useEffect(() => {
    if (!authUser?.id) return;
    syncPushSubscription().catch((error) => {
      console.error("Erro ao sincronizar notificações push:", error);
    });
  }, [authUser?.id]);

  return null;
}
