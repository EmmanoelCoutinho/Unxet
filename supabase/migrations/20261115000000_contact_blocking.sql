-- =============================================================================
-- Bloquear contato
--
-- A empresa bloqueia um cliente (ou um número que ainda nem escreveu) e, a
-- partir daí:
--   - as mensagens dele são descartadas na entrada (evolution-in, meta-webhook
--     e meta-in), antes de criar conversa, acionar bot ou IA;
--   - a empresa também não envia para ele (iniciar conversa, responder,
--     campanhas e mensagens agendadas).
--
-- O bloqueio fica no próprio contato (contacts.blocked_at): acompanha a troca
-- de telefone na Carteira e vale para todos os números da empresa. Bloquear um
-- número que não está na carteira cria o contato já bloqueado.
--
-- Permissão nova: contacts.block (administrador sempre tem).
--
-- Ordem de deploy: aplique ANTES das edge functions e do front.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Permissão nova no catálogo (mesma lista de src/modules/roles/permissions.ts)
-- -----------------------------------------------------------------------------
create or replace function public.clinic_permission_catalog()
returns text[]
language sql
immutable
as $$
  select array[
    'conversations.all',
    'dashboard.view',
    'quick_messages.manage',
    'tags.manage',
    'file_library.manage',
    'contacts.block',
    'contacts.view',
    'leads.all',
    'campaigns.all',
    'meta_templates.create',
    'bots.manage',
    'ai.manage',
    'reports.view'
  ]::text[];
$$;

-- -----------------------------------------------------------------------------
-- 2. Colunas
-- -----------------------------------------------------------------------------
alter table public.contacts
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_by uuid references auth.users(id) on delete set null,
  add column if not exists blocked_reason text,
  -- Quantas mensagens foram barradas desde o bloqueio e quando foi a última
  add column if not exists blocked_messages integer not null default 0,
  add column if not exists last_blocked_message_at timestamptz;

alter table public.contacts
  drop constraint if exists contacts_blocked_reason_length,
  add constraint contacts_blocked_reason_length
    check (blocked_reason is null or char_length(blocked_reason) <= 300);

create index if not exists contacts_clinic_blocked_idx
  on public.contacts (clinic_id, blocked_at desc)
  where blocked_at is not null;

-- -----------------------------------------------------------------------------
-- 3. Mesmo celular brasileiro com e sem o 9 (igual a brazilianPhoneVariants
--    de supabase/functions/_shared/startConversation.ts). Identificador que
--    não é telefone (ex.: "instagram:123") volta como veio.
-- -----------------------------------------------------------------------------
create or replace function public.contact_identifier_variants(p_identifier text)
returns text[]
language sql
immutable
as $$
  select case
    when p_identifier ~ '^55\d{2}9\d{8}$'
      then array[p_identifier, substr(p_identifier, 1, 4) || substr(p_identifier, 6)]
    when p_identifier ~ '^55\d{2}[6-9]\d{7}$'
      then array[p_identifier, substr(p_identifier, 1, 4) || '9' || substr(p_identifier, 5)]
    else array[p_identifier]
  end;
$$;

-- Contatos bloqueados da empresa que batem com algum dos identificadores
create or replace function public.blocked_contact_ids(p_clinic_id uuid, p_identifiers text[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with wanted as (
    select distinct v as identifier
    from unnest(coalesce(p_identifiers, '{}'::text[])) as i(identifier)
    cross join lateral unnest(public.contact_identifier_variants(btrim(i.identifier))) as v
    where btrim(coalesce(i.identifier, '')) <> ''
  )
  select c.id
  from public.contacts c
  where c.clinic_id = p_clinic_id
    and c.blocked_at is not null
    and (
      c.phone in (select identifier from wanted)
      or c.meta_contact_id in (select identifier from wanted)
    );
$$;

-- Para as edge functions de envio: este número/contato está bloqueado?
create or replace function public.is_contact_identifier_blocked(p_clinic_id uuid, p_identifiers text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.blocked_contact_ids(p_clinic_id, p_identifiers));
$$;

-- Para as edge functions de entrada: se estiver bloqueado, conta a mensagem
-- barrada e devolve true (a função descarta a mensagem).
create or replace function public.register_blocked_inbound(p_clinic_id uuid, p_identifiers text[])
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.contacts c
     set blocked_messages = c.blocked_messages + 1,
         last_blocked_message_at = now()
   where c.id in (select public.blocked_contact_ids(p_clinic_id, p_identifiers));
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke execute on function public.blocked_contact_ids(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.is_contact_identifier_blocked(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.register_blocked_inbound(uuid, text[]) from public, anon, authenticated;
grant execute on function public.blocked_contact_ids(uuid, text[]) to service_role;
grant execute on function public.is_contact_identifier_blocked(uuid, text[]) to service_role;
grant execute on function public.register_blocked_inbound(uuid, text[]) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Bloquear (pelo contato ou por um número digitado)
-- -----------------------------------------------------------------------------
create or replace function public.contact_block(
  p_contact_id uuid default null,
  p_phone text default null,
  p_name text default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_contact_id uuid;
  v_phone text;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor_name text;
  v_conversation record;
begin
  if auth.uid() is null then
    raise exception 'Não autorizado';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'O motivo pode ter no máximo 300 caracteres.';
  end if;

  if p_contact_id is not null then
    select c.id, c.clinic_id into v_contact_id, v_clinic_id
    from public.contacts c
    where c.id = p_contact_id
    for update;
    if v_contact_id is null
       or v_clinic_id is null
       or not public.has_clinic_permission(v_clinic_id, 'contacts.block') then
      raise exception 'Você não tem permissão para bloquear contatos.';
    end if;
  else
    v_clinic_id := public.current_clinic_id();
    if v_clinic_id is null or not public.has_clinic_permission(v_clinic_id, 'contacts.block') then
      raise exception 'Você não tem permissão para bloquear contatos.';
    end if;

    v_phone := ltrim(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '0');
    -- DDD + número: Brasil
    if char_length(v_phone) in (10, 11) then
      v_phone := '55' || v_phone;
    end if;
    if v_phone !~ '^\d{12,15}$' then
      raise exception 'Telefone inválido. Use DDD e número (com o 55 do Brasil, se quiser).';
    end if;
    if v_name is not null and char_length(v_name) > 120 then
      raise exception 'O nome pode ter no máximo 120 caracteres.';
    end if;

    select c.id into v_contact_id
    from public.contacts c
    where c.clinic_id = v_clinic_id
      and c.phone = any(public.contact_identifier_variants(v_phone))
    order by c.last_seen_at desc nulls last
    limit 1
    for update;

    if v_contact_id is null then
      insert into public.contacts (clinic_id, phone, name, meta_contact_id)
      values (v_clinic_id, v_phone, coalesce(v_name, v_phone), v_phone)
      returning id into v_contact_id;
    end if;
  end if;

  update public.contacts
     set blocked_at = coalesce(blocked_at, now()),
         blocked_by = case when blocked_at is null then auth.uid() else blocked_by end,
         blocked_reason = case when blocked_at is null or v_reason is not null then v_reason else blocked_reason end,
         blocked_messages = case when blocked_at is null then 0 else blocked_messages end,
         last_blocked_message_at = case when blocked_at is null then null else last_blocked_message_at end
   where id = v_contact_id;

  -- Encerra o que estiver aberto ou na fila (sem pesquisa de satisfação)
  select coalesce(nullif(btrim(cu.name), ''), 'Atendente') into v_actor_name
  from public.clinic_users cu
  where cu.user_id = auth.uid() and cu.clinic_id = v_clinic_id;

  for v_conversation in
    update public.conversations
       set status = 'closed', closed_at = now(), updated_at = now()
     where clinic_id = v_clinic_id
       and contact_id = v_contact_id
       and status <> 'closed'
    returning id
  loop
    insert into public.conversation_events (conversation_id, event_type, performed_by, metadata)
    values (
      v_conversation.id,
      'conversation_closed',
      auth.uid(),
      jsonb_build_object(
        'performed_by_name', coalesce(v_actor_name, 'Atendente'),
        'reason', 'Contato bloqueado',
        'note', v_reason
      )
    );
  end loop;

  return v_contact_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Desbloquear
-- -----------------------------------------------------------------------------
create or replace function public.contact_unblock(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autorizado';
  end if;

  select c.clinic_id into v_clinic_id
  from public.contacts c
  where c.id = p_contact_id
  for update;
  if v_clinic_id is null or not public.has_clinic_permission(v_clinic_id, 'contacts.block') then
    raise exception 'Você não tem permissão para desbloquear contatos.';
  end if;

  -- O total de mensagens barradas fica como histórico até um novo bloqueio
  update public.contacts
     set blocked_at = null, blocked_by = null, blocked_reason = null
   where id = p_contact_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Lista da tela Contatos bloqueados
-- -----------------------------------------------------------------------------
create or replace function public.list_blocked_contacts()
returns table (
  id uuid,
  name text,
  phone text,
  image_url text,
  blocked_at timestamptz,
  blocked_by_name text,
  blocked_reason text,
  blocked_messages integer,
  last_blocked_message_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.phone,
    c.image_url,
    c.blocked_at,
    nullif(btrim(cu.name), ''),
    c.blocked_reason,
    c.blocked_messages,
    c.last_blocked_message_at
  from public.contacts c
  left join public.clinic_users cu
    on cu.user_id = c.blocked_by and cu.clinic_id = c.clinic_id
  where c.clinic_id = public.current_clinic_id()
    and c.blocked_at is not null
    and public.has_clinic_permission(c.clinic_id, 'contacts.block')
  order by c.blocked_at desc;
$$;

revoke execute on function public.contact_block(uuid, text, text, text) from public, anon;
revoke execute on function public.contact_unblock(uuid) from public, anon;
revoke execute on function public.list_blocked_contacts() from public, anon;
grant execute on function public.contact_block(uuid, text, text, text) to authenticated;
grant execute on function public.contact_unblock(uuid) to authenticated;
grant execute on function public.list_blocked_contacts() to authenticated;

commit;
