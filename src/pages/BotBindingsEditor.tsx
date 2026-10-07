import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { FacebookIcon, InstagramIcon, MessageCircleIcon } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { botsService } from "../services/bots";
import type {
  BotChannelBindingRow,
  BotRow,
  ChannelConnectionRow,
  UpsertBotChannelBindingInput,
} from "../types/bots";
import { BOT_CHANNEL_BINDING_TRIGGER_TYPE_VALUES } from "../types/bots";
import { supabase } from "../lib/supabaseClient";

const ensureValueInList = (values: string[], current: string) => {
  if (!current) return values;
  return values.includes(current) ? values : [...values, current];
};

const channelLabel = (c: ChannelConnectionRow) => {
  const base =
    c.channel === "whatsapp"
      ? "WhatsApp"
      : c.channel === "instagram"
        ? "Instagram"
        : c.channel === "messenger"
          ? "Facebook Messenger"
          : (c.label ?? "");

  return base;
};

const channelIcon = (c: ChannelConnectionRow) => {
  if (c.channel === "whatsapp") {
    return <MessageCircleIcon className="h-4 w-4 text-green-600" />;
  }
  if (c.channel === "instagram") {
    return <InstagramIcon className="h-4 w-4 text-pink-600" />;
  }
  if (c.channel === "messenger") {
    return <FacebookIcon className="h-4 w-4 text-blue-600" />;
  }
  return <MessageCircleIcon className="h-4 w-4 text-slate-500" />;
};

const connectionStatusBadge = (
  status?: ChannelConnectionRow["status"] | null,
) => {
  const s = status ?? "disconnected";
  const cls =
    s === "connected"
      ? "success"
      : s === "needs_reauth"
        ? "warning"
        : "default";
  const text =
    s === "connected"
      ? "Conectado"
      : s === "needs_reauth"
        ? "Reconectar"
        : "Desconectado";

  return <Badge variant={cls as any}>{text}</Badge>;
};

export const BotBindingsEditor = ({
  clinicId,
  botId,
  isAdmin,
}: {
  clinicId: string;
  botId: string;
  isAdmin: boolean;
}) => {
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

    const [{ data: authData }, connRes, bindingsRes, botsRes] =
      await Promise.all([
        supabase.auth.getUser(),
        botsService.listChannelConnections(clinicId),
        botsService.listBindings(clinicId, botId),
        botsService.listBots(clinicId),
      ]);

    setCurrentUserId(authData.user?.id ?? null);

    if (connRes.error) toast.error(connRes.error.message);
    if (bindingsRes.error) toast.error(bindingsRes.error.message);
    if (botsRes.error) toast.error(botsRes.error.message);

    const conns = connRes.data ?? [];
    const botBindings = bindingsRes.data ?? [];
    const bots = botsRes.data ?? [];

    setConnections(conns);
    setBindings(botBindings);

    const botIds = bots.map((b) => b.id);
    const activeBots = new Map<string, BotRow>();

    for (const b of bots) {
      if (b.status === "active") activeBots.set(b.id, b);
    }

    const conflictMap: Record<string, { botId: string; botName: string }> = {};

    if (botIds.length > 0) {
      const { data: allBindings, error } = await supabase
        .from("bot_channel_bindings")
        .select("bot_id,channel_connection_id,enabled")
        .eq("clinic_id", clinicId)
        .in("bot_id", botIds);

      if (!error) {
        for (const row of (allBindings ?? []) as Array<{
          bot_id: string;
          channel_connection_id: string;
          enabled: boolean;
        }>) {
          if (!row.enabled) continue;
          if (row.bot_id === botId) continue;

          const bot = activeBots.get(row.bot_id);
          if (!bot) continue;

          conflictMap[row.channel_connection_id] = {
            botId: row.bot_id,
            botName: bot.name,
          };
        }
      }
    }

    setConflicts(conflictMap);
    setLoading(false);
  }, [botId, clinicId]);

  useEffect(() => {
    load();
  }, [load]);

  const upsert = async (payload: UpsertBotChannelBindingInput) => {
    const key = payload.channel_connection_id;
    setSavingKey(key);

    const res = await botsService.upsertBinding(payload);

    setSavingKey(null);

    if (res.error) {
      toast.error(res.error.message);
      return false;
    }

    await load();
    return true;
  };

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
      toast.error(
        `Este canal já está vinculado ao bot ativo "${conflict.botName}". Desative o vínculo no outro bot primeiro.`,
      );
      return;
    }

    const existing = bindingByChannelId[conn.id];
    const trigger =
      existing?.trigger_type ?? BOT_CHANNEL_BINDING_TRIGGER_TYPE_VALUES[0]!;

    await upsert({
      clinic_id: clinicId,
      bot_id: botId,
      channel_connection_id: conn.id,
      enabled: next,
      trigger_type: trigger,
      created_by: existing?.created_by ?? currentUserId,
    });
  };

  const handleChangeTrigger = async (
    conn: ChannelConnectionRow,
    triggerType: string,
  ) => {
    if (!isAdmin) {
      toast.error("Você não tem permissão para esta ação.");
      return;
    }

    if (!currentUserId) {
      toast.error("Usuário autenticado não encontrado.");
      return;
    }

    const existing = bindingByChannelId[conn.id];
    const enabled = existing?.enabled ?? false;

    await upsert({
      clinic_id: clinicId,
      bot_id: botId,
      channel_connection_id: conn.id,
      enabled,
      trigger_type: triggerType,
      created_by: existing?.created_by ?? currentUserId,
    });
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Vínculo com canais
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Selecione quais canais de atendimento disponíveis usarão este bot.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={load}>
            Recarregar
          </Button>
        </div>
      </Card>

      {connections.length === 0 ? (
        <Card className="p-6">
          <div className="text-sm text-slate-600">
            Nenhuma conexão de canal encontrada para esta Empresa.
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {connections.map((conn) => {
            const b = bindingByChannelId[conn.id];
            const enabled = Boolean(b?.enabled);
            const trigger =
              b?.trigger_type ?? BOT_CHANNEL_BINDING_TRIGGER_TYPE_VALUES[0]!;
            const triggerValues = ensureValueInList(
              [...BOT_CHANNEL_BINDING_TRIGGER_TYPE_VALUES],
              String(trigger ?? ""),
            );
            const conflict = conflicts[conn.id];
            const saving = savingKey === conn.id;

            return (
              <Card key={conn.id} className="p-5">
                <div className="flex w-full flex-wrap items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0">{channelIcon(conn)}</span>
                      <div className="text-sm font-semibold text-slate-900">
                        {channelLabel(conn)}
                      </div>
                      {connectionStatusBadge(conn.status)}
                      {conflict ? (
                        <Badge variant="warning">
                          Em uso por: {conflict.botName}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col shrink-0 gap-2">
                    <label className="text-sm font-medium text-[#1E1E1E]">
                      Tipo de acionamento
                    </label>
                    <select
                      value={trigger}
                      disabled={!isAdmin || saving}
                      onChange={(e) =>
                        handleChangeTrigger(conn, e.target.value)
                      }
                      className="w-[300px] rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
                    >
                      {triggerValues.map((v) => (
                        <option key={v} value={v}>
                          Primeiro Contato/Reabrir conversa
                        </option>
                      ))}
                    </select>
                  </div>

                  <div
                    className="ml-auto flex flex-col items-center shrink-0 gap-2"
                    title="Um canal pode ter no máximo um bot ativo vinculado."
                  >
                    <span className="text-sm font-medium text-slate-800">
                      Habilitar vínculo
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label="Habilitar vínculo"
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
