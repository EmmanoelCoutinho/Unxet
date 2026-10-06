-- =============================================================================
-- Correção de isolamento entre clínicas (multi-tenant) e escalonamento de papel
--
-- Problemas corrigidos:
--  1. Qualquer usuário autenticado podia inserir a si mesmo em QUALQUER clínica
--     (inclusive como admin) e alterar o próprio role/clinic_id.
--  2. Conversas sem responsável (e suas mensagens/contatos) eram visíveis e
--     editáveis por usuários de QUALQUER clínica.
--  3. Inserção de conversas, contatos e mensagens sem checar a clínica.
--  4. mass_campaigns / mass_messages_queue sem clinic_id e com policy USING (true).
--  5. Funções SECURITY DEFINER (pgmq, jobs) executáveis pelo papel anon.
--
-- As policies "clinic members read ..." / "*_by_clinic" já existentes continuam
-- garantindo o acesso legítimo dos membros da própria clínica.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. clinic_users: impedir auto-inscrição e auto-promoção
-- -----------------------------------------------------------------------------
-- Membros são criados pela edge function invite-attendant (service role).
drop policy if exists "clinic_users_insert_own" on public.clinic_users;

-- O próprio usuário ainda pode atualizar seus dados (ex.: nome, accepted_at),
-- mas não role nem clinic_id — garantido pelo trigger abaixo.
create or replace function public.prevent_clinic_user_privilege_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service role / jobs internos não têm auth.uid()
  if auth.uid() is null then
    return new;
  end if;

  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'clinic_id não pode ser alterado';
  end if;

  if new.role is distinct from old.role then
    if not exists (
      select 1
      from public.clinic_users cu
      where cu.user_id = auth.uid()
        and cu.clinic_id = old.clinic_id
        and cu.role = 'admin'
    ) then
      raise exception 'Apenas administradores podem alterar o papel';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_clinic_user_privilege_change on public.clinic_users;
create trigger trg_prevent_clinic_user_privilege_change
  before update on public.clinic_users
  for each row execute function public.prevent_clinic_user_privilege_change();

-- -----------------------------------------------------------------------------
-- 2. Remover leitura cross-tenant de conversas / mensagens / contatos
-- -----------------------------------------------------------------------------
drop policy if exists "conversations_select_available_or_owned" on public.conversations;
drop policy if exists "messages_select_available_or_owned_conversations" on public.messages;
drop policy if exists "contacts_select_by_visible_conversations" on public.contacts;

-- -----------------------------------------------------------------------------
-- 3. Escrita restrita à própria clínica
-- -----------------------------------------------------------------------------
drop policy if exists "conversations_update_assign_or_own" on public.conversations;
create policy "conversations_update_assign_or_own"
  on public.conversations
  for update
  to authenticated
  using (
    public.is_clinic_member(clinic_id)
    and (assigned_user_id is null or assigned_user_id = auth.uid())
  )
  with check (
    public.is_clinic_member(clinic_id)
    and assigned_user_id = auth.uid()
  );

drop policy if exists "conversations_insert_authenticated" on public.conversations;
create policy "conversations_insert_clinic_members"
  on public.conversations
  for insert
  to authenticated
  with check (public.is_clinic_member(clinic_id));

drop policy if exists "contacts_insert_authenticated" on public.contacts;
create policy "contacts_insert_clinic_members"
  on public.contacts
  for insert
  to authenticated
  with check (public.is_clinic_member(clinic_id));

-- Mantém apenas "messages_insert_owned_conversations" (responsável pela conversa)
drop policy if exists "allow insert messages for authenticated" on public.messages;

-- -----------------------------------------------------------------------------
-- 4. Mensagens em massa: vincular à clínica
-- -----------------------------------------------------------------------------
-- Registros antigos ficam com clinic_id nulo e deixam de ser visíveis pelo app;
-- se necessário, preencha manualmente antes de aplicar.
alter table public.mass_campaigns
  add column if not exists clinic_id uuid references public.clinics(id)
  default public.current_clinic_id();

alter table public.mass_messages_queue
  add column if not exists clinic_id uuid references public.clinics(id)
  default public.current_clinic_id();

drop policy if exists "Permitir tudo para usuários autenticados" on public.mass_campaigns;
create policy "mass_campaigns_clinic_members"
  on public.mass_campaigns
  for all
  to authenticated
  using (public.is_clinic_member(clinic_id))
  with check (public.is_clinic_member(clinic_id));

drop policy if exists "Permitir tudo para usuários autenticados" on public.mass_messages_queue;
create policy "mass_messages_queue_clinic_members"
  on public.mass_messages_queue
  for all
  to authenticated
  using (public.is_clinic_member(clinic_id))
  with check (public.is_clinic_member(clinic_id));

-- Enfileiramento validado: só a fila "mass_messages", só contatos da clínica
-- do usuário, e o telefone vem do cadastro (não do cliente).
create or replace function public.send_mass_messages_to_queue(
  p_queue_name text,
  p_msgs jsonb
)
returns bigint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid := public.current_clinic_id();
  item jsonb;
  v_phone text;
  msg_id bigint;
  ids bigint[] := '{}';
begin
  if auth.uid() is null or v_clinic_id is null then
    raise exception 'Não autorizado';
  end if;

  if p_queue_name is distinct from 'mass_messages' then
    raise exception 'Fila inválida';
  end if;

  for item in select * from jsonb_array_elements(p_msgs) loop
    select c.phone
      into v_phone
      from public.contacts c
     where c.id = (item->>'contact_id')::uuid
       and c.clinic_id = v_clinic_id;

    if v_phone is null then
      raise exception 'Contato inválido para esta clínica';
    end if;

    if (item->>'campaign_id') is not null and not exists (
      select 1 from public.mass_campaigns mc
       where mc.id = (item->>'campaign_id')::uuid
         and mc.clinic_id = v_clinic_id
    ) then
      raise exception 'Campanha inválida para esta clínica';
    end if;

    item := item
      || jsonb_build_object('phone_text', v_phone, 'clinic_id', v_clinic_id);

    msg_id := pgmq.send('mass_messages', item);
    ids := array_append(ids, msg_id);
  end loop;

  return ids;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Funções internas: sem acesso de anon / usuários finais
-- -----------------------------------------------------------------------------
revoke execute on function public.enqueue_message(text, jsonb) from public, anon, authenticated;
revoke execute on function public.enqueue_message_batch(text, jsonb[]) from public, anon, authenticated;
revoke execute on function public.job_conversation_auto_close() from public, anon, authenticated;
revoke execute on function public.job_conversation_return_to_pending() from public, anon, authenticated;
revoke execute on function public.job_conversation_sla_first_response() from public, anon, authenticated;
revoke execute on function public.claim_transcription_jobs(integer) from public, anon, authenticated;
revoke execute on function public.prevent_clinic_user_privilege_change() from public, anon, authenticated;

revoke execute on function public.send_mass_messages_to_queue(text, jsonb) from public, anon;
grant execute on function public.send_mass_messages_to_queue(text, jsonb) to authenticated;

-- Novas funções não ficam mais executáveis por anon automaticamente
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

commit;
