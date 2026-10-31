"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { Button } from "../components/ui/Button";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Textarea } from "../components/ui/Textarea";
import { useClinic } from "../contexts/ClinicContext";
import { botsService } from "../services/bots";
import type { BotRow } from "../types/bots";
import {
  BOT_SESSION_TIMEOUT_DEFAULT_HOURS,
  BOT_SESSION_TIMEOUT_HOUR_OPTIONS,
} from "../types/bots";
import { BotNodesEditor } from "./BotNodesEditor";
import { BotBindingsEditor } from "./BotBindingsEditor";
import { ChevronLeft, Trash } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

type EditorTab = "general" | "nodes" | "bindings";

type BotFormValues = {
  name: string;
  description: string;
  status: BotRow["status"];
  start_message: string;
  invalid_option_message: string;
  timeout_message: string;
  session_timeout_hours: number;
  human_handoff_enabled: boolean;
  max_invalid_attempts: string;
};

type BotFormErrors = Partial<Record<keyof BotFormValues, string>>;

const DEFAULT_FORM: BotFormValues = {
  name: "",
  description: "",
  status: "inactive",
  start_message: "",
  invalid_option_message: "",
  timeout_message: "",
  session_timeout_hours: BOT_SESSION_TIMEOUT_DEFAULT_HOURS,
  human_handoff_enabled: true,
  max_invalid_attempts: "3",
};

const EDITOR_BOT_ID_STORAGE_KEY = "bots_editor_bot_id";

const parsePositiveInt = (value: string) => {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const getActiveBotConflictMessage = (activeBotName: string) =>
  `Não foi possível ativar este bot porque o bot "${activeBotName}" já está ativo. Se quiser ativar este, desative o bot que já está ativo primeiro.`;

type BotEditorPageProps = {
  mode: "new" | "edit";
};

export const BotEditorPage: React.FC<BotEditorPageProps> = ({ mode }) => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const location = useLocation();
  const { clinicId, membership } = useClinic();
  const isAdmin = membership?.role === "admin";

  const isNew = mode === "new";
  const { botId: routeBotId } = useParams<{ botId?: string }>();
  const locationState = location.state as { botId?: string } | null;
  const stateBotId = routeBotId ?? locationState?.botId ?? null;
  const [persistedBotId, setPersistedBotId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(EDITOR_BOT_ID_STORAGE_KEY);
  });

  // Se estamos no modo "new", ignoramos qualquer ID antigo
  const botId = !isNew ? (stateBotId ?? persistedBotId) : null;

  const [tab, setTab] = useState<EditorTab>("general");
  // Alterações do fluxo ainda não salvas (o editor some ao trocar de aba)
  const [flowDirty, setFlowDirty] = useState(false);

  const confirmLeaveFlow = async () => {
    if (tab !== "nodes" || !flowDirty) return true;
    const ok = await confirm({
      title: "Sair sem salvar o fluxo?",
      description: "As alterações nas etapas e nos botões serão perdidas.",
      confirmLabel: "Sair sem salvar",
      tone: "danger",
    });
    if (ok) setFlowDirty(false);
    return ok;
  };
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [bot, setBot] = useState<BotRow | null>(null);
  const [form, setForm] = useState<BotFormValues>(DEFAULT_FORM);
  const [errors, setErrors] = useState<BotFormErrors>({});

  const title = useMemo(() => {
    if (isNew) return "Criar novo bot";
    return bot?.name ? `Editar: ${bot.name}` : "Editar bot";
  }, [bot?.name, isNew]);

  const canUseDetailTabs = Boolean(bot?.id);

  useEffect(() => {
    if (isNew) {
      sessionStorage.removeItem(EDITOR_BOT_ID_STORAGE_KEY);
      setPersistedBotId(null);
      return;
    }
    if (!stateBotId) return;
    sessionStorage.setItem(EDITOR_BOT_ID_STORAGE_KEY, stateBotId);
    setPersistedBotId(stateBotId);
  }, [isNew, stateBotId]);

  const validate = useCallback(() => {
    const next: BotFormErrors = {};
    if (!form.name.trim()) next.name = "Nome é obrigatório";
    if (!form.start_message.trim())
      next.start_message = "Mensagem inicial é obrigatória";
    if (!form.invalid_option_message.trim())
      next.invalid_option_message = "Mensagem de opção inválida é obrigatória";

    const maxInvalid = parsePositiveInt(form.max_invalid_attempts);
    if (maxInvalid === null) {
      next.max_invalid_attempts = "Informe um número inteiro (mínimo 1)";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }, [form]);

  const mapBotToForm = useCallback((row: BotRow): BotFormValues => {
    return {
      name: row.name ?? "",
      description: row.description ?? "",
      status: row.status,
      start_message: row.start_message ?? "",
      invalid_option_message: row.invalid_option_message ?? "",
      timeout_message: row.timeout_message ?? "",
      session_timeout_hours:
        row.session_timeout_hours ?? BOT_SESSION_TIMEOUT_DEFAULT_HOURS,
      human_handoff_enabled: Boolean(row.human_handoff_enabled),
      max_invalid_attempts: String(row.max_invalid_attempts ?? 1),
    };
  }, []);

  const fetchBot = useCallback(async () => {
    if (!clinicId || !botId) return;
    setLoading(true);
    const res = await botsService.getBotById(clinicId, botId);
    setLoading(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    setBot(res.data);
    setForm(mapBotToForm(res.data));
    setErrors({});
  }, [botId, clinicId, mapBotToForm]);

  useEffect(() => {
    if (isNew) {
      setBot(null);
      setForm(DEFAULT_FORM);
      setErrors({});
      setLoading(false);
      return;
    }
    if (!botId) {
      setLoading(false);
      setBot(null);
      return;
    }
    fetchBot();
  }, [botId, fetchBot, isNew]);

  const handleSave = async () => {
    if (!clinicId) return;
    if (!isAdmin) {
      toast.error("Você não tem permissão para esta ação.");
      return;
    }
    if (!validate()) return;

    const maxInvalid = parsePositiveInt(form.max_invalid_attempts);
    if (!maxInvalid) return;

    // Ativar exige um fluxo que não deixe o cliente sem resposta
    const isActivating = form.status === "active" && bot?.status !== "active";
    if (bot?.id && isActivating) {
      const flowRes = await botsService.validateBotBeforeActivate(bot.id);
      if (flowRes.error) {
        toast.error(flowRes.error.message);
        return;
      }
    }

    if (form.status === "active") {
      // 🚀 CORREÇÃO AQUI: Passamos explicitamente null ou string vazia se for novo bot, evitamos undefined
      const botIdToExcept = bot?.id || "";

      const activeBotRes = await botsService.findAnotherActiveBot(
        clinicId,
        botIdToExcept,
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

    setSaving(true);
    const payload: Partial<BotRow> = {
      clinic_id: clinicId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      status: form.status,
      start_message: form.start_message.trim(),
      invalid_option_message: form.invalid_option_message.trim(),
      timeout_message: form.timeout_message.trim() || null,
      session_timeout_hours: form.session_timeout_hours,
      human_handoff_enabled: Boolean(form.human_handoff_enabled),
      max_invalid_attempts: maxInvalid,
      is_deleted: false,
    };

    const res = bot?.id
      ? await botsService.updateBot(clinicId, bot.id, payload)
      : await botsService.createBot(payload);

    setSaving(false);

    if (res.error) {
      toast.error(res.error.message);
      return;
    }

    setBot(res.data);
    setForm(mapBotToForm(res.data));

    if (!isNew) {
      toast.success("Bot salvo.");
      return;
    }

    const { data: authData } = await supabase.auth.getUser();
    const setupRes = await botsService.setupNewBot(
      clinicId,
      res.data.id,
      authData.user?.id ?? null,
    );
    if (setupRes.error) {
      toast.warn(
        `Bot criado, mas a configuração inicial falhou: ${setupRes.error.message}`,
      );
    } else if (setupRes.data.channelsBusy > 0) {
      toast.info(
        "Bot criado. O WhatsApp já está em uso por outro bot — vincule na aba Canais quando quiser trocar.",
      );
    } else if (setupRes.data.channelsLinked > 0) {
      toast.success("Bot criado e vinculado ao WhatsApp. Agora monte as etapas.");
    } else {
      toast.success("Bot criado. Agora monte as etapas.");
    }

    // Sincroniza o ID no Session Storage para evitar que recarregamentos quebrem o estado
    sessionStorage.setItem(EDITOR_BOT_ID_STORAGE_KEY, res.data.id);
    setTab("nodes");
    navigate(`/inbox/bots/edit/${res.data.id}`, { replace: true });
  };

  const handleDelete = async () => {
    if (!clinicId || !bot?.id) return;
    if (!isAdmin) {
      toast.error("Você não tem permissão para esta ação.");
      return;
    }
    const ok = await confirm({
      title: `Excluir o bot "${bot.name}"?`,
      description:
        "Ele deixa de responder e os canais vinculados ficam livres.",
      confirmLabel: "Excluir bot",
      tone: "danger",
    });
    if (!ok) return;

    setDeleting(true);
    const res = await botsService.softDeleteBot(clinicId, bot.id);
    setDeleting(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Bot excluído.");
    navigate("/inbox/bots");
  };

  const tabButton = (key: EditorTab, label: string, disabled?: boolean) => {
    const active = tab === key;
    return (
      <button
        type="button"
        onClick={async () => {
          if (key === tab || !(await confirmLeaveFlow())) return;
          setTab(key);
        }}
        disabled={disabled}
        className={[
          "shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium transition border-b-2",
          active
            ? "border-blue-600 text-blue-600"
            : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="px-4 sm:px-6 py-5 border-b bg-white">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <button
                type="button"
                onClick={async () => {
                  if (await confirmLeaveFlow()) navigate("/inbox/bots");
                }}
                className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                <ChevronLeft className="h-5 w-5" />
                <span className="pb-0.5">Voltar</span>
              </button>
              <h1 className="mt-1 break-words text-xl font-semibold text-gray-900 sm:text-2xl">
                {title}
              </h1>
              <p className="text-sm text-gray-500 sm:w-[70%]">
                Sistema de criação de bots para triagem e atendimento
                automático. Configure o fluxo de conversa, mensagens e canais de
                atendimento.
              </p>
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              {tab === "general" ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  isLoading={saving}
                  disabled={!clinicId || !isAdmin || loading}
                >
                  {isNew ? "Criar bot" : "Salvar"}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50"
                onClick={handleDelete}
                disabled={!bot?.id || !isAdmin || deleting || loading}
              >
                <span className="flex items-center gap-2">
                  <Trash size={14} />
                  {deleting ? "Excluindo..." : "Excluir"}
                </span>
              </Button>
            </div>
          </div>

          <div className="-mx-4 flex overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
            {tabButton("general", "Geral")}
            {tabButton("nodes", "Fluxo da conversa", !canUseDetailTabs)}
            {tabButton("bindings", "Canais", !canUseDetailTabs)}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-6 pb-24">
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-lg border border-slate-200 bg-white"
              />
            ))}
          </div>
        ) : !isNew && !botId ? (
          <Card className="p-4 sm:p-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Bot não identificado
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Abra a edição a partir da lista de bots para carregar os dados.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                onClick={() => navigate("/inbox/bots")}
              >
                Voltar para Bots
              </Button>
            </div>
          </Card>
        ) : tab === "general" ? (
          <div className="space-y-5">
            {!clinicId && (
              <Card className="p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-gray-900">
                  Empresa não identificada
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Aguarde o contexto de Empresa carregar para editar o bot.
                </p>
              </Card>
            )}

            {!isAdmin && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                Você está em modo somente leitura (apenas administrador pode editar bots).
              </div>
            )}

            <Card className="p-4 sm:p-6">
              <div className="flex flex-col gap-5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Dados gerais
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Campos principais usados pelo motor do bot e pela UI de triagem.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    label="Nome"
                    value={form.name}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, name: e.target.value }))
                    }
                    error={errors.name}
                    disabled={!isAdmin || saving}
                  />
                  <Input
                    label="Descrição"
                    value={form.description}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, description: e.target.value }))
                    }
                    disabled={!isAdmin || saving}
                  />
                </div>

                {isNew ? (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    O bot é criado inativo, já com a etapa inicial e vinculado
                    ao WhatsApp (se o canal não estiver em uso por outro bot).
                    Depois de montar as etapas, ative-o aqui.
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="w-full">
                      <label className="block text-sm font-medium text-[#1E1E1E] mb-1">
                        Status
                      </label>
                      <select
                        value={form.status}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, status: e.target.value as BotRow["status"] }))
                        }
                        disabled={!isAdmin || saving}
                        className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:border-transparent bg-white"
                      >
                        <option value="active">Ativo</option>
                        <option value="inactive">Inativo</option>
                      </select>
                      <div className="mt-1 text-xs text-slate-500">
                        Habilita o bot para responder mensagens nos canais conectados.
                      </div>
                    </div>

                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Input
                      label="Máx. tentativas inválidas"
                      type="number"
                      min={1}
                      step={1}
                      value={form.max_invalid_attempts}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          max_invalid_attempts: e.target.value,
                        }))
                      }
                      error={errors.max_invalid_attempts}
                      disabled={!isAdmin || saving}
                    />
                    <div className="mt-1 text-xs text-slate-500">
                      Ao atingir o limite o bot para de responder e a conversa
                      segue na fila de atendimento.
                    </div>
                  </div>

                  <div className="w-full">
                    <label className="block text-sm font-medium text-[#1E1E1E] mb-1">
                      Encerrar sessão por inatividade
                    </label>
                    <select
                      value={form.session_timeout_hours}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          session_timeout_hours: Number(e.target.value),
                        }))
                      }
                      disabled={!isAdmin || saving}
                      className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:border-transparent bg-white"
                    >
                      {BOT_SESSION_TIMEOUT_HOUR_OPTIONS.map((hours) => (
                        <option key={hours} value={hours}>
                          {hours === 1 ? "1 hora" : `${hours} horas`}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-xs text-slate-500">
                      Se o cliente parar de responder ao bot por esse tempo, a
                      sessão é encerrada e a conversa segue na fila de
                      atendimento.
                    </div>
                  </div>
                </div>

                <div>
                  <Textarea
                    label="Mensagem ao encerrar por inatividade (opcional)"
                    value={form.timeout_message}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        timeout_message: e.target.value,
                      }))
                    }
                    disabled={!isAdmin || saving}
                    placeholder="Ex: Encerramos o atendimento automático por falta de resposta. Se precisar, é só mandar uma nova mensagem."
                  />
                  <div className="mt-1 text-xs text-slate-500">
                    Enviada ao cliente quando a sessão é encerrada por tempo.
                    Em branco, o bot encerra sem avisar.
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Textarea
                    label="Mensagem de boas-vindas"
                    value={form.start_message}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, start_message: e.target.value }))
                    }
                    error={errors.start_message}
                    disabled={!isAdmin || saving}
                    placeholder="Ex: Olá! Bem-vindo. Escolha uma opção:"
                  />
                  <Textarea
                    label="Mensagem opção inválida"
                    value={form.invalid_option_message}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        invalid_option_message: e.target.value,
                      }))
                    }
                    error={errors.invalid_option_message}
                    disabled={!isAdmin || saving}
                    placeholder="Ex: Não entendi. Responda com o número de uma opção."
                  />
                </div>
              </div>
            </Card>
          </div>
        ) : !canUseDetailTabs ? (
          <Card className="p-4 sm:p-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Salve o bot primeiro
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                O fluxo da conversa e os canais ficam disponíveis depois que o bot é salvo.
              </p>
            </div>
          </Card>
        ) : tab === "nodes" ? (
          <BotNodesEditor
            clinicId={clinicId!}
            botId={bot!.id}
            isAdmin={isAdmin}
            startMessage={bot!.start_message ?? ""}
            onDirtyChange={setFlowDirty}
          />
        ) : tab === "bindings" ? (
          <BotBindingsEditor
            clinicId={clinicId!}
            botId={bot!.id}
            botStatus={bot!.status}
            isAdmin={isAdmin}
          />
        ) : null}
      </div>
    </div>
  );
};