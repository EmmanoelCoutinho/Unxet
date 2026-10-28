import React from "react";
import { UserIcon } from "lucide-react";

/**
 * Cartão com a mensagem como o cliente vê no WhatsApp (fundo e bolha
 * verdes). Usado no passo a passo e no resultado da campanha.
 */
export const WhatsappPreview: React.FC<{
  title: string;
  meta?: React.ReactNode;
  text: string;
  time: string;
  emptyText?: string;
}> = ({ title, meta, text, time, emptyText = "Sua mensagem aparece aqui." }) => (
  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {meta && <p className="text-xs text-slate-500">{meta}</p>}
    </div>
    <div className="bg-[#EFEAE2] px-4 py-5">
      <div className="mb-3 flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-400 text-white"
          aria-hidden="true"
        >
          <UserIcon className="h-4 w-4" />
        </span>
        <span className="text-xs font-medium text-slate-600">Como o cliente vê</span>
      </div>
      <div className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-[#D9FDD3] px-3 py-2 shadow-sm">
        {text.trim() ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-5 text-slate-900">{text}</p>
        ) : (
          <p className="text-sm italic text-slate-500">{emptyText}</p>
        )}
        <p className="mt-1 text-right text-[11px] text-slate-500">{time}</p>
      </div>
    </div>
  </div>
);
