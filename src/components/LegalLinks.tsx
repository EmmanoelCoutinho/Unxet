import React from "react";

// Páginas legais publicadas na landing (repositório unxet-landing)
export const TERMS_URL = "https://www.unxet.com.br/termos";
export const PRIVACY_URL = "https://www.unxet.com.br/privacidade";
// Página de status (Better Stack). Fica fora da nossa estrutura, então abre
// mesmo quando o app está fora do ar.
export const STATUS_URL = "https://status.unxet.com.br/pt";

const linkClass = "text-[#0A84FF] hover:underline";

const LegalLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
    {children}
  </a>
);

/** "Ao entrar, você concorda com os Termos de Uso e a Política de Privacidade." */
export const LegalConsent: React.FC<{ action: string; className?: string }> = ({ action, className = "" }) => (
  <p className={`text-center text-xs leading-relaxed text-gray-500 ${className}`}>
    {action}, você concorda com os <LegalLink href={TERMS_URL}>Termos de Uso</LegalLink> e a{" "}
    <LegalLink href={PRIVACY_URL}>Política de Privacidade</LegalLink>.
  </p>
);

/** "Problemas para acessar? Veja o status do sistema." */
export const StatusNotice: React.FC<{ className?: string }> = ({ className = "" }) => (
  <p className={`text-center text-xs text-gray-500 ${className}`}>
    Problemas para acessar? Veja o <LegalLink href={STATUS_URL}>status do sistema</LegalLink>.
  </p>
);

/** Links curtos, para rodapés e menus */
export const LegalLinks: React.FC<{ className?: string }> = ({ className = "" }) => (
  <p className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-500 ${className}`}>
    <LegalLink href={TERMS_URL}>Termos de Uso</LegalLink>
    <LegalLink href={PRIVACY_URL}>Política de Privacidade</LegalLink>
    <LegalLink href={STATUS_URL}>Status do sistema</LegalLink>
  </p>
);
