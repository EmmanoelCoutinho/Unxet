import React from 'react';
import logo from '../assets/logo-unxet.png';

// Moldura das telas de acesso fora do app (login, recuperar e definir senha):
// fundo com o gradiente da marca, cartão branco com o logo da Unxet e um
// selo com o ícone da etapa.
interface AuthShellProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}

export const AuthShell: React.FC<AuthShellProps> = ({ icon, title, subtitle, children }) => (
  <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-br from-[#003366] via-[#0656A8] to-[#0A84FF] flex items-center justify-center p-4">
    {/* Círculos de luz no fundo, só decoração */}
    <div aria-hidden className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
    <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-[#0A84FF]/40 blur-3xl" />

    <div className="relative w-full max-w-md">
      <div className="rounded-2xl bg-white shadow-2xl shadow-[#003366]/30 overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-[#003366] to-[#0A84FF]" />
        <div className="p-6 sm:p-8">
          <img src={logo} alt="Unxet" className="mx-auto w-40 object-contain" />

          {icon && (
            <div className="mt-6 flex justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0A84FF]/10 text-[#0A84FF] ring-1 ring-[#0A84FF]/20">
                {icon}
              </span>
            </div>
          )}

          <h1 className="mt-4 text-center text-2xl font-semibold text-gray-900">{title}</h1>
          {subtitle && (
            <p className="mt-2 text-center text-sm text-gray-500">{subtitle}</p>
          )}

          <div className="mt-6">{children}</div>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-white/70">
        Unxet · Central de Mensagens
      </p>
    </div>
  </div>
);
