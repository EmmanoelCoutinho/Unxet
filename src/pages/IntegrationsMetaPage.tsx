"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  ExternalLinkIcon,
  FacebookIcon,
  InstagramIcon,
  LogOutIcon,
  MessageCircleIcon,
  Settings2Icon,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { SettingsTabs } from "../components/settings/SettingsTabs";
import PreTitleIcon from "../components/ui/PreTitleIcon";

const META_APP_ID = import.meta.env.VITE_META_APP_ID as string | undefined;
const META_APP_WABA_ID = import.meta.env.VITE_META_APP_WABA_ID as
  | string
  | undefined;
const META_WA_CONFIG_ID = import.meta.env.VITE_META_WA_CONFIG_ID as
  | string
  | undefined;
const META_REDIRECT_URI = import.meta.env.VITE_META_REDIRECT_URI as
  | string
  | undefined;

type Connection = {
  id: string;
  provider: "meta" | "evolution";
  channel: "messenger" | "instagram" | "whatsapp";
  meta_waba_id: string | null;
  meta_phone_number_id: string | null;
  meta_page_id: string | null;
  meta_ig_user_id: string | null;
  qr_code?: string | null;
  connected_phone?: string | null;
  connected_name?: string | null;
  session_name?: string | null;
  last_connection_at?: string | null;
  last_disconnection_at?: string | null;
  status: "connecting" | "connected" | "disconnected" | "needs_reauth";
  updated_at: string | null;
};

type DbClinicRow = {
  id: string;
  name: string | null;
};

type PlatformCardProps = {
  title: string;
  description: string;
  status?: Connection["status"] | null;
  icon: React.ReactNode;
  accessItems: string[];
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  actionClassName?: string;
  actionIcon?: React.ReactNode;
  actionAfterChildren?: boolean;
  children?: React.ReactNode;
};

export const MetaIntegrationsPage: React.FC = () => {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;

  const [clinicName, setClinicName] = useState<string>("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);

  const clinicLabel = useMemo(() => {
    if (!clinicId) return "Empresa atual (indefinida)";
    if (!clinicName) return "Empresa atual";
    return clinicName;
  }, [clinicId, clinicName]);

  const messenger = useMemo(
    () => connections.find((c) => c.channel === "messenger") ?? null,
    [connections],
  );

  const instagram = useMemo(
    () => connections.find((c) => c.channel === "instagram") ?? null,
    [connections],
  );

  const whatsappMeta = useMemo(
    () =>
      connections.find(
        (c) => c.channel === "whatsapp" && c.provider === "meta",
      ) ?? null,
    [connections],
  );

  const whatsappEvolution = useMemo(
    () =>
      connections.find(
        (c) => c.channel === "whatsapp" && c.provider === "evolution",
      ) ?? null,
    [connections],
  );

  const isWhatsAppMetaConnected = useMemo(
    () =>
      whatsappMeta?.provider === "meta" && whatsappMeta.status === "connected",
    [whatsappMeta],
  );

  const isWhatsAppEvolutionConnected = useMemo(
    () =>
      whatsappEvolution?.provider === "evolution" &&
      whatsappEvolution.status === "connected",
    [whatsappEvolution],
  );

  const blockMetaByEvolution = isWhatsAppEvolutionConnected;
  const blockEvolutionByMeta = isWhatsAppMetaConnected;

  const formatDateTime = useCallback((value?: string | null) => {
    if (!value) return null;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;

    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(parsed);
  }, []);

  const formatPhoneIdentifier = useCallback((value?: string | null) => {
    const rawValue = value?.trim();
    if (!rawValue) return null;

    const identifier = rawValue.includes("@")
      ? rawValue.split("@")[0].trim()
      : rawValue;
    const digits = identifier.replace(/\D/g, "");

    if (digits.length === 13 && digits.startsWith("55")) {
      return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }

    if (digits.length === 12 && digits.startsWith("55")) {
      return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
    }

    if (digits.length === 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }

    if (digits.length === 10) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }

    return identifier;
  }, []);

  const whatsappEvolutionConnectedLabel = useMemo(() => {
    if (!whatsappEvolution) return null;

    const name = whatsappEvolution.connected_name?.trim();
    const phone = whatsappEvolution.connected_phone?.trim();

    if (name && phone) return `${name} - ${phone}`;
    if (phone) return phone;
    if (name) return name;
    return null;
  }, [whatsappEvolution]);

  const whatsappEvolutionConnectedPhoneLabel = useMemo(
    () => formatPhoneIdentifier(whatsappEvolution?.connected_phone),
    [formatPhoneIdentifier, whatsappEvolution?.connected_phone],
  );

  const whatsappEvolutionActionLabel = useMemo(() => {
    if (disconnectLoading) return "Desconectando...";
    if (qrLoading) return "Gerando QR Code...";
    if (isWhatsAppEvolutionConnected) return "Desconectar";
    if (!whatsappEvolution) return "Conectar via QR Code";
    if (whatsappEvolution.status === "disconnected") return "Reconectar";
    return "Conectar via QR Code";
  }, [
    disconnectLoading,
    isWhatsAppEvolutionConnected,
    qrLoading,
    whatsappEvolution,
  ]);

  const whatsappQrCode = useMemo(
    () =>
      whatsappEvolution?.provider === "evolution"
        ? (whatsappEvolution.qr_code ?? null)
        : null,
    [whatsappEvolution],
  );

  const lastConnectionLabel = useMemo(
    () => formatDateTime(whatsappEvolution?.last_connection_at),
    [formatDateTime, whatsappEvolution?.last_connection_at],
  );

  const lastDisconnectionLabel = useMemo(
    () => formatDateTime(whatsappEvolution?.last_disconnection_at),
    [formatDateTime, whatsappEvolution?.last_disconnection_at],
  );

  const startMetaOAuth = useCallback(() => {
    if (!clinicId) return;

    if (!META_APP_ID || !META_REDIRECT_URI) {
      setErrorMsg(
        "Configuração do Meta OAuth ausente (VITE_META_APP_ID / VITE_META_REDIRECT_URI).",
      );
      return;
    }

    const state = `${clinicId}|fb`;
    const scopes = [
      "public_profile",
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_metadata",
      "pages_messaging",
      "instagram_basic",
      "instagram_manage_messages",
      "business_management",
    ].join(",");

    const url =
      `https://www.facebook.com/v21.0/dialog/oauth` +
      `?client_id=${encodeURIComponent(META_APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}` +
      `&state=${encodeURIComponent(state)}` +
      `&response_type=code` +
      `&auth_type=rerequest` +
      `&prompt=consent` +
      `&scope=${encodeURIComponent(scopes)}`;

    window.location.href = url;
  }, [clinicId]);

  const startWhatsAppOAuth = useCallback(() => {
    if (!clinicId) return;

    if (!META_APP_WABA_ID || !META_REDIRECT_URI || !META_WA_CONFIG_ID) {
      setErrorMsg(
        "Configuração Meta ausente (App ID / Redirect URI / Config ID).",
      );
      return;
    }

    const state = `${clinicId}|wa`;

    const url =
      `https://www.facebook.com/v21.0/dialog/oauth` +
      `?client_id=${encodeURIComponent(META_APP_WABA_ID)}` +
      `&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}` +
      `&state=${encodeURIComponent(state)}` +
      `&response_type=code` +
      `&config_id=${encodeURIComponent(META_WA_CONFIG_ID)}`;

    window.location.href = url;
  }, [clinicId]);

  const fetchClinic = useCallback(async () => {
    if (!clinicId) return;

    const { data, error } = await supabase
      .from("clinics")
      .select("id,name")
      .eq("id", clinicId)
      .single();

    if (error) {
      setClinicName("");
      return;
    }

    const clinic = data as DbClinicRow;
    setClinicName(clinic?.name ?? "");
  }, [clinicId]);

  const fetchConnections = useCallback(async () => {
    if (!clinicId) return;

    setErrorMsg(null);

    const { data, error } = await supabase
      .from("channel_connections")
      .select(
        "id,provider,channel,meta_waba_id,meta_phone_number_id,meta_page_id,meta_ig_user_id,qr_code,connected_phone,connected_name,session_name,last_connection_at,last_disconnection_at,status,updated_at",
      )
      .in("provider", ["meta", "evolution"])
      .eq("clinic_id", clinicId)
      .in("channel", ["messenger", "instagram", "whatsapp"])
      .order("updated_at", { ascending: false });

    if (error) {
      setConnections([]);
      setErrorMsg(error.message);
      return;
    }

    setConnections((data ?? []) as Connection[]);
  }, [clinicId]);

  const startEvolutionConnection = useCallback(async () => {
    if (!clinicId) return;

    setErrorMsg(null);
    setQrLoading(true);

    try {
      let evolutionConnection =
        connections.find(
          (connection) =>
            connection.provider === "evolution" &&
            connection.channel === "whatsapp",
        ) ?? null;

      if (!evolutionConnection) {
        const { data, error } = await supabase
          .from("channel_connections")
          .insert({
            clinic_id: clinicId,
            provider: "evolution",
            channel: "whatsapp",
            status: "disconnected",
            session_name: `clinic_${clinicId}`,
          })
          .select(
            "id,provider,channel,meta_waba_id,meta_phone_number_id,meta_page_id,meta_ig_user_id,qr_code,connected_phone,connected_name,session_name,last_connection_at,last_disconnection_at,status,updated_at",
          )
          .single();

        if (error) throw error;

        evolutionConnection = data as Connection;
      }

      const { error } = await supabase.functions.invoke(
        "create-evolution-connection",
        {
          body: {
            connectionId: evolutionConnection.id,
          },
        },
      );

      if (error) throw error;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível iniciar a conexão via QR Code.";
      setErrorMsg(message);
      setQrLoading(false);
      return;
    }

    await fetchConnections();
  }, [clinicId, connections, fetchConnections]);

  const disconnectEvolutionConnection = useCallback(async () => {
    if (!whatsappEvolution?.id) {
      setErrorMsg("Conexão Evolution não encontrada para desconectar.");
      return;
    }

    setErrorMsg(null);
    setDisconnectLoading(true);

    try {
      const { error: fnError } = await supabase.functions.invoke(
        "disconnect-evolution-connection",
        {
          body: {
            connectionId: whatsappEvolution.id,
          },
        },
      );

      if (fnError) {
        const response = (fnError as { context?: Response }).context;
        const errorPayload = (await response?.json?.().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;

        throw new Error(
          errorPayload?.error ??
            errorPayload?.message ??
            "Não foi possível desconectar a instância Evolution.",
        );
      }

      await fetchConnections();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível desconectar a instância Evolution.";
      setErrorMsg(message);
    } finally {
      setDisconnectLoading(false);
    }
  }, [fetchConnections, whatsappEvolution?.id]);

  useEffect(() => {
    fetchClinic();
    fetchConnections();
  }, [fetchClinic, fetchConnections]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel(`meta-integrations:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channel_connections",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const nextRow = payload.new as Partial<Connection> | null;
          const prevRow = payload.old as Partial<Connection> | null;
          const targetId = nextRow?.id ?? prevRow?.id;

          if (!targetId) {
            fetchConnections();
            return;
          }

          setConnections((current) => {
            if (payload.eventType === "DELETE") {
              return current.filter((connection) => connection.id !== targetId);
            }

            const incoming = nextRow as Connection;
            const index = current.findIndex(
              (connection) => connection.id === incoming.id,
            );

            if (index === -1) {
              return [incoming, ...current];
            }

            const updated = [...current];
            updated[index] = { ...updated[index], ...incoming };
            return updated;
          });

          if (
            nextRow?.provider === "evolution" &&
            nextRow?.channel === "whatsapp"
          ) {
            setQrLoading(false);
            setDisconnectLoading(false);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinicId, fetchConnections]);

  const renderStatus = (status?: Connection["status"] | null) => {
    const s = status ?? "disconnected";
    const cls =
      s === "connected"
        ? "border-green-200 bg-green-50 text-green-700"
        : s === "connecting"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : s === "needs_reauth"
            ? "border-yellow-200 bg-yellow-50 text-yellow-800"
            : "border-gray-200 bg-gray-50 text-gray-700";

    const label =
      s === "connected"
        ? "Conectado"
        : s === "connecting"
          ? "Conectando"
          : s === "needs_reauth"
            ? "Reconectar"
            : "Desconectado";

    return (
      <span className={`rounded-full border px-2 py-1 text-xs ${cls}`}>
        {label}
      </span>
    );
  };

  const PlatformCard: React.FC<PlatformCardProps> = ({
    title,
    description,
    status,
    icon,
    accessItems,
    actionLabel,
    onAction,
    actionDisabled,
    actionClassName,
    actionIcon,
    actionAfterChildren = false,
    children,
  }) => {
    const actionContent =
      actionLabel && onAction ? (
        <div className="mt-4">
          <Button
            variant="primary"
            className={actionClassName ?? "bg-blue-600"}
            size="sm"
            onClick={onAction}
            disabled={actionDisabled}
          >
            <span className="flex items-center gap-2">
              {actionIcon ?? <ExternalLinkIcon className="h-4 w-4" />}
              {actionLabel}
            </span>
          </Button>
        </div>
      ) : null;

    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-50 text-gray-700">
              {icon}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{title}</p>
              <p className="text-xs text-gray-500">{description}</p>
            </div>
          </div>
          {renderStatus(status)}
        </div>

        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Acesso liberado
          </p>
          <ul className="mt-2 space-y-2 text-sm text-gray-700">
            {accessItems.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-gray-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {!actionAfterChildren ? actionContent : null}

        {children ? <div className="mt-4">{children}</div> : null}
        {actionAfterChildren ? actionContent : null}
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="border-b bg-white px-4 sm:px-6 py-5">
        <div className="flex flex-col justify-center">
          <div className="flex gap-3">
            <PreTitleIcon icon={Settings2Icon} />
            <span className="flex flex-col">
              <h1 className="text-2xl font-semibold text-gray-900">
                Integrações
              </h1>
              <p className="text-sm text-gray-500">
                Conecte seus canais da Meta para ativar Messenger, Instagram e
                WhatsApp.
              </p>
            </span>
          </div>
          <SettingsTabs />
        </div>
      </div>

      <div className="flex min-h-0 flex-col space-y-6 px-4 sm:px-6 py-6 pb-20">
        {errorMsg ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : null}

        {!clinicId ? (
          <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900">
              Empresa não identificada
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Aguarde o perfil carregar para configurar integrações.
            </p>
          </Card>
        ) : (
          <>
            <Card className="p-4 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    WhatsApp
                  </h2>
                  <p className="text-sm text-gray-500">
                    Empresa vinculada: {clinicLabel}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <PlatformCard
                  title="WhatsApp via Meta"
                  description="Integração oficial da Meta Cloud API."
                  status={whatsappMeta?.status}
                  icon={
                    <MessageCircleIcon className="h-5 w-5 text-green-600" />
                  }
                  accessItems={[
                    "API oficial.",
                    "Templates oficiais.",
                    "Campanhas.",
                    "Melhor estabilidade.",
                  ]}
                  actionLabel="Conectar via Meta"
                  onAction={startWhatsAppOAuth}
                  actionDisabled={!clinicId || blockMetaByEvolution}
                >
                  {blockMetaByEvolution ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                      Esta opção fica indisponível enquanto houver um WhatsApp
                      conectado via QR Code.
                    </div>
                  ) : null}
                </PlatformCard>

                <PlatformCard
                  title="WhatsApp via QR Code"
                  description="Conecte um WhatsApp existente escaneando um QR Code."
                  status={whatsappEvolution?.status}
                  icon={
                    <MessageCircleIcon className="h-5 w-5 text-green-600" />
                  }
                  accessItems={[
                    "Conexão rápida e simples.",
                    "Ativação em poucos segundos.",
                    "Integração instantânea com a inbox.",
                    "Ideal para operação imediata.",
                  ]}
                  actionLabel={whatsappEvolutionActionLabel}
                  onAction={
                    isWhatsAppEvolutionConnected
                      ? disconnectEvolutionConnection
                      : startEvolutionConnection
                  }
                  actionDisabled={
                    !clinicId ||
                    qrLoading ||
                    disconnectLoading ||
                    (!isWhatsAppEvolutionConnected && blockEvolutionByMeta)
                  }
                  actionClassName={
                    isWhatsAppEvolutionConnected
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-green-600"
                  }
                  actionIcon={
                    isWhatsAppEvolutionConnected ? (
                      <LogOutIcon className="h-4 w-4" />
                    ) : undefined
                  }
                  actionAfterChildren={isWhatsAppEvolutionConnected}
                >
                  {isWhatsAppEvolutionConnected ? (
                    <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                      <p className="font-medium">WhatsApp conectado</p>
                      {whatsappEvolutionConnectedPhoneLabel ? (
                        <p className="mt-1">
                          <span className="font-medium">Número conectado:</span>{" "}
                          {whatsappEvolutionConnectedPhoneLabel}
                        </p>
                      ) : null}
                      {whatsappEvolution?.connected_name ? (
                        <p className="mt-1">
                          {whatsappEvolution.connected_name}
                        </p>
                      ) : null}
                      {!whatsappEvolution?.connected_phone &&
                      !whatsappEvolution?.connected_name &&
                      whatsappEvolutionConnectedLabel ? (
                        <p className="mt-1">
                          {whatsappEvolutionConnectedLabel}
                        </p>
                      ) : null}
                      {lastConnectionLabel ? (
                        <p className="mt-2 text-xs text-green-700">
                          Conectado em {lastConnectionLabel}
                        </p>
                      ) : null}
                    </div>
                  ) : blockEvolutionByMeta ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                      Esta opção fica indisponível enquanto houver um WhatsApp
                      conectado via Meta.
                    </div>
                  ) : whatsappEvolution?.provider === "evolution" &&
                    whatsappQrCode ? (
                    <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-5 text-center">
                      <p className="text-sm font-semibold text-gray-900">
                        Escaneie o QR Code
                      </p>
                      <p className="mt-1 text-sm text-gray-600">
                        Abra o WhatsApp no celular e conecte o dispositivo.
                      </p>
                      <div className="mt-4 flex justify-center">
                        <img
                          src={whatsappQrCode}
                          alt="QR Code WhatsApp"
                          className="h-72 w-72"
                        />
                      </div>
                      {lastDisconnectionLabel ? (
                        <p className="mt-4 text-xs text-gray-500">
                          Última desconexão em {lastDisconnectionLabel}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    lastDisconnectionLabel && (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        <p className="mt-2 text-xs text-gray-500">
                          Última desconexão em {lastDisconnectionLabel}
                        </p>
                      </div>
                    )
                  )}
                </PlatformCard>
              </div>
            </Card>

            <Card className="p-4 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Instagram e Facebook
                  </h2>
                  <p className="text-sm text-gray-500">
                    Empresa vinculada: {clinicLabel}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <PlatformCard
                  title="Messenger"
                  description="Mensagens da Página do Facebook"
                  status={messenger?.status}
                  icon={<FacebookIcon className="h-5 w-5 text-blue-600" />}
                  accessItems={[
                    "Receber e responder mensagens da Página conectada.",
                    "Centralizar o atendimento do Facebook na inbox.",
                    "Sincronizar conversas recebidas pelo Facebook.",
                  ]}
                />

                <PlatformCard
                  title="Instagram"
                  description="DMs do Instagram vinculado à Página"
                  status={instagram?.status}
                  icon={<InstagramIcon className="h-5 w-5 text-pink-600" />}
                  accessItems={[
                    "Receber e responder mensagens diretas do Instagram.",
                    "Centralizar o atendimento do Instagram na inbox.",
                    "Manter o canal disponível para operação e automações.",
                  ]}
                />
              </div>

              <div className="mt-6 flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="bg-blue-600"
                  onClick={startMetaOAuth}
                  disabled={!clinicId}
                >
                  <span className="flex items-center gap-2">
                    <ExternalLinkIcon className="h-4 w-4" />
                    Conectar Instagram e Facebook
                  </span>
                </Button>
              </div>

              <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <span className="font-medium">Importante:</span> Para realizar a
                conexão com o Instagram, é necessário que a conta esteja
                configurada como conta profissional e vinculada a uma página do
                Facebook.
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};
