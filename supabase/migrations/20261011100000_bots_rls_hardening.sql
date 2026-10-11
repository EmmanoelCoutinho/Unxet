-- =============================================================================
-- Bots: fecha brechas de permissão e limpa vínculos órfãos
--
-- Problemas corrigidos:
--  1. bot_nodes: qualquer membro da clínica (inclusive atendente) podia criar,
--     editar e apagar etapas do bot. bots, bot_options e bot_channel_bindings
--     já eram restritos a administradores — as etapas ficaram de fora.
--  2. conversation_bot_sessions / conversation_bot_events: qualquer membro da
--     clínica podia inserir/alterar sessões e eventos pelo cliente. Só o
--     bot-engine (service role, ignora RLS) escreve nessas tabelas.
--  3. Bots excluídos (soft delete) mantinham o vínculo ligado com o canal. O
--     índice único "um vínculo ligado por canal" então bloqueava o canal para
--     qualquer outro bot, sem nada na tela que explicasse o motivo.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. bot_nodes: escrita apenas para administradores da clínica
-- -----------------------------------------------------------------------------
drop policy if exists "bot_nodes_insert" on public.bot_nodes;
drop policy if exists "bot_nodes_update" on public.bot_nodes;
drop policy if exists "bot_nodes_delete" on public.bot_nodes;

create policy "bot_nodes_insert" on public.bot_nodes
  for insert to authenticated
  with check (public.user_can_manage_clinic(clinic_id));

create policy "bot_nodes_update" on public.bot_nodes
  for update to authenticated
  using (public.user_can_manage_clinic(clinic_id))
  with check (public.user_can_manage_clinic(clinic_id));

create policy "bot_nodes_delete" on public.bot_nodes
  for delete to authenticated
  using (public.user_can_manage_clinic(clinic_id));

-- -----------------------------------------------------------------------------
-- 2. Sessões e eventos do bot: somente leitura para os usuários
-- -----------------------------------------------------------------------------
drop policy if exists "conversation_bot_sessions_insert" on public.conversation_bot_sessions;
drop policy if exists "conversation_bot_sessions_update" on public.conversation_bot_sessions;
drop policy if exists "conversation_bot_events_insert" on public.conversation_bot_events;

-- -----------------------------------------------------------------------------
-- 3. Bots excluídos: desligar e liberar os canais que ainda ocupavam
-- -----------------------------------------------------------------------------
update public.bot_channel_bindings b
   set enabled = false
  from public.bots bot
 where bot.id = b.bot_id
   and bot.is_deleted = true
   and b.enabled = true;

update public.bots
   set status = 'inactive',
       published = false
 where is_deleted = true
   and (status <> 'inactive' or published = true);

commit;
