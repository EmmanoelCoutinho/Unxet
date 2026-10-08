import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BotIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { useClinic } from "../contexts/ClinicContext";
import { botsService } from "../services/bots";
import type { BotRow } from "../types/bots";
import { supabase } from "../lib/supabaseClient";
import PreTitleIcon from "../components/ui/PreTitleIcon";

type PublishedFilter = "all" | "published" | "draft";

const formatDateTime = (value?: string | null) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
};

const BotStatusBadge = ({ status }: { status: BotRow["status"] }) => {
  const isActive = status === "active";
  return (
    <Badge variant={isActive ? "success" : "warning"}>
      {isActive ? "Ativo" : "Inativo"}
    </Badge>
  );
};

const PublishedBadge = ({ published }: { published: boolean }) => {
  return (
    <Badge variant={published ? "success" : "warning"}>
      {published ? "Publicado" : "Rascunho"}
    </Badge>
  );
};

const getActiveBotConflictMessage = (activeBotName: string) =>
  `Não foi possível ativar este bot porque o bot "${activeBotName}" já está ativo. Se quiser ativar este, desative o bot que já está ativo primeiro.`;

export const BotsSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { clinicId, membership } = useClinic();
  const isAdmin = membership?.role === "admin";

  const [bots, setBots] = useState<BotRow[]>([]);
  const [bindingsCountByBotId, setBindingsCountByBotId] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<BotRow["status"] | "all">(
    "all",
  );
  const [publishedFilter, setPublishedFilter] =
    useState<PublishedFilter>("all");

  const fetchBots = useCallback(async () => {
    if (!clinicId) {
      setBots([]);
      setBindingsCountByBotId({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const res = await botsService.listBots(clinicId);
    if (res.error) {
      setBots([]);
      setBindingsCountByBotId({});
      setError(res.error.message);
      setLoading(false);
      return;
    }

    setBots(res.data);

    const ids = res.data.map((b) => b.id);
    if (ids.length === 0) {
      setBindingsCountByBotId({});
      setLoading(false);
      return;
    }

    // Best-effort: counts enabled bindings per bot.
    const { data: bindings, error: bindingsErr } = await supabase
      .from("bot_channel_bindings")
      .select("bot_id,enabled")
      .in("bot_id", ids);

    if (bindingsErr) {
      setBindingsCountByBotId({});
      setLoading(false);
      return;
    }

    const counts: Record<string, number> = {};
    for (const row of (bindings ?? []) as Array<{
      bot_id: string;
      enabled: boolean;
    }>) {
      if (!row.enabled) continue;
      counts[row.bot_id] = (counts[row.bot_id] ?? 0) + 1;
    }
    setBindingsCountByBotId(counts);
    setLoading(false);
  }, [clinicId]);

  useEffect(() => {
    fetchBots();
  }, [fetchBots]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bots.filter((b) => {
      if (q && !b.name.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (publishedFilter === "published" && !b.published) return false;
      if (publishedFilter === "draft" && b.published) return false;
      return true;
    });
  }, [bots, publishedFilter, search, statusFilter]);

  const setBotUpdating = (botId: string, next: Partial<BotRow>) => {
    setBots((prev) =>
      prev.map((b) => (b.id === botId ? ({ ...b, ...next } as BotRow) : b)),
    );
  };

  const handleTogglePublished = async (bot: BotRow) => {
    if (!clinicId) return;
    setActionLoadingId(bot.id);
    const nextPublished = !bot.published;

    if (nextPublished) {
      const v = await botsService.validateBotBeforePublish(bot.id);
      if (v.error) {
        setActionLoadingId(null);
        toast.error(v.error.message);
        return;
      }
    }

    setBotUpdating(bot.id, { published: nextPublished });
    const res = await botsService.updateBot(clinicId, bot.id, {
      published: nextPublished,
    });
    setActionLoadingId(null);
    if (res.error) {
      setBotUpdating(bot.id, { published: bot.published });
      toast.error(res.error.message);
      return;
    }
    toast.success(nextPublished ? "Bot publicado." : "Bot despublicado.");
  };

  const handleToggleStatus = async (bot: BotRow) => {
    if (!clinicId) return;
    const nextStatus = bot.status === "active" ? "inactive" : "active";

    if (nextStatus === "active") {
      const activeBotRes = await botsService.findAnotherActiveBot(
        clinicId,
        bot.id,
      );
      if (activeBotRes.error) {
        toast.error(activeBotRes.error.message);
        return;
      }

      if (activeBotRes.data) {
        toast.error(getActiveBotConflictMessage(activeBotRes.data.name));
        return;
      }
    }

    setActionLoadingId(bot.id);
    setBotUpdating(bot.id, { status: nextStatus });
    const res = await botsService.updateBot(clinicId, bot.id, {
      status: nextStatus,
    });
    setActionLoadingId(null);
    if (res.error) {
      setBotUpdating(bot.id, { status: bot.status });
      toast.error(res.error.message);
      return;
    }
    toast.success(nextStatus === "active" ? "Bot ativado." : "Bot desativado.");
  };

  const handleDuplicate = async (bot: BotRow) => {
    if (!clinicId) return;
    setActionLoadingId(bot.id);
    const res = await botsService.duplicateBot(clinicId, bot.id);
    setActionLoadingId(null);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Bot duplicado.");
    navigate("/inbox/bots/edit", { state: { botId: res.data.id } });
  };

  const handleDelete = async (bot: BotRow) => {
    if (!clinicId) return;
    const ok = window.confirm(
      `Excluir o bot "${bot.name}"? Isso irá marcar como deletado (soft delete).`,
    );
    if (!ok) return;

    setActionLoadingId(bot.id);
    const res = await botsService.softDeleteBot(clinicId, bot.id);
    setActionLoadingId(null);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    setBots((prev) => prev.filter((b) => b.id !== bot.id));
    toast.success("Bot excluído.");
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="px-4 sm:px-6 py-5 border-b bg-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex items-center gap-3">
            <PreTitleIcon icon={BotIcon} />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Bots</h1>
              <p className="text-sm text-gray-500">
                Configure fluxos de triagem e vincule bots aos canais da
                Empresa.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate("/inbox/bots/new")}
              disabled={!clinicId || !isAdmin}
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <PlusIcon className="h-4 w-4" />
                Novo bot
              </span>
            </Button>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-6">
        <Card className="p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="grid gap-3 md:grid-cols-3 md:items-end">
              <Input
                label="Buscar por nome"
                placeholder="Ex: Triagem WhatsApp"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <div className="w-full">
                <label className="block text-sm font-medium text-[#1E1E1E] mb-1">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as BotRow["status"] | "all")
                  }
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:border-transparent bg-white"
                >
                  <option value="all">Todos</option>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </div>

              <div className="w-full">
                <label className="block text-sm font-medium text-[#1E1E1E] mb-1">
                  Publicação
                </label>
                <select
                  value={publishedFilter}
                  onChange={(e) =>
                    setPublishedFilter(e.target.value as PublishedFilter)
                  }
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:border-transparent bg-white"
                >
                  <option value="all">Todos</option>
                  <option value="published">Publicado</option>
                  <option value="draft">Rascunho</option>
                </select>
              </div>
            </div>

            <div className="text-sm text-gray-500">
              {filtered.length} bot(s)
            </div>
          </div>
        </Card>

        <div className="mt-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <div className="font-medium">Falha ao carregar bots</div>
              <div className="mt-1">{error}</div>
              <button
                type="button"
                onClick={fetchBots}
                className="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                Tentar novamente
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="p-4 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Nenhum bot encontrado
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Crie um bot para começar a automatizar a triagem inicial.
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate("/inbox/bots/new")}
                  disabled={!clinicId || !isAdmin}
                >
                  <span className="flex items-center gap-2">
                    <PlusIcon className="h-4 w-4" />
                    Novo bot
                  </span>
                </Button>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {filtered.map((bot) => {
                const isActing = actionLoadingId === bot.id;
                const channelsCount = bindingsCountByBotId[bot.id] ?? 0;

                return (
                  <Card key={bot.id} className="p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-gray-900 truncate">
                            {bot.name}
                          </h3>
                          <BotStatusBadge status={bot.status} />
                          <PublishedBadge published={bot.published} />
                        </div>
                        {bot.description ? (
                          <p className="mt-1 text-sm text-gray-500">
                            {bot.description}
                          </p>
                        ) : null}

                        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-gray-600">
                          <span>
                            <span className="text-gray-500">Canais: </span>
                            <span className="font-medium">{channelsCount}</span>
                          </span>
                          <span>
                            <span className="text-gray-500">Atualizado: </span>
                            <span className="font-medium">
                              {formatDateTime(bot.updated_at)}
                            </span>
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            navigate("/inbox/bots/edit", {
                              state: { botId: bot.id },
                            })
                          }
                          disabled={!isAdmin}
                        >
                          <span className="flex items-center gap-2">
                            <PencilIcon className="h-4 w-4" />
                            Editar
                          </span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDuplicate(bot)}
                          disabled={!isAdmin || isActing}
                        >
                          <span className="flex items-center gap-2">
                            <CopyIcon className="h-4 w-4" />
                            Duplicar
                          </span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTogglePublished(bot)}
                          disabled={!isAdmin || isActing}
                        >
                          <span className="flex items-center gap-2">
                            <UploadCloudIcon className="h-4 w-4" />
                            {bot.published ? "Despublicar" : "Publicar"}
                          </span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleStatus(bot)}
                          disabled={!isAdmin || isActing}
                        >
                          <span className="flex items-center gap-2">
                            <PowerIcon className="h-4 w-4" />
                            {bot.status === "active" ? "Desativar" : "Ativar"}
                          </span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:bg-red-50"
                          onClick={() => handleDelete(bot)}
                          disabled={!isAdmin || isActing}
                        >
                          <span className="flex items-center gap-2">
                            <Trash2Icon className="h-4 w-4" />
                            Excluir
                          </span>
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
