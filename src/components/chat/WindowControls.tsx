import React from "react";
import { Maximize2Icon, MinusIcon, XIcon } from "lucide-react";

export type WindowControlsProps = {
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
};

const buttonClass =
  "flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800";

/** Botões da caixa flutuante: minimizar, abrir em tela cheia e fechar. */
export const WindowControls: React.FC<WindowControlsProps> = ({
  onMinimize,
  onMaximize,
  onClose,
}) => (
  <div className="flex flex-shrink-0 items-center">
    <button
      type="button"
      onClick={onMinimize}
      className={buttonClass}
      aria-label="Minimizar"
      title="Minimizar"
    >
      <MinusIcon className="h-4 w-4" />
    </button>
    <button
      type="button"
      onClick={onMaximize}
      className={buttonClass}
      aria-label="Abrir em tela cheia"
      title="Abrir em tela cheia"
    >
      <Maximize2Icon className="h-4 w-4" />
    </button>
    <button
      type="button"
      onClick={onClose}
      className={buttonClass}
      aria-label="Fechar"
      title="Fechar"
    >
      <XIcon className="h-4 w-4" />
    </button>
  </div>
);
