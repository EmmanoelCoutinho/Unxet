import React, { useEffect, useRef } from "react";
import { MessageSquareTextIcon } from "lucide-react";
import type { QuickMessage } from "../../services/quickMessages";

type QuickMessageSlashMenuProps = {
  items: QuickMessage[];
  loading: boolean;
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (item: QuickMessage) => void;
};

export const QuickMessageSlashMenu: React.FC<QuickMessageSlashMenuProps> = ({
  items,
  loading,
  activeIndex,
  onHover,
  onSelect,
}) => {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      role="listbox"
      aria-label="Mensagens rápidas"
      // Clicar no menu não tira o foco do campo de texto
      onMouseDown={(event) => event.preventDefault()}
      className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-lg"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-xs text-[#6B7280]">
        <span className="flex items-center gap-1.5 font-medium text-[#1F2937]">
          <MessageSquareTextIcon className="h-3.5 w-3.5" />
          Mensagens rápidas
        </span>
        <span className="hidden sm:inline">
          ↑↓ para escolher · Enter para usar · Esc para fechar
        </span>
      </div>

      <div className="max-h-64 overflow-y-auto p-1">
        {loading ? (
          <div className="space-y-1 p-1">
            {[1, 2].map((item) => (
              <div
                key={item}
                className="h-10 animate-pulse rounded-lg bg-slate-100"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-3 text-sm text-[#6B7280]">
            Nenhuma mensagem rápida cadastrada. Cadastre em Mensagens rápidas,
            na área administrativa.
          </p>
        ) : (
          items.map((item, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={item.id}
                ref={active ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => onHover(index)}
                onClick={() => onSelect(item)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "bg-blue-50 text-[#1F2937]"
                    : "text-[#374151] hover:bg-[#F3F4F6]"
                }`}
              >
                <span className="line-clamp-2 whitespace-pre-wrap">
                  {item.message}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
