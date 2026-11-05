import React from "react";
import { XIcon } from "lucide-react";

type CloseButtonProps = {
  onClick: () => void;
  className?: string;
  label?: string;
};

/** Botão "X" padrão para fechar modais, no canto do cabeçalho. */
export const CloseButton: React.FC<CloseButtonProps> = ({
  onClick,
  className = "",
  label = "Fechar",
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 ${className}`}
  >
    <XIcon className="h-5 w-5" />
  </button>
);
