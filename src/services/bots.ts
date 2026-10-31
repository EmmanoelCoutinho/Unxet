import { supabase } from "../lib/supabaseClient";
import type {
  BotChannelBindingRow,
  BotNodeRow,
  BotOptionRow,
  BotRow,
  ChannelConnectionRow,
  DepartmentRow,
  TagRow,
  CreateBotNodeInput,
  UpdateBotNodeInput,
  CreateBotOptionInput,
  UpdateBotOptionInput,
  UpsertBotChannelBindingInput,
} from "../types/bots";
import { BOT_ROOT_NODE_KEY, isBotSupportedChannel } from "../types/bots";

type SupabaseResult<T> =
  | { data: T; error: null }
  | { data: null; error: Error };

type SupabaseLikeError = {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
  ux_bot_channel_bindings_one_active_per_channel:
    "Este canal já está vinculado a outro bot. Desvincule o outro bot primeiro.",
  bot_nodes_bot_id_node_key_key:
    "Já existe uma etapa com essa chave neste bot.",
  bot_options_bot_node_id_option_value_key:
    "Já existe uma opção com esse valor nesta etapa.",
};

const getFriendlySupabaseErrorMessage = (error: SupabaseLikeError) => {
  if (error.code === "23505") {
    for (const [constraint, message] of Object.entries(
      UNIQUE_CONSTRAINT_MESSAGES,
    )) {
      if (error.message?.includes(constraint)) return message;
    }
  }

  return error.message ?? null;
};

// Nunca inclua access_token / evolution_api_key aqui
const CHANNEL_CONNECTION_COLUMNS =
  "id,clinic_id,provider,channel,status,connected_phone,connected_name,display_name,updated_at";

const isSupabaseLikeError = (error: unknown): error is SupabaseLikeError =>
  typeof error === "object" && error !== null;

const asError = (error: unknown) => {
  if (error instanceof Error) return error;

  if (isSupabaseLikeError(error)) {
    const message =
      getFriendlySupabaseErrorMessage(error) ??
      error.details ??
      error.hint ??
      "Ocorreu um erro ao processar a operação.";

    return new Error(message);
  }

  return new Error(String(error));
};

export const botsService = {
  async findAnotherActiveBot(
    clinicId: string,
    currentBotId?: string | null,
  ): Promise<SupabaseResult<BotRow | null>> {
    try {
      // 1. Monte a query base com as condições fixas
      let query = supabase
        .from("bots")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("is_deleted", false)
        .eq("status", "active");

      // 2. SÓ adiciona o filtro 'neq' se o ID for válido e não for uma string vazia 🚀
      if (currentBotId && currentBotId.trim() !== "") {
        query = query.neq("id", currentBotId);
      }

      // 3. Aplica o ordenamento, limite e executa
      const { data, error } = await query
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return { data: null, error: asError(error) };
      return { data: (data as BotRow | null) ?? null, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  // Lista os problemas que deixariam o cliente preso ou sem resposta no fluxo
  async validateBotFlow(botId: string): Promise<SupabaseResult<string[]>> {
    try {
      const nodesRes = await this.listNodes(botId);
      if (nodesRes.error) return { data: null, error: nodesRes.error };

      const nodes = nodesRes.data;
      const optsRes = await this.listOptionsByNodeIds(nodes.map((n) => n.id));
      if (optsRes.error) return { data: null, error: optsRes.error };

      const problems: string[] = [];
      const root = nodes.find((n) => n.node_key === BOT_ROOT_NODE_KEY) ?? null;

      if (!root) {
        problems.push("Crie a etapa inicial do fluxo.");
      } else if (
        root.node_type !== "ai" &&
        (optsRes.data[root.id] ?? []).length === 0
      ) {
        problems.push("A etapa inicial precisa ter ao menos uma opção.");
      }

      for (const node of nodes) {
        const where = `Etapa "${node.title || node.node_key}"`;
        // Etapa de IA não tem botões e a abertura é opcional
        if (node.node_type === "ai") {
          if (!node.ai_instructions?.trim()) {
            problems.push(`${where}: escreva o objetivo da IA.`);
          }
          continue;
        }
        if (!node.message?.trim()) problems.push(`${where}: sem mensagem.`);

        for (const opt of optsRes.data[node.id] ?? []) {
          const optWhere = `${where}, botão "${opt.label || opt.option_value}"`;
          if (opt.action_type === "go_to_node" && !opt.next_node_id) {
            problems.push(`${optWhere}: escolha qual etapa abrir.`);
          } else if (
            opt.action_type === "transfer_to_department" &&
            !opt.target_department_id
          ) {
            problems.push(`${optWhere}: escolha o setor.`);
          } else if (opt.action_type === "add_tag" && !opt.tag_id) {
            problems.push(`${optWhere}: escolha a etiqueta.`);
          } else if (
            // Com etiqueta a resposta é opcional (o botão marca e reenvia o menu)
            opt.action_type === "send_message" &&
            !opt.message_to_send?.trim() &&
            !opt.tag_id
          ) {
            problems.push(`${optWhere}: escreva a resposta.`);
          }
        }
      }

      return { data: problems, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async validateBotBeforeActivate(
    botId: string,
  ): Promise<SupabaseResult<{ ok: true }>> {
    const res = await this.validateBotFlow(botId);
    if (res.error) return { data: null, error: res.error };

    if (res.data.length > 0) {
      const shown = res.data.slice(0, 3).join(" ");
      const rest = res.data.length - 3;
      return {
        data: null,
        error: new Error(
          `Corrija o fluxo antes de continuar: ${shown}${rest > 0 ? ` (+${rest})` : ""}`,
        ),
      };
    }

    return { data: { ok: true }, error: null };
  },

  async listBots(clinicId: string): Promise<SupabaseResult<BotRow[]>> {
    try {
      const { data, error } = await supabase
        .from("bots")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("is_deleted", false)
        .order("updated_at", { ascending: false });

      if (error) return { data: null, error: asError(error) };
      return { data: (data ?? []) as BotRow[], error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async getBotById(
    clinicId: string,
    botId: string,
  ): Promise<SupabaseResult<BotRow>> {
    try {
      const { data, error } = await supabase
        .from("bots")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("id", botId)
        .eq("is_deleted", false)
        .maybeSingle();

      if (error) return { data: null, error: asError(error) };
      if (!data) return { data: null, error: new Error("Bot não encontrado.") };

      return { data: data as BotRow, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async createBot(payload: Partial<BotRow>): Promise<SupabaseResult<BotRow>> {
    try {
      const { data, error } = await supabase
        .from("bots")
        .insert(payload)
        .select("*")
        .single();

      if (error) return { data: null, error: asError(error) };
      return { data: data as BotRow, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async updateBot(
    clinicId: string,
    botId: string,
    payload: Partial<BotRow>,
  ): Promise<SupabaseResult<BotRow>> {
    try {
      const { data, error } = await supabase
        .from("bots")
        .update(payload)
        .eq("id", botId)
        .eq("clinic_id", clinicId)
        .select("*")
        .single();

      if (error) return { data: null, error: asError(error) };
      return { data: data as BotRow, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async softDeleteBot(
    clinicId: string,
    botId: string,
  ): Promise<SupabaseResult<BotRow>> {
    // Um vínculo ligado de bot excluído continuaria ocupando o canal
    // (índice único por canal) sem aparecer em nenhuma tela.
    try {
      const { error } = await supabase
        .from("bot_channel_bindings")
        .update({ enabled: false })
        .eq("clinic_id", clinicId)
        .eq("bot_id", botId);
      if (error) return { data: null, error: asError(error) };
    } catch (e) {
      return { data: null, error: asError(e) };
    }

    return this.updateBot(clinicId, botId, {
      is_deleted: true,
      status: "inactive",
      published: false,
    });
  },

  // Etapa inicial + WhatsApp já ligado, para o bot novo sair pronto para editar
  async setupNewBot(
    clinicId: string,
    botId: string,
    createdBy: string | null,
  ): Promise<SupabaseResult<{ channelsLinked: number; channelsBusy: number }>> {
    try {
      const rootRes = await this.createNode({
        bot_id: botId,
        clinic_id: clinicId,
        node_key: BOT_ROOT_NODE_KEY,
        title: "Etapa inicial",
        message: "Escolha uma opção:",
        node_type: "menu",
        sort_order: 1,
      });
      if (rootRes.error) return { data: null, error: rootRes.error };

      const [connRes, enabledRes] = await Promise.all([
        this.listChannelConnections(clinicId),
        this.listEnabledBindings(clinicId),
      ]);
      if (connRes.error) return { data: null, error: connRes.error };
      if (enabledRes.error) return { data: null, error: enabledRes.error };

      const busy = new Set(enabledRes.data.map((b) => b.channel_connection_id));
      const supported = connRes.data.filter((c) =>
        isBotSupportedChannel(c.channel),
      );
      const free = supported.filter((c) => !busy.has(c.id));

      if (free.length > 0) {
        const { error } = await supabase.from("bot_channel_bindings").insert(
          free.map((c) => ({
            clinic_id: clinicId,
            bot_id: botId,
            channel_connection_id: c.id,
            enabled: true,
            trigger_type: "first_inbound",
            created_by: createdBy,
          })),
        );
        if (error) return { data: null, error: asError(error) };
      }

      return {
        data: {
          channelsLinked: free.length,
          channelsBusy: supported.length - free.length,
        },
        error: null,
      };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async duplicateBot(
    clinicId: string,
    botId: string,
  ): Promise<SupabaseResult<BotRow>> {
    try {
      const botRes = await this.getBotById(clinicId, botId);
      if (botRes.error) return botRes;

      const nodesRes = await this.listNodes(botId);
      if (nodesRes.error) return { data: null, error: nodesRes.error };

      const oldNodes = nodesRes.data ?? [];
      const optionsRes = await this.listOptionsByNodeIds(
        oldNodes.map((n) => n.id),
      );
      if (optionsRes.error) return { data: null, error: optionsRes.error };
      const oldOptionsByNodeId = new Map<string, BotOptionRow[]>(
        Object.entries(optionsRes.data),
      );

      const sourceBot = botRes.data;

      const { data: createdBot, error: createBotErr } = await supabase
        .from("bots")
        .insert({
          clinic_id: clinicId,
          name: `${sourceBot.name} (cópia)`,
          description: sourceBot.description,
          // A cópia nasce desligada: só pode haver um bot ativo
          status: "inactive",
          type: sourceBot.type,
          published: false,
          start_message: sourceBot.start_message,
          invalid_option_message: sourceBot.invalid_option_message,
          timeout_message: sourceBot.timeout_message,
          human_handoff_enabled: sourceBot.human_handoff_enabled,
          max_invalid_attempts: sourceBot.max_invalid_attempts,
          is_deleted: false,
        })
        .select("*")
        .single();

      if (createBotErr) return { data: null, error: asError(createBotErr) };

      const newBot = createdBot as BotRow;

      const nodePayloads: CreateBotNodeInput[] = oldNodes.map((n) => ({
        bot_id: newBot.id,
        clinic_id: clinicId,
        node_key: n.node_key,
        title: n.title,
        message: n.message,
        node_type: n.node_type,
        sort_order: n.sort_order,
        ai_instructions: n.ai_instructions ?? null,
        ai_handoff_department_id: n.ai_handoff_department_id ?? null,
      }));

      if (nodePayloads.length === 0) return { data: newBot, error: null };

      const { data: createdNodes, error: createNodesErr } = await supabase
        .from("bot_nodes")
        .insert(nodePayloads)
        .select("*");

      if (createNodesErr) return { data: null, error: asError(createNodesErr) };

      const createdNodesRows = (createdNodes ?? []) as BotNodeRow[];
      const newNodeByOldNodeId = new Map<string, string>();
      const createdNodeByKey = new Map<string, BotNodeRow>();

      for (const n of createdNodesRows) {
        createdNodeByKey.set(n.node_key, n);
      }

      for (const oldNode of oldNodes) {
        const match =
          createdNodeByKey.get(oldNode.node_key) ??
          createdNodesRows.find(
            (n) =>
              n.node_key === oldNode.node_key &&
              n.sort_order === oldNode.sort_order,
          );

        if (match) {
          newNodeByOldNodeId.set(oldNode.id, match.id);
        }
      }

      const optionPayloads: CreateBotOptionInput[] = [];

      for (const [oldNodeId, oldOptions] of oldOptionsByNodeId.entries()) {
        const newNodeId = newNodeByOldNodeId.get(oldNodeId);
        if (!newNodeId) continue;

        for (const opt of oldOptions) {
          optionPayloads.push({
            bot_node_id: newNodeId,
            clinic_id: clinicId,
            option_value: opt.option_value,
            label: opt.label,
            action_type: opt.action_type,
            next_node_id: opt.next_node_id
              ? (newNodeByOldNodeId.get(opt.next_node_id) ?? null)
              : null,
            target_department_id: opt.target_department_id,
            tag_id: opt.tag_id,
            message_to_send: opt.message_to_send,
            end_session: opt.end_session,
            sort_order: opt.sort_order,
          });
        }
      }

      if (optionPayloads.length > 0) {
        const { error: createOptionsErr } = await supabase
          .from("bot_options")
          .insert(optionPayloads);

        if (createOptionsErr) {
          return { data: null, error: asError(createOptionsErr) };
        }
      }

      // Vínculos com canais não são copiados: cada canal aceita um único bot
      return { data: newBot, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async listNodes(botId: string): Promise<SupabaseResult<BotNodeRow[]>> {
    try {
      const { data, error } = await supabase
        .from("bot_nodes")
        .select("*")
        .eq("bot_id", botId)
        .order("sort_order", { ascending: true });

      if (error) return { data: null, error: asError(error) };
      return { data: (data ?? []) as BotNodeRow[], error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async createNode(
    payload: CreateBotNodeInput,
  ): Promise<SupabaseResult<BotNodeRow>> {
    try {
      const { data, error } = await supabase
        .from("bot_nodes")
        .insert(payload)
        .select("*")
        .single();

      if (error) return { data: null, error: asError(error) };
      return { data: data as BotNodeRow, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async updateNode(
    nodeId: string,
    payload: UpdateBotNodeInput,
  ): Promise<SupabaseResult<BotNodeRow>> {
    try {
      const { data, error } = await supabase
        .from("bot_nodes")
        .update(payload)
        .eq("id", nodeId)
        .select("*")
        .single();

      if (error) return { data: null, error: asError(error) };
      return { data: data as BotNodeRow, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async deleteNode(nodeId: string): Promise<SupabaseResult<true>> {
    try {
      const { error } = await supabase
        .from("bot_nodes")
        .delete()
        .eq("id", nodeId);

      if (error) return { data: null, error: asError(error) };
      return { data: true, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async listOptions(nodeId: string): Promise<SupabaseResult<BotOptionRow[]>> {
    try {
      const { data, error } = await supabase
        .from("bot_options")
        .select("*")
        .eq("bot_node_id", nodeId)
        .order("sort_order", { ascending: true });

      if (error) return { data: null, error: asError(error) };
      return { data: (data ?? []) as BotOptionRow[], error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async listOptionsByNodeIds(
    nodeIds: string[],
  ): Promise<SupabaseResult<Record<string, BotOptionRow[]>>> {
    try {
      const byNodeId: Record<string, BotOptionRow[]> = {};
      for (const id of nodeIds) byNodeId[id] = [];
      if (nodeIds.length === 0) return { data: byNodeId, error: null };

      const { data, error } = await supabase
        .from("bot_options")
        .select("*")
        .in("bot_node_id", nodeIds)
        .order("sort_order", { ascending: true });

      if (error) return { data: null, error: asError(error) };
      for (const opt of (data ?? []) as BotOptionRow[]) {
        (byNodeId[opt.bot_node_id] ??= []).push(opt);
      }
      return { data: byNodeId, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async createOption(
    payload: CreateBotOptionInput,
  ): Promise<SupabaseResult<BotOptionRow>> {
    try {
      const { data, error } = await supabase
        .from("bot_options")
        .insert(payload)
        .select("*")
        .single();

      if (error) return { data: null, error: asError(error) };
      return { data: data as BotOptionRow, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async updateOption(
    optionId: string,
    payload: UpdateBotOptionInput,
  ): Promise<SupabaseResult<BotOptionRow>> {
    try {
      const { data, error } = await supabase
        .from("bot_options")
        .update(payload)
        .eq("id", optionId)
        .select("*")
        .single();

      if (error) return { data: null, error: asError(error) };
      return { data: data as BotOptionRow, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async deleteOption(optionId: string): Promise<SupabaseResult<true>> {
    try {
      const { error } = await supabase
        .from("bot_options")
        .delete()
        .eq("id", optionId);

      if (error) return { data: null, error: asError(error) };
      return { data: true, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async listBindings(
    clinicId: string,
    botId: string,
  ): Promise<SupabaseResult<BotChannelBindingRow[]>> {
    try {
      const { data, error } = await supabase
        .from("bot_channel_bindings")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("bot_id", botId);

      if (error) return { data: null, error: asError(error) };
      return { data: (data ?? []) as BotChannelBindingRow[], error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  // Vínculos ligados de bots não excluídos (ativos ou não): é o que ocupa o canal
  async listEnabledBindings(
    clinicId: string,
  ): Promise<
    SupabaseResult<
      Array<{ bot_id: string; channel_connection_id: string; bot_name: string }>
    >
  > {
    try {
      const { data, error } = await supabase
        .from("bot_channel_bindings")
        .select("bot_id,channel_connection_id,bots!inner(name,is_deleted)")
        .eq("clinic_id", clinicId)
        .eq("enabled", true)
        .eq("bots.is_deleted", false);

      if (error) return { data: null, error: asError(error) };

      const rows = (data ?? []) as unknown as Array<{
        bot_id: string;
        channel_connection_id: string;
        bots: { name: string } | Array<{ name: string }> | null;
      }>;

      return {
        data: rows.map((r) => ({
          bot_id: r.bot_id,
          channel_connection_id: r.channel_connection_id,
          bot_name:
            (Array.isArray(r.bots) ? r.bots[0]?.name : r.bots?.name) ?? "",
        })),
        error: null,
      };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async disableBinding(
    clinicId: string,
    botId: string,
    channelConnectionId: string,
  ): Promise<SupabaseResult<true>> {
    try {
      const { error } = await supabase
        .from("bot_channel_bindings")
        .update({ enabled: false })
        .eq("clinic_id", clinicId)
        .eq("bot_id", botId)
        .eq("channel_connection_id", channelConnectionId);

      if (error) return { data: null, error: asError(error) };
      return { data: true, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async upsertBinding(
    payload: UpsertBotChannelBindingInput,
  ): Promise<SupabaseResult<BotChannelBindingRow[]>> {
    try {
      const { data, error } = await supabase
        .from("bot_channel_bindings")
        .upsert(payload, {
          onConflict: "bot_id,channel_connection_id",
        })
        .select("*");

      if (error) return { data: null, error: asError(error) };
      return { data: (data ?? []) as BotChannelBindingRow[], error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async deleteBinding(
    clinicId: string,
    botId: string,
    channelConnectionId: string,
  ): Promise<SupabaseResult<true>> {
    try {
      const { error } = await supabase
        .from("bot_channel_bindings")
        .delete()
        .eq("clinic_id", clinicId)
        .eq("bot_id", botId)
        .eq("channel_connection_id", channelConnectionId);

      if (error) return { data: null, error: asError(error) };
      return { data: true, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async listChannelConnections(
    clinicId: string,
  ): Promise<SupabaseResult<ChannelConnectionRow[]>> {
    try {
      const { data, error } = await supabase
        .from("channel_connections")
        .select(CHANNEL_CONNECTION_COLUMNS)
        .eq("clinic_id", clinicId)
        // Número removido não recebe mais mensagens: não faz sentido vincular bot
        .is("archived_at", null)
        .order("updated_at", { ascending: false });

      if (error) return { data: null, error: asError(error) };
      return { data: (data ?? []) as ChannelConnectionRow[], error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async listDepartments(
    clinicId: string,
  ): Promise<SupabaseResult<DepartmentRow[]>> {
    try {
      const { data, error } = await supabase
        .from("departments")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("name", { ascending: true });

      if (error) return { data: null, error: asError(error) };
      return { data: (data ?? []) as DepartmentRow[], error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },

  async listTags(clinicId: string): Promise<SupabaseResult<TagRow[]>> {
    try {
      const { data, error } = await supabase
        .from("tags")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("name", { ascending: true });

      if (error) return { data: null, error: asError(error) };
      return { data: (data ?? []) as TagRow[], error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  },
};