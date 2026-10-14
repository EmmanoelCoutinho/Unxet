import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { MessageCircleIcon } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { botsService } from "../services/bots";
import type {
  BotChannelBindingRow,
  BotRow,
  ChannelConnectionRow,
} from "../types/bots";
import {
  BOT_CHANNEL_BINDING_TRIGGER_TYPE_VALUES,
  isBotSupportedChannel,
} from "../types/bots";
import { supabase } from "../lib/supabaseClient";

// Único acionamento existente hoje, por isso não é um campo editável
const DEFAULT_TRIGGER = BOT_CHANNEL_BINDING_TRIGGER_TYPE_VALUES[0];
const TRIGGER_LABEL = "Abertura ou reabertura de conversa";

const providerLabel = (c: ChannelConnectionRow) =>
  c.provider === "evolution" ? "QR Code" : "API oficial";

const formatPhone = (value?: string | null) => {
  const digits = (value ?? "").split("@")[0].replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return `+${digits}`;
};

const connectionStatusBadge = (
  status?: ChannelConnectionRow["status"] | null,
) => {
  const s = status ?? "disconnected";
  if (s === "connected") return <Badge variant="success">Conectado</Badge>;
  if (s === "needs_reauth") return <Badge variant="warning">Reconectar</Badge>;
  return <Badge>Desconectado</Badge>;
};

export const BotBindingsEditor = ({
  clinicId,
  botId,
  botStatus,
  isAdmin,
}: {
  clinicId: string;
  botId: string;
  botStatus: BotRow["status"];
  isAdmin: boolean;
}) => {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [connections, setConnections] = useState<ChannelConnectionRow[]>([]);
  const [bindings, setBindings] = useState<BotChannelBindingRow[]>([]);
  const [conflicts, setConflicts] = useState<
    Record<string, { botId: string; botName: string }>
  >({});

  const bindingByChannelId = useMemo(() => {
    const map: Record<string, BotChannelBindingRow> = {};
    for (const b of bindings) {
      map[b.channel_connection_id] = b;
    }
    return map;
  }, [bindings]);

  const load = useCallback(async () => {
    setLoading(true);

    const [{ data: authData }, connRes, bindingsRes, enabledRes] =
      await Promise.all([
        supabase.auth.getUser(),
        botsService.listChannelConnections(clinicId),
        botsService.listBindings(clinicId, botId),
        botsService.listEnabledBindings(clinicId),
      ]);

    setCurrentUserId(authData.user?.id ?? null);

    if (connRes.error) toast.error(connRes.error.message);
    if (bindingsRes.error) toast.error(bindingsRes.error.message);
    if (enabledRes.error) toast.error(enabledRes.error.message);

    setConnections(
      (connRes.data ?? []).filter((c) => isBotSupportedChannel(c.channel)),
    );
    setBindings(bindingsRes.data ?? []);

    // O banco aceita um único vínculo ligado por canal, seja qual for o
    // status do outro bot — então qualquer vínculo ligado é um conflito.
    const conflictMap: Record<string, { botId: string; botName: string }> = {};
    for (const row of enabledRes.data ?? []) {
      if (row.bot_id === botId) continue;
      conflictMap[row.channel_connection_id] = {
        botId: row.bot_id,
        botName: row.bot_name,
      };
    }

    setConflicts(conflictMap);
    setLoading(false);
  }, [botId, clinicId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleEnabled = async (
    conn: ChannelConnectionRow,
    next: boolean,
  ) => {
    if (!isAdmin) {
      toast.error("Você não tem permissão para esta ação.");
      return;
    }

    if (!currentUserId) {
      toast.error("Usuário autenticado não encontrado.");
      return;
    }

    const conflict = conflicts[conn.id];
    if (next && conflict) {
      const ok = await confirm({
        title: "Canal em uso por outro bot",
        description: `Este canal está sendo usado pelo bot "${conflict.botName}". Deseja passar o canal para este bot?`,
        confirmLabel: "Passar canal",
        tone: "warning",
      });
      if (!ok) return;
    }

    setSavingKey(conn.id);

    if (next && conflict) {
      const released = await botsService.disableBinding(
        clinicId,
        conflict.botId,
        conn.id,
      );
      if (released.error) {
        setSavingKey(null);
        toast.error(released.error.message);
        return;
      }
    }

    const existing = bindingByChannelId[conn.id];
    const res = await botsService.upsertBinding({
      clinic_id: clinicId,
      bot_id: botId,
      channel_connection_id: conn.id,
      enabled: next,
      trigger_type: existing?.trigger_type ?? DEFAULT_TRIGGER,
      created_by: existing?.created_by ?? currentUserId,
    });

    setSavingKey(null);

    if (res.error) toast.error(res.error.message);
    else toast.success(next ? "Canal vinculado." : "Canal desvinculado.");

    await load();
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white"
          />
        ))}
      </div>
    );
  }

  const hasEnabledChannel = connections.some(
    (c) => bindingByChannelId[c.id]?.enabled,
  );

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Vínculo com canais
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Escolha em quais números de WhatsApp este bot atende. Instagram e
              Facebook Messenger ainda não são atendidos por bots.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={load}>
            Recarregar
          </Button>
        </div>
      </Card>

      {hasEnabledChannel && botStatus !== "active" ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          O canal está vinculado, mas o bot está inativo e não vai responder.
          Ative o bot na aba Geral quando o fluxo estiver pronto.
        </div>
      ) : null}

      {connections.length === 0 ? (
        <Card className="p-4 sm:p-6">
          <div className="text-sm text-slate-600">
            Nenhum WhatsApp conectado nesta Empresa.{" "}
            <Link
              to="/inbox/settings/integrations/meta"
              className="font-medium text-blue-600 hover:text-blue-800"
            >
              Conectar WhatsApp
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {connections.map((conn) => {
            const enabled = Boolean(bindingByChannelId[conn.id]?.enabled);
            const conflict = conflicts[conn.id];
            const saving = savingKey === conn.id;
            const phone = formatPhone(conn.connected_phone);

            return (
              <Card key={conn.id} className="p-4 sm:p-5">
                <div className="flex w-full flex-wrap items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <MessageCircleIcon className="h-4 w-4 shrink-0 text-green-600" />
                      <div className="text-sm font-semibold text-slate-900">
                        WhatsApp · {providerLabel(conn)}
                      </div>
                      {connectionStatusBadge(conn.status)}
                      {conflict ? (
                        <Badge variant="warning">
                          Em uso por: {conflict.botName}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {phone ? `${phone} · ` : ""}Acionamento: {TRIGGER_LABEL}
                    </div>
                  </div>

                  <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:shrink-0">
                    <span className="text-sm font-medium text-slate-800">
                      {enabled ? "Vinculado" : "Desvinculado"}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`Vincular WhatsApp ${providerLabel(conn)} a este bot`}
                      disabled={!isAdmin || saving}
                      onClick={() => handleToggleEnabled(conn, !enabled)}
                      className={[
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                        enabled ? "bg-blue-600" : "bg-slate-300",
                        !isAdmin || saving
                          ? "cursor-not-allowed opacity-60"
                          : "cursor-pointer",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                          enabled ? "translate-x-6" : "translate-x-1",
                        ].join(" ")}
                      />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
