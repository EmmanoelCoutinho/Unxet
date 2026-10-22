import React, { useState } from "react";
import { LockIcon, LogOutIcon } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

// Empresa suspensa: ninguém usa o app, mas as mensagens continuam chegando.
// O texto é neutro de propósito (não cita pagamento): vale para toda a equipe.
export const AccessSuspended: React.FC = () => {
  const { signOut } = useAuth();
  const [leaving, setLeaving] = useState(false);

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <img
          src="/logo-unxet.png"
          alt="Unxet"
          className="mx-auto h-10 object-contain"
        />
        <div className="mx-auto mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <LockIcon className="h-6 w-6 text-gray-500" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-gray-900">
          Acesso temporariamente indisponível
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          O acesso da sua empresa ao Unxet está pausado no momento. Entre em
          contato com a equipe da Unxet para reativá-lo.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Suas conversas e mensagens continuam guardadas.
        </p>
        <button
          type="button"
          onClick={async () => {
            setLeaving(true);
            await signOut();
          }}
          disabled={leaving}
          className="mt-6 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          <LogOutIcon className="h-4 w-4" />
          Sair
        </button>
      </div>
    </div>
  );
};
