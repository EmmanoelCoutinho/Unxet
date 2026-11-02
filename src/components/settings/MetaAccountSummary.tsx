import React, { useState } from "react";
import { AlertTriangleIcon, ExternalLinkIcon } from "lucide-react";

/** Dados de uma conta conectada, lidos na Meta pela ação connection_details do meta-connect */
export type MetaAccountDetails = {
  name?: string | null;
  username?: string | null;
  pictureUrl?: string | null;
  followers?: number | null;
  link?: string | null;
  pageId?: string | null;
  error?: "token_invalid" | "fetch_failed";
};

const formatFollowers = (value: number) =>
  `${new Intl.NumberFormat("pt-BR", { notation: value >= 10000 ? "compact" : "standard" }).format(value)} ${
    value === 1 ? "seguidor" : "seguidores"
  }`;

const Avatar: React.FC<{ url?: string | null; label: string }> = ({ url, label }) => {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-11 w-11 shrink-0 rounded-full border border-gray-200 object-cover"
      />
    );
  }
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-500">
      {label.replace(/^@/, "").charAt(0).toUpperCase() || "?"}
    </div>
  );
};

/** Bloco com foto, nome, @ e seguidores da Página ou do Instagram conectado */
export const MetaAccountSummary: React.FC<{
  kind: "messenger" | "instagram";
  details?: MetaAccountDetails | null;
  loading?: boolean;
  fallbackName?: string | null;
  connectedSince?: string | null;
  linkedPageName?: string | null;
}> = ({ kind, details, loading, fallbackName, connectedSince, linkedPageName }) => {
  if (loading && !details) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="h-11 w-11 animate-pulse rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200" />
        </div>
      </div>
    );
  }

  if (details?.error === "token_invalid") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          A autorização da Meta expirou ou foi removida. Clique em “Conectar Instagram e Facebook” para
          conectar de novo.
        </span>
      </div>
    );
  }

  const isInstagram = kind === "instagram";
  const username = details?.username ?? (isInstagram ? fallbackName : null);
  const title = isInstagram
    ? username
      ? `@${username}`
      : details?.name ?? "Conta do Instagram"
    : details?.name ?? fallbackName ?? "Página do Facebook";
  const subtitle = isInstagram && details?.name && username ? details.name : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center gap-3">
        <Avatar url={details?.pictureUrl} label={title} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{title}</p>
          {subtitle ? <p className="truncate text-xs text-gray-500">{subtitle}</p> : null}
          {typeof details?.followers === "number" ? (
            <p className="text-xs text-gray-500">{formatFollowers(details.followers)}</p>
          ) : null}
        </div>
        {details?.link ? (
          <a
            href={details.link}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-white hover:text-blue-600"
            aria-label={isInstagram ? "Abrir perfil no Instagram" : "Abrir Página no Facebook"}
            title={isInstagram ? "Abrir perfil no Instagram" : "Abrir Página no Facebook"}
          >
            <ExternalLinkIcon className="h-4 w-4" />
          </a>
        ) : null}
      </div>

      {linkedPageName || connectedSince || details?.error === "fetch_failed" ? (
        <div className="mt-3 space-y-1 border-t border-gray-200 pt-2.5 text-xs text-gray-500">
          {linkedPageName ? <p>Vinculado à Página {linkedPageName}</p> : null}
          {connectedSince ? <p>Conectado em {connectedSince}</p> : null}
          {details?.error === "fetch_failed" ? (
            <p className="text-amber-700">Não foi possível atualizar os dados da conta agora.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
