import React from "react";
import { MessageSquareTextIcon } from "lucide-react";
import type { QuickMessage } from "../../services/quickMessages";

type QuickMessagesPickerProps = {
  open: boolean;
  loading: boolean;
  quickMessages: QuickMessage[];
  onClose: () => void;
  onSelect: (message: string) => void;
  contentRef?: React.RefObject<HTMLDivElement>;
};

export const QuickMessagesPicker: React.FC<QuickMessagesPickerProps> = ({
  open,
  loading,
  quickMessages,
  onClose,
  onSelect,
  contentRef,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        ref={contentRef}
        className="absolute left-1/2 top-1/2 flex max-h-[90dvh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Mensagens rápidas
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Escolha uma mensagem para preencher o campo de envio.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 max-h-[360px] flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="space-y-3 p-2">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-20 animate-pulse rounded-2xl bg-slate-100"
                />
              ))}
            </div>
          ) : quickMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <MessageSquareTextIcon className="h-6 w-6 text-slate-500" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-800">
                Nenhuma mensagem rápida cadastrada
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Cadastre mensagens na área administrativa para usar aqui.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {quickMessages.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelect(item.message);
                    onClose();
                  }}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-left text-sm text-slate-700 transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <span className="line-clamp-4 whitespace-pre-wrap">
                    {item.message}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
