import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, HelpCircle, Trash2 } from "lucide-react";
import { Button } from "./Button";

export type ConfirmTone = "danger" | "warning" | "default";

export type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

const toneStyles: Record<
  ConfirmTone,
  { icon: React.ElementType; iconWrap: string; button: string }
> = {
  danger: {
    icon: Trash2,
    iconWrap: "bg-red-50 text-red-600",
    button: "bg-red-500 hover:bg-red-600 focus:ring-red-500",
  },
  warning: {
    icon: AlertTriangle,
    iconWrap: "bg-amber-50 text-amber-600",
    button: "bg-amber-500 hover:bg-amber-600 focus:ring-amber-500",
  },
  default: {
    icon: HelpCircle,
    iconWrap: "bg-[#0A84FF]/10 text-[#0A84FF]",
    button: "",
  },
};

/**
 * Substitui o window.confirm nativo por um modal no padrão visual do sistema.
 * Uso: `const confirm = useConfirm(); if (!(await confirm({ title: "..." }))) return;`
 */
export const ConfirmDialogProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback<ConfirmFn>((opts) => {
    // Um novo pedido enquanto outro está aberto cancela o anterior
    resolverRef.current?.(false);
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const tone = toneStyles[options?.tone ?? "default"];
  const Icon = tone.icon;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) settle(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[10000] bg-black/40 backdrop-blur-sm" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[10000] max-h-[90dvh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl sm:p-6"
          >
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone.iconWrap}`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-semibold text-gray-900">
                  {options?.title}
                </Dialog.Title>
                {options?.description ? (
                  <Dialog.Description className="mt-2 text-sm text-gray-600">
                    {options.description}
                  </Dialog.Description>
                ) : (
                  <Dialog.Description className="sr-only">
                    {options?.title}
                  </Dialog.Description>
                )}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => settle(false)}>
                {options?.cancelLabel ?? "Cancelar"}
              </Button>
              <Button
                type="button"
                variant="primary"
                className={tone.button}
                onClick={() => settle(true)}
                autoFocus
              >
                {options?.confirmLabel ?? "Confirmar"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  );
};

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm deve ser usado dentro de ConfirmDialogProvider");
  }
  return ctx;
};
