-- =============================================================================
-- Isolamento por departamento (mesma regra do envio de mensagens)
--
-- Um usuário enxerga uma conversa quando:
--   - é admin da clínica da conversa; ou
--   - é o responsável (assigned_user_id) pela conversa; ou
--   - a conversa está sem responsável e ele é membro do departamento dela
--     (department_members ou clinic_users.department_id legado).
--
-- Antes, qualquer membro da clínica lia todas as conversas/mensagens; o filtro
-- por departamento existia apenas na interface.
-- Contatos (carteira de clientes) continuam visíveis para toda a clínica.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Funções de acesso (SECURITY DEFINER evita recursão de RLS em conversations)
-- -----------------------------------------------------------------------------
create or replace function public.can_access_conversation(
  p_clinic_id uuid,
  p_department_id uuid,
  p_assigned_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.user_id = auth.uid()
      and cu.clinic_id = p_clinic_id
      and (
        cu.role = 'admin'
        or p_assigned_user_id = auth.uid()
        or (
          p_assigned_user_id is null
          and (
            cu.department_id = p_department_id
            or exists (
              select 1
              from public.department_members dm
              where dm.department_id = p_department_id
                and dm.clinic_user_id = auth.uid()
            )
          )
        )
      )
  );
$$;

create or replace function public.can_access_conversation_id(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_access_conversation(c.clinic_id, c.department_id, c.assigned_user_id)
    from public.conversations c
    where c.id = p_conversation_id
  ), false);
$$;

revoke execute on function public.can_access_conversation(uuid, uuid, uuid) from public, anon;
revoke execute on function public.can_access_conversation_id(uuid) from public, anon;
grant execute on function public.can_access_conversation(uuid, uuid, uuid) to authenticated;
grant execute on function public.can_access_conversation_id(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- conversations
-- -----------------------------------------------------------------------------
drop policy if exists "clinic members read conversations" on public.conversations;
drop policy if exists "conversations_by_clinic" on public.conversations;
drop policy if exists "conversations_select_clinic_members" on public.conversations;
drop policy if exists "users read conversations from their clinic" on public.conversations;
drop policy if exists "conversations_select_available_or_owned" on public.conversations;

create policy "conversations_select_by_access"
  on public.conversations
  for select
  to authenticated
  using (public.can_access_conversation(clinic_id, department_id, assigned_user_id));

drop policy if exists "conversations_update_assign_or_own" on public.conversations;
create policy "conversations_update_assign_or_own"
  on public.conversations
  for update
  to authenticated
  using (
    public.can_access_conversation(clinic_id, department_id, assigned_user_id)
    and (assigned_user_id is null or assigned_user_id = auth.uid())
  )
  with check (
    public.is_clinic_member(clinic_id)
    and assigned_user_id = auth.uid()
  );

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
drop policy if exists "clinic members read messages" on public.messages;
drop policy if exists "users read messages from their clinic" on public.messages;
drop policy if exists "messages_select_via_conversation_access" on public.messages;
drop policy if exists "messages_select_available_or_owned_conversations" on public.messages;

create policy "messages_select_by_access"
  on public.messages
  for select
  to authenticated
  using (public.can_access_conversation_id(conversation_id));

-- -----------------------------------------------------------------------------
-- conversation_events
-- -----------------------------------------------------------------------------
drop policy if exists "conversation_events_select_by_clinic" on public.conversation_events;
create policy "conversation_events_select_by_access"
  on public.conversation_events
  for select
  to authenticated
  using (public.can_access_conversation_id(conversation_id));

drop policy if exists "conversation_events_insert_by_clinic" on public.conversation_events;
create policy "conversation_events_insert_by_access"
  on public.conversation_events
  for insert
  to authenticated
  with check (public.can_access_conversation_id(conversation_id));

-- -----------------------------------------------------------------------------
-- conversation_tags
-- -----------------------------------------------------------------------------
drop policy if exists "conversation_tags_select" on public.conversation_tags;
drop policy if exists "conversation_tags_select_visible" on public.conversation_tags;
create policy "conversation_tags_select_by_access"
  on public.conversation_tags
  for select
  to authenticated
  using (public.can_access_conversation_id(conversation_id));

drop policy if exists "conversation_tags_insert" on public.conversation_tags;
drop policy if exists "conversation_tags_insert_owned" on public.conversation_tags;
create policy "conversation_tags_insert_by_access"
  on public.conversation_tags
  for insert
  to authenticated
  with check (
    public.can_access_conversation_id(conversation_id)
    and exists (
      select 1
      from public.tags t
      join public.conversations c on c.id = conversation_tags.conversation_id
      where t.id = conversation_tags.tag_id
        and t.clinic_id = c.clinic_id
    )
  );

drop policy if exists "conversation_tags_delete" on public.conversation_tags;
create policy "conversation_tags_delete_by_access"
  on public.conversation_tags
  for delete
  to authenticated
  using (public.can_access_conversation_id(conversation_id));

commit;
