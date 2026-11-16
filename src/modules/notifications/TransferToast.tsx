import { ArrowRightLeftIcon } from "lucide-react";
import { toast } from "react-toastify";
import type { UserNotification } from "./useNotifications";

export const TRANSFER_KIND = "conversation_transferred";

type Props = {
  notification: UserNotification;
  onOpen: () => void;
  closeToast?: () => void;
};

const TransferToastContent = ({ notification, onOpen, closeToast }: Props) => (
  <div className="flex gap-3">
    <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#0A84FF]">
      <ArrowRightLeftIcon className="h-4 w-4" />
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold leading-snug text-gray-900">{notification.title}</p>
      {notification.body ? (
        <p className="mt-0.5 text-xs leading-snug text-gray-600">{notification.body}</p>
      ) : null}
      {notification.url ? (
        <button
          type="button"
          onClick={() => {
            onOpen();
            closeToast?.();
          }}
          className="mt-2 rounded-md bg-[#0A84FF] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#0A84FF]/90 focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:ring-offset-1"
        >
          Abrir conversa
        </button>
      ) : null}
    </div>
  </div>
);

/**
 * Aviso no canto da tela quando uma conversa é transferida para a pessoa.
 * Fica mais tempo que os toasts comuns e pausa com o mouse em cima; o id do
 * aviso evita mostrar o mesmo duas vezes.
 */
export const showTransferToast = (notification: UserNotification, onOpen: () => void) => {
  toast(
    ({ closeToast }) => (
      <TransferToastContent notification={notification} onOpen={onOpen} closeToast={closeToast} />
    ),
    {
      toastId: `transfer:${notification.id}`,
      autoClose: 12000,
      pauseOnHover: true,
      pauseOnFocusLoss: true,
      closeOnClick: false,
      icon: false,
      className: "!border-l-4 !border-[#0A84FF]",
    },
  );
};
