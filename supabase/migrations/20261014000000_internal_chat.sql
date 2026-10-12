-- =============================================================================
-- Chat interno da equipe
--
-- Conversas entre as pessoas da própria clínica (atendentes e admins), sem
-- relação com os atendimentos de clientes:
--   - 'general': um canal por clínica, com toda a equipe;
--   - 'direct':  conversa entre duas pessoas (user_a < user_b, uma por par).
--
-- Só os participantes leem uma conversa direta: o admin NÃO enxerga as
-- conversas diretas dos atendentes.
--
-- O front lê as tabelas direto (RLS) e grava mensagens por INSERT; conversas e
-- leituras são gravadas só pelas RPCs abaixo. O push é enviado pela edge
-- function internal-chat-push, chamada pelo front depois do INSERT.
--
-- Ordem de deploy: aplique ANTES de publicar o frontend e a edge function
-- internal-chat-push.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------
create table if not exists public.internal_chat_threads (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  kind text not null check (kind in ('general', 'direct')),
  -- Atendente removido (delete-attendant apaga o clinic_users): a conversa
  -- direta some junto.
  user_a uuid references public.clinic_users (user_id) on delete cascade,
  user_b uuid references public.clinic_users (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint internal_chat_threads_shape_check check (
    (kind = 'general' and user_a is null and user_b is null)
    or (kind = 'direct' and user_a is not null and user_b is not null and user_a < user_b)
  )
);

create unique index if not exists internal_chat_threads_general_uk
  on public.internal_chat_threads (clinic_id)
  where kind = 'general';

create unique index if not exists internal_chat_threads_direct_uk
  on public.internal_chat_threads (user_a, user_b)
  where kind = 'direct';

create index if not exists internal_chat_threads_user_b_idx
  on public.internal_chat_threads (user_b)
  where kind = 'direct';

create table if not exists public.internal_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.internal_chat_threads (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- No canal geral a mensagem continua existindo depois que o autor é removido
  sender_id uuid references public.clinic_users (user_id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  -- Preenchido pela edge function internal-chat-push (evita push duplicado)
  push_notified_at timestamptz
);

create index if not exists internal_chat_messages_thread_created_idx
  on public.internal_chat_messages (thread_id, created_at desc, id desc);

create table if not exists public.internal_chat_reads (
  thread_id uuid not null references public.internal_chat_threads (id) on delete cascade,
  user_id uuid not null references public.clinic_users (user_id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Quem pode ver uma conversa: toda a clínica no canal geral, só os dois
-- participantes na conversa direta.
-- -----------------------------------------------------------------------------
create or replace function public.can_access_internal_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.internal_chat_threads t
    where t.id = p_thread_id
      and t.clinic_id = public.current_clinic_id()
      and (t.kind = 'general' or auth.uid() in (t.user_a, t.user_b))
  );
$$;

-- -----------------------------------------------------------------------------
-- Mensagens: clínica, horário e texto são definidos no servidor
-- -----------------------------------------------------------------------------
create or replace function public.internal_chat_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  select t.clinic_id into v_clinic_id
  from public.internal_chat_threads t
  where t.id = new.thread_id;

  if v_clinic_id is null then
    raise exception 'thread not found';
  end if;

  new.clinic_id := v_clinic_id;
  new.created_at := clock_timestamp();
  new.push_notified_at := null;
  new.body := btrim(coalesce(new.body, ''));
  return new;
end;
$$;

drop trigger if exists internal_chat_messages_before_insert on public.internal_chat_messages;
create trigger internal_chat_messages_before_insert
  before insert on public.internal_chat_messages
  for each row execute function public.internal_chat_messages_before_insert();

create or replace function public.internal_chat_messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.internal_chat_threads
     set last_message_at = new.created_at
   where id = new.thread_id;
  return null;
end;
$$;

drop trigger if exists internal_chat_messages_after_insert on public.internal_chat_messages;
create trigger internal_chat_messages_after_insert
  after insert on public.internal_chat_messages
  for each row execute function public.internal_chat_messages_after_insert();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.internal_chat_threads enable row level security;
alter table public.internal_chat_messages enable row level security;
alter table public.internal_chat_reads enable row level security;

revoke all on public.internal_chat_threads from anon;
revoke all on public.internal_chat_messages from anon;
revoke all on public.internal_chat_reads from anon;

-- Conversas: leitura pelos participantes; criação só pelas RPCs
drop policy if exists "internal_chat_threads_select" on public.internal_chat_threads;
create policy "internal_chat_threads_select"
  on public.internal_chat_threads
  for select
  to authenticated
  using (
    clinic_id = public.current_clinic_id()
    and (kind = 'general' or auth.uid() in (user_a, user_b))
  );

-- Mensagens: participantes leem e enviam em nome próprio; não há edição nem exclusão
drop policy if exists "internal_chat_messages_select" on public.internal_chat_messages;
create policy "internal_chat_messages_select"
  on public.internal_chat_messages
  for select
  to authenticated
  using (public.can_access_internal_thread(thread_id));

drop policy if exists "internal_chat_messages_insert" on public.internal_chat_messages;
create policy "internal_chat_messages_insert"
  on public.internal_chat_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_access_internal_thread(thread_id)
  );

-- Leituras: cada um vê a própria; gravação pela RPC internal_chat_mark_read
drop policy if exists "internal_chat_reads_select_own" on public.internal_chat_reads;
create policy "internal_chat_reads_select_own"
  on public.internal_chat_reads
  for select
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Abre (ou cria) a conversa direta com outra pessoa da mesma clínica
create or replace function public.internal_chat_open_direct(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_clinic_id uuid := public.current_clinic_id();
  v_a uuid;
  v_b uuid;
  v_thread_id uuid;
begin
  if v_me is null or v_clinic_id is null then
    raise exception 'not authenticated';
  end if;

  if p_user_id is null or p_user_id = v_me then
    raise exception 'invalid user';
  end if;

  if not exists (
    select 1
    from public.clinic_users cu
    where cu.user_id = p_user_id
      and cu.clinic_id = v_clinic_id
  ) then
    raise exception 'user not in clinic';
  end if;

  v_a := least(v_me, p_user_id);
  v_b := greatest(v_me, p_user_id);

  insert into public.internal_chat_threads (clinic_id, kind, user_a, user_b)
  values (v_clinic_id, 'direct', v_a, v_b)
  on conflict (user_a, user_b) where kind = 'direct' do nothing;

  select t.id into v_thread_id
  from public.internal_chat_threads t
  where t.kind = 'direct'
    and t.user_a = v_a
    and t.user_b = v_b;

  return v_thread_id;
end;
$$;

-- Conversas do usuário logado, com prévia da última mensagem e não lidas.
-- Garante que o canal geral da clínica exista (clínicas criadas depois desta
-- migration).
create or replace function public.internal_chat_list_threads()
returns table (
  thread_id uuid,
  kind text,
  other_user_id uuid,
  last_message_at timestamptz,
  last_message_body text,
  last_message_sender_id uuid,
  unread_count integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
  v_clinic_id uuid := public.current_clinic_id();
begin
  if v_me is null or v_clinic_id is null then
    return;
  end if;

  insert into public.internal_chat_threads (clinic_id, kind)
  values (v_clinic_id, 'general')
  on conflict (clinic_id) where kind = 'general' do nothing;

  return query
  select
    t.id,
    t.kind,
    case
      when t.kind = 'direct' and t.user_a = v_me then t.user_b
      when t.kind = 'direct' then t.user_a
    end,
    t.last_message_at,
    left(lm.body, 140),
    lm.sender_id,
    (
      select count(*)::int
      from public.internal_chat_messages m
      where m.thread_id = t.id
        and m.sender_id is distinct from v_me
        and m.created_at > coalesce(r.last_read_at, 'epoch'::timestamptz)
    )
  from public.internal_chat_threads t
  left join public.internal_chat_reads r
    on r.thread_id = t.id
   and r.user_id = v_me
  left join lateral (
    select m.body, m.sender_id
    from public.internal_chat_messages m
    where m.thread_id = t.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  where t.clinic_id = v_clinic_id
    and (t.kind = 'general' or v_me in (t.user_a, t.user_b));
end;
$$;

-- Marca a conversa como lida até agora
create or replace function public.internal_chat_mark_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_access_internal_thread(p_thread_id) then
    raise exception 'not allowed';
  end if;

  insert into public.internal_chat_reads (thread_id, user_id, last_read_at)
  values (p_thread_id, auth.uid(), clock_timestamp())
  on conflict (thread_id, user_id) do update
    set last_read_at = excluded.last_read_at;
end;
$$;

revoke execute on function public.can_access_internal_thread(uuid) from public, anon;
revoke execute on function public.internal_chat_open_direct(uuid) from public, anon;
revoke execute on function public.internal_chat_list_threads() from public, anon;
revoke execute on function public.internal_chat_mark_read(uuid) from public, anon;
grant execute on function public.can_access_internal_thread(uuid) to authenticated, service_role;
grant execute on function public.internal_chat_open_direct(uuid) to authenticated;
grant execute on function public.internal_chat_list_threads() to authenticated;
grant execute on function public.internal_chat_mark_read(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Canal geral das clínicas que já existem
-- -----------------------------------------------------------------------------
insert into public.internal_chat_threads (clinic_id, kind)
select c.id, 'general'
from public.clinics c
on conflict (clinic_id) where kind = 'general' do nothing;

-- -----------------------------------------------------------------------------
-- Realtime: mensagens novas chegam por postgres_changes (respeitando o RLS)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'internal_chat_messages'
     ) then
    alter publication supabase_realtime add table public.internal_chat_messages;
  end if;
end;
$$;

commit;
