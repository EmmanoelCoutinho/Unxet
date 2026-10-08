import React, { useState } from "react";
import { BellIcon, XIcon } from "lucide-react";
import { toast } from "react-toastify";
import { usePushNotifications } from "../../hooks/usePushNotifications";

const DISMISSED_KEY = "unxet:push-prompt-dismissed";

function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Aviso no topo da lista de conversas para o atendente ativar as
 * notificações neste aparelho (ou instalar o app, no iPhone).
 */
export const PushNotificationsPrompt: React.FC = () => {
  const { status, busy, enable } = usePushNotifications();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed || (status !== "disabled" && status !== "needs-install")) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Sem storage o aviso só volta no próximo carregamento.
    }
  };

  const handleEnable = async () => {
    try {
      const next = await enable();
      if (next === "enabled") toast.success("Notificações ativadas.");
      if (next === "denied") {
        toast.info(
          "As notificações foram bloqueadas. Dá para liberar depois nas configurações do navegador."
        );
      }
    } catch (error) {
      console.error("Erro ao ativar notificações:", error);
      toast.error("Não foi possível ativar as notificações.");
    }
  };

  return (
    <div className="mb-3 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
      <BellIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
      <div className="min-w-0 flex-1">
        {status === "needs-install" ? (
          <p>
            Para receber notificações no iPhone, instale o app: toque em{" "}
            <strong>Compartilhar</strong> e depois em{" "}
            <strong>Adicionar à Tela de Início</strong>.
          </p>
        ) : (
          <>
            <p>Seja avisado de novas mensagens mesmo com o app fechado.</p>
            <button
              type="button"
              onClick={handleEnable}
              disabled={busy}
              className="mt-2 rounded-md bg-[#0A84FF] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:opacity-60"
            >
              {busy ? "Ativando…" : "Ativar notificações"}
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="flex-shrink-0 rounded p-0.5 text-blue-700 transition hover:bg-blue-100"
        aria-label="Dispensar aviso"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
};
