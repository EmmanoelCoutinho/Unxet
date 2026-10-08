import { supabase } from "./supabaseClient";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as
  | string
  | undefined;

export type PushStatus =
  | "unsupported" // navegador sem Web Push, ambiente de dev ou chave VAPID ausente
  | "needs-install" // iPhone/iPad: push só funciona com o app na tela de início
  | "denied" // usuário bloqueou as notificações no navegador
  | "disabled"
  | "enabled";

export function isIos() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS se apresenta como Mac
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function getRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function getPushStatus(): Promise<PushStatus> {
  if (isIos() && !isStandalone()) return "needs-install";

  if (
    !VAPID_PUBLIC_KEY ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }

  const registration = await getRegistration();
  if (!registration) return "unsupported";

  if (Notification.permission === "denied") return "denied";

  const subscription = await registration.pushManager.getSubscription();
  return subscription && Notification.permission === "granted"
    ? "enabled"
    : "disabled";
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function saveSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth: json.keys?.auth ?? "",
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

/** Pede permissão (precisa vir de um clique) e inscreve este aparelho. */
export async function enablePush(): Promise<PushStatus> {
  const registration = await getRegistration();
  if (!registration || !VAPID_PUBLIC_KEY) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "disabled";

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  await saveSubscription(subscription);
  return "enabled";
}

/** Remove a inscrição deste aparelho (no servidor e no navegador). */
export async function disablePush() {
  const registration = await getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  await supabase.rpc("unregister_push_subscription", {
    p_endpoint: subscription.endpoint,
  });
  await subscription.unsubscribe();
}

/**
 * Reenvia a inscrição existente ao servidor. Chamado a cada login para
 * recuperar inscrições apagadas e manter as chaves atualizadas.
 */
export async function syncPushSubscription() {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  const registration = await getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await saveSubscription(subscription);
}

/** Número de conversas não lidas no ícone do app (Android/iOS/desktop). */
export function setAppBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  const result = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.();
  // Sem suporte ou sem permissão: o badge é só um extra, ignora o erro.
  result?.catch(() => undefined);
}
