-- =============================================================================
-- Vários números de WhatsApp por QR Code (Evolution) na mesma empresa
--
-- 1. channel_connections deixa de aceitar só uma conexão por empresa/provedor/
--    canal. A regra continua valendo para a Meta; para a Evolution cada número
--    é uma linha, identificada pela instância (session_name, única).
--
-- 2. Colunas novas em channel_connections:
--      display_name            apelido do número ("Recepção", "Financeiro")
--      default_department_id   setor em que caem as conversas novas do número
--                              (vazio = departamento padrão da empresa)
--      archived_at             número removido: some das telas, mas as
--                              conversas antigas continuam ligadas a ele
--
-- 3. Mensagens programadas guardam o número por onde saem
--    (scheduled_messages.channel_connection_id). Programações antigas ficam
--    sem número e saem pelo QR Code conectado mais recente, como antes.
--
-- O limite de números do plano continua em clinic_can_use_whatsapp_number
-- (só conta conexões "connected", então número arquivado não ocupa vaga).
--
-- Ordem de deploy: aplique e, LOGO EM SEGUIDA, publique whatsapp-connect e
-- meta-connect (o onConflict deles muda junto com a constraint). Depois
-- publique create-evolution-connection, archive-evolution-connection,
-- shared-in-config, evolution-connection-sync, scheduled-messages-dispatch e
-- o frontend.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Unicidade
-- -----------------------------------------------------------------------------
-- A Meta não usa session_name (fica nulo): com NULLS NOT DISTINCT continua
-- havendo uma conexão Meta por empresa/canal. Cada instância Evolution tem o
-- próprio session_name, então a empresa pode ter várias.
-- Os upserts da Meta passam a usar onConflict
-- "clinic_id,provider,channel,session_name" (índice parcial não serviria:
-- ON CONFLICT sem WHERE não o reconhece). Publique whatsapp-connect e
-- meta-connect junto com esta migration.
alter table public.channel_connections
  drop constraint if exists channel_connections_unique_clinic_provider_channel;

alter table public.channel_connections
  drop constraint if exists channel_connections_unique_clinic_provider_channel_session;
alter table public.channel_connections
  add constraint channel_connections_unique_clinic_provider_channel_session
  unique nulls not distinct (clinic_id, provider, channel, session_name);

create unique index if not exists channel_connections_session_name_unique
  on public.channel_connections (session_name)
  where session_name is not null;

-- -----------------------------------------------------------------------------
-- 2. Apelido, setor padrão e arquivamento
-- -----------------------------------------------------------------------------
alter table public.channel_connections
  add column if not exists display_name text,
  add column if not exists default_department_id uuid
    references public.departments (id) on delete set null,
  add column if not exists archived_at timestamptz;

alter table public.channel_connections
  drop constraint if exists channel_connections_display_name_check;
alter table public.channel_connections
  add constraint channel_connections_display_name_check
  check (display_name is null or char_length(btrim(display_name)) between 1 and 60);

-- Setor de outra empresa não pode ser o padrão do número
create or replace function public.validate_channel_connection_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_department_id is not null and not exists (
    select 1
    from public.departments d
    where d.id = new.default_department_id
      and d.clinic_id = new.clinic_id
  ) then
    raise exception 'Departamento não encontrado nesta empresa.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_channel_connection_department on public.channel_connections;
create trigger validate_channel_connection_department
  before insert or update of default_department_id, clinic_id on public.channel_connections
  for each row execute function public.validate_channel_connection_department();

-- O front lê só as colunas liberadas (20261011100100_channel_connections_hide_secrets)
grant select (display_name, default_department_id, archived_at)
  on public.channel_connections to authenticated;

-- Conexões são criadas e ligadas pelas edge functions (service role). O front
-- só edita apelido e setor padrão (RLS: admins da empresa); antes ele podia
-- gravar session_name e apontar para a instância de outra empresa.
revoke insert, update, delete on public.channel_connections from anon, authenticated;
grant update (display_name, default_department_id, updated_at)
  on public.channel_connections to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Mensagens programadas: número de saída
-- -----------------------------------------------------------------------------
alter table public.scheduled_messages
  add column if not exists channel_connection_id uuid
    references public.channel_connections (id) on delete set null;

drop function if exists public.scheduled_message_save(uuid, text, timestamptz, jsonb);

create or replace function public.scheduled_message_save(
  p_id uuid,
  p_message text,
  p_scheduled_at timestamptz,
  p_recipients jsonb,
  p_channel_connection_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_message text := btrim(coalesce(p_message, ''));
  v_current public.scheduled_messages%rowtype;
  v_id uuid;
  v_count integer;
  v_invalid text;
begin
  if v_user_id is null then
    raise exception 'Não autorizado';
  end if;

  select cu.clinic_id, cu.role
    into v_clinic_id, v_role
    from public.clinic_users cu
   where cu.user_id = v_user_id
   limit 1;

  if v_clinic_id is null then
    raise exception 'Não autorizado';
  end if;

  if char_length(v_message) = 0 then
    raise exception 'Escreva a mensagem.';
  end if;
  if char_length(v_message) > 4000 then
    raise exception 'A mensagem pode ter no máximo 4000 caracteres.';
  end if;

  if p_scheduled_at is null or p_scheduled_at <= now() then
    raise exception 'Escolha uma data e hora no futuro.';
  end if;
  if p_scheduled_at > now() + interval '1 year' then
    raise exception 'A programação pode ser feita para no máximo 1 ano à frente.';
  end if;

  if p_channel_connection_id is not null and not exists (
    select 1
    from public.channel_connections cc
    where cc.id = p_channel_connection_id
      and cc.clinic_id = v_clinic_id
      and cc.provider = 'evolution'
      and cc.channel = 'whatsapp'
      and cc.archived_at is null
  ) then
    raise exception 'Número de WhatsApp não encontrado.';
  end if;

  if p_recipients is null
     or jsonb_typeof(p_recipients) <> 'array'
     or jsonb_array_length(p_recipients) = 0 then
    raise exception 'Adicione pelo menos um destinatário.';
  end if;
  if jsonb_array_length(p_recipients) > 300 then
    raise exception 'Cada programação aceita no máximo 100 destinatários.';
  end if;

  -- Cliente da carteira precisa ser da mesma empresa
  if exists (
    select 1
    from jsonb_array_elements(p_recipients) as r
    where nullif(r ->> 'contact_id', '') is not null
      and not exists (
        select 1
        from public.contacts c
        where c.id = (r ->> 'contact_id')::uuid
          and c.clinic_id = v_clinic_id
      )
  ) then
    raise exception 'Um dos clientes selecionados não foi encontrado na carteira.';
  end if;

  if p_id is null then
    insert into public.scheduled_messages (
      clinic_id, created_by, message, scheduled_at, channel_connection_id
    )
    values (v_clinic_id, v_user_id, v_message, p_scheduled_at, p_channel_connection_id)
    returning id into v_id;
  else
    select *
      into v_current
      from public.scheduled_messages sm
     where sm.id = p_id
       for update;

    if not found
       or v_current.clinic_id <> v_clinic_id
       or not (v_role = 'admin' or v_current.created_by = v_user_id) then
      raise exception 'Programação não encontrada.';
    end if;

    if v_current.status <> 'scheduled' then
      raise exception 'Esta programação já começou a ser enviada e não pode mais ser editada.';
    end if;

    update public.scheduled_messages
       set message = v_message,
           scheduled_at = p_scheduled_at,
           channel_connection_id = p_channel_connection_id,
           updated_at = now()
     where id = p_id;

    delete from public.scheduled_message_recipients where scheduled_message_id = p_id;
    v_id := p_id;
  end if;

  -- Um destinatário por número: escolher o cliente e digitar o mesmo telefone
  -- não gera dois envios
  insert into public.scheduled_message_recipients (
    scheduled_message_id, position, contact_id, name, phone
  )
  select distinct on (resolved.phone)
    v_id,
    resolved.position,
    resolved.contact_id,
    resolved.name,
    resolved.phone
  from (
    select
      t.ord::integer as position,
      coalesce(picked.id, by_phone.id) as contact_id,
      coalesce(
        nullif(btrim(picked.name), ''),
        nullif(btrim(by_phone.name), ''),
        nullif(btrim(t.r ->> 'name'), '')
      ) as name,
      case
        when picked.id is not null
          then regexp_replace(coalesce(picked.phone, ''), '\D', '', 'g')
        else regexp_replace(coalesce(t.r ->> 'phone', ''), '\D', '', 'g')
      end as phone
    from jsonb_array_elements(p_recipients) with ordinality as t(r, ord)
    left join public.contacts picked
      on picked.id = nullif(t.r ->> 'contact_id', '')::uuid
     and picked.clinic_id = v_clinic_id
    -- Número digitado que já é de um cliente: vincula ao cadastro
    left join public.contacts by_phone
      on picked.id is null
     and by_phone.clinic_id = v_clinic_id
     and by_phone.phone = regexp_replace(coalesce(t.r ->> 'phone', ''), '\D', '', 'g')
  ) as resolved
  order by resolved.phone, resolved.position;

  select count(*), min(coalesce(r.name, r.phone)) filter (where r.phone !~ '^\d{10,15}$')
    into v_count, v_invalid
    from public.scheduled_message_recipients r
   where r.scheduled_message_id = v_id;

  if v_invalid is not null then
    raise exception 'Telefone inválido para "%". Use DDD e número, só com dígitos.', v_invalid;
  end if;
  if v_count > 100 then
    raise exception 'Cada programação aceita no máximo 100 destinatários.';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb, uuid) from public, anon;
grant execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb, uuid) to authenticated;

-- O worker precisa saber por qual número cada destinatário sai
drop function if exists public.claim_scheduled_message_recipients(integer, integer);

create or replace function public.claim_scheduled_message_recipients(
  p_per_clinic integer default 6,
  p_max integer default 60
)
returns table (
  recipient_id uuid,
  scheduled_message_id uuid,
  clinic_id uuid,
  created_by uuid,
  message text,
  contact_id uuid,
  name text,
  phone text,
  channel_connection_id uuid
)
language sql
security definer
set search_path = public
as $$
  -- Rodada anterior morreu no meio: não dá para saber se a mensagem saiu, então
  -- não reenvia (o cliente poderia receber em dobro)
  update public.scheduled_message_recipients r
     set status = 'failed',
         error = 'O envio foi interrompido antes da confirmação. Confira a conversa antes de enviar de novo.'
   where r.status = 'sending'
     and r.claimed_at < now() - interval '10 minutes';

  select public.finalize_scheduled_messages();

  update public.scheduled_messages sm
     set status = 'processing',
         started_at = now(),
         updated_at = now()
   where sm.status = 'scheduled'
     and sm.scheduled_at <= now();

  with ranked as (
    select
      r.id,
      row_number() over (
        partition by sm.clinic_id
        order by sm.scheduled_at, sm.id, r.position
      ) as rn
    from public.scheduled_message_recipients r
    join public.scheduled_messages sm on sm.id = r.scheduled_message_id
    where sm.status = 'processing'
      and r.status = 'pending'
      -- Uma leva por empresa de cada vez: se a rodada anterior ainda está
      -- enviando, esta não acelera o ritmo
      and not exists (
        select 1
        from public.scheduled_message_recipients busy
        join public.scheduled_messages busy_sm on busy_sm.id = busy.scheduled_message_id
        where busy_sm.clinic_id = sm.clinic_id
          and busy.status = 'sending'
      )
  ),
  picked as (
    select r.id
    from public.scheduled_message_recipients r
    where r.status = 'pending'
      and r.id in (
        select ranked.id from ranked where ranked.rn <= greatest(1, p_per_clinic)
      )
    limit greatest(1, p_max)
    for update skip locked
  ),
  claimed as (
    update public.scheduled_message_recipients r
       set status = 'sending',
           claimed_at = now(),
           attempts = r.attempts + 1
      from picked
     where r.id = picked.id
       and r.status = 'pending'
    returning r.id, r.scheduled_message_id, r.position, r.contact_id, r.name, r.phone
  )
  select
    c.id,
    c.scheduled_message_id,
    sm.clinic_id,
    sm.created_by,
    sm.message,
    c.contact_id,
    c.name,
    c.phone,
    sm.channel_connection_id
  from claimed c
  join public.scheduled_messages sm on sm.id = c.scheduled_message_id
  order by sm.clinic_id, sm.scheduled_at, sm.id, c.position;
$$;

revoke execute on function public.claim_scheduled_message_recipients(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_scheduled_message_recipients(integer, integer) to service_role;

commit;
