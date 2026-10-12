import React from "react";
import { MessageSquareIcon } from "lucide-react";

export const InboxEmpty: React.FC = () => (
  <div className="flex h-full flex-1 flex-col items-center justify-center bg-gray-50 p-6 text-center">
    <MessageSquareIcon className="mb-3 h-16 w-16 text-gray-300" />
    <h3 className="text-lg font-medium text-gray-900">Selecione uma conversa</h3>
    <p className="text-sm text-gray-500">
      Escolha um atendimento na lista ao lado para começar.
    </p>
  </div>
);
