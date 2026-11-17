import { ArrowRightLeftIcon, XIcon } from "lucide-react";
import { toast } from "react-toastify";
import type { UserNotification } from "./useNotifications";

export const TRANSFER_KIND = "conversation_transferred";

const AUTO_CLOSE_MS = 12000;

type Props = {
  notification: UserNotification;
  onOpen: () => void;
  closeToast?: () => void;
};

const TransferToastCard = ({ notification, onOpen, closeToast }: Props) => (
  <div className="mx-3 mt-3 w-auto overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 sm:mx-0 sm:mt-0 sm:w-96">
    <div className="flex items-start gap-3 p-4">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-sm">
        <ArrowRightLeftIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-semibold leading-5 text-gray-900">{notification.title}</p>
        {notification.body ? (
          <p className="mt-1 text-[13px] leading-5 text-gray-600">{notification.body}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={closeToast}
        className="-mr-1 -mt-1 rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
        aria-label="Fechar aviso"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
    {notification.url ? (
      <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 px-4 py-2.5">
        <button
          type="button"
          onClick={closeToast}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-200/60 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
        >
          Agora não
        </button>
        <button
          type="button"
          onClick={() => {
            onOpen();
            closeToast?.();
          }}
          className="rounded-lg bg-[#0A84FF] px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#0070E0] focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:ring-offset-1"
        >
          Abrir conversa
        </button>
      </div>
    ) : null}
  </div>
);

/**
 * Aviso no canto da tela quando uma conversa é transferida para a pessoa.
 * O cartão é todo nosso: a "casca" do react-toastify fica transparente, sem
 * barra de progresso nem X próprios. Fica mais tempo que os toasts comuns e
 * pausa com o mouse em cima; o id do aviso evita mostrar o mesmo duas vezes.
 */
export const showTransferToast = (notification: UserNotification, onOpen: () => void) => {
  toast(
    ({ closeToast }) => (
      <TransferToastCard notification={notification} onOpen={onOpen} closeToast={closeToast} />
    ),
    {
      toastId: `transfer:${notification.id}`,
      autoClose: AUTO_CLOSE_MS,
      pauseOnHover: true,
      pauseOnFocusLoss: true,
      closeOnClick: false,
      draggable: false,
      hideProgressBar: true,
      closeButton: false,
      icon: false,
      className: "!m-0 !mb-3 !min-h-0 !overflow-visible !rounded-none !bg-transparent !p-0 !shadow-none",
    },
  );
};
