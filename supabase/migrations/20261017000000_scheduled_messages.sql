-- =============================================================================
-- Mensagens programadas
--
-- A pessoa escolhe o texto, o dia/hora e os destinatários (clientes da carteira
-- ou números avulsos); no horário, a edge function scheduled-messages-dispatch
-- envia pelo WhatsApp conectado por QR Code (Evolution) da empresa.
--
--   scheduled_messages             uma programação (texto + horário + status)
--   scheduled_message_recipients   um destinatário, com status próprio
--
-- Status da programação:
--   scheduled   aguardando o horário (única situação em que pode ser editada)
--   processing  no horário: os envios estão saindo
--   sent        todos os destinatários receberam
--   partial     parte recebeu, parte falhou
--   failed      ninguém recebeu
--   cancelled   cancelada por quem criou ou por um admin
--
-- Quem vê: quem criou a programação e os admins da empresa. O front só lê as
-- tabelas (RLS); criar, editar, cancelar e excluir passam pelas RPCs abaixo.
--
-- Ritmo de envio: o pg_cron chama a edge function a cada minuto e ela envia até
-- 6 destinatários por empresa por rodada, com alguns segundos entre um e outro
-- (envio em sequência sem pausa é o que costuma derrubar o número).
--
-- Ordem de deploy: aplique ANTES de publicar a edge function
-- scheduled-messages-dispatch e o frontend desta entrega.
--
-- O job usa os mesmos segredos do Vault criados para o
-- evolution-connection-sync ('project_url' e 'internal_bot_secret').
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------
create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- Atendente removido: a programação continua existindo (o admin enxerga)
  created_by uuid references auth.users (id) on delete set null,
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (
    status in ('scheduled', 'processing', 'sent', 'partial', 'failed', 'cancelled')
  ),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_messages_clinic_scheduled_idx
  on public.scheduled_messages (clinic_id, scheduled_at desc);

create index if not exists scheduled_messages_due_idx
  on public.scheduled_messages (scheduled_at)
  where status in ('scheduled', 'processing');

create table if not exists public.scheduled_message_recipients (
  id uuid primary key default gen_random_uuid(),
  scheduled_message_id uuid not null
    references public.scheduled_messages (id) on delete cascade,
  position integer not null default 0,
  -- Preenchido quando o destinatário é um cliente da carteira
  contact_id uuid references public.contacts (id) on delete set null,
  name text,
  -- Só dígitos, com DDI
  phone text not null,
  status text not null default 'pending' check (
    status in ('pending', 'sending', 'sent', 'failed', 'cancelled')
  ),
  error text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  -- Conversa em que a mensagem enviada ficou registrada
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint scheduled_message_recipients_phone_uk unique (scheduled_message_id, phone)
);

create index if not exists scheduled_message_recipients_message_idx
  on public.scheduled_message_recipients (scheduled_message_id, position);

create index if not exists scheduled_message_recipients_open_idx
  on public.scheduled_message_recipients (status)
  where status in ('pending', 'sending');

-- -----------------------------------------------------------------------------
-- RLS: leitura por quem criou e pelos admins; gravação só pelas RPCs
-- -----------------------------------------------------------------------------
create or replace function public.can_access_scheduled_message(
  p_clinic_id uuid,
  p_created_by uuid
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
      and (cu.role = 'admin' or p_created_by = auth.uid())
  );
$$;

revoke execute on function public.can_access_scheduled_message(uuid, uuid) from public, anon;
grant execute on function public.can_access_scheduled_message(uuid, uuid) to authenticated;

alter table public.scheduled_messages enable row level security;
alter table public.scheduled_message_recipients enable row level security;

revoke all on public.scheduled_messages from anon, authenticated;
revoke all on public.scheduled_message_recipients from anon, authenticated;
grant select on public.scheduled_messages to authenticated;
grant select on public.scheduled_message_recipients to authenticated;

drop policy if exists "scheduled_messages_select" on public.scheduled_messages;
create policy "scheduled_messages_select"
  on public.scheduled_messages
  for select
  to authenticated
  using (public.can_access_scheduled_message(clinic_id, created_by));

drop policy if exists "scheduled_message_recipients_select" on public.scheduled_message_recipients;
create policy "scheduled_message_recipients_select"
  on public.scheduled_message_recipients
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.scheduled_messages sm
      where sm.id = scheduled_message_recipients.scheduled_message_id
        and public.can_access_scheduled_message(sm.clinic_id, sm.created_by)
    )
  );

-- -----------------------------------------------------------------------------
-- RPC: cria (p_id nulo) ou edita uma programação que ainda não começou
--
-- p_recipients: [{ "contact_id": uuid }, { "phone": "5511999998888", "name": "Ana" }]
-- Para clientes da carteira, nome e telefone vêm do cadastro (não do navegador).
-- -----------------------------------------------------------------------------
create or replace function public.scheduled_message_save(
  p_id uuid,
  p_message text,
  p_scheduled_at timestamptz,
  p_recipients jsonb
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
    insert into public.scheduled_messages (clinic_id, created_by, message, scheduled_at)
    values (v_clinic_id, v_user_id, v_message, p_scheduled_at)
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

-- -----------------------------------------------------------------------------
-- RPC: cancela (antes do horário ou no meio do envio). Quem já recebeu continua
-- como enviado; os demais ficam como cancelados.
-- -----------------------------------------------------------------------------
create or replace function public.scheduled_message_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.scheduled_messages%rowtype;
begin
  select *
    into v_current
    from public.scheduled_messages sm
   where sm.id = p_id
     for update;

  if not found
     or not public.can_access_scheduled_message(v_current.clinic_id, v_current.created_by) then
    raise exception 'Programação não encontrada.';
  end if;

  if v_current.status not in ('scheduled', 'processing') then
    raise exception 'Esta programação já foi finalizada.';
  end if;

  update public.scheduled_messages
     set status = 'cancelled',
         finished_at = now(),
         updated_at = now()
   where id = p_id;

  update public.scheduled_message_recipients
     set status = 'cancelled'
   where scheduled_message_id = p_id
     and status = 'pending';
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: exclui a programação e o histórico dela
-- -----------------------------------------------------------------------------
create or replace function public.scheduled_message_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.scheduled_messages%rowtype;
begin
  select *
    into v_current
    from public.scheduled_messages sm
   where sm.id = p_id
     for update;

  if not found
     or not public.can_access_scheduled_message(v_current.clinic_id, v_current.created_by) then
    raise exception 'Programação não encontrada.';
  end if;

  if v_current.status = 'processing' then
    raise exception 'O envio está em andamento. Cancele antes de excluir.';
  end if;

  delete from public.scheduled_messages where id = p_id;
end;
$$;

revoke execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb) from public, anon;
revoke execute on function public.scheduled_message_cancel(uuid) from public, anon;
revoke execute on function public.scheduled_message_delete(uuid) from public, anon;
grant execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb) to authenticated;
grant execute on function public.scheduled_message_cancel(uuid) to authenticated;
grant execute on function public.scheduled_message_delete(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Worker (service role): fecha as programações em que não falta ninguém
-- -----------------------------------------------------------------------------
create or replace function public.finalize_scheduled_messages()
returns integer
language sql
security definer
set search_path = public
as $$
  with summary as (
    select
      r.scheduled_message_id,
      count(*) as total,
      count(*) filter (where r.status = 'sent') as sent,
      count(*) filter (where r.status in ('pending', 'sending')) as remaining
    from public.scheduled_message_recipients r
    join public.scheduled_messages sm on sm.id = r.scheduled_message_id
    where sm.status = 'processing'
    group by r.scheduled_message_id
  ),
  done as (
    update public.scheduled_messages sm
       set status = case
             when s.sent = s.total then 'sent'
             when s.sent = 0 then 'failed'
             else 'partial'
           end,
           finished_at = now(),
           updated_at = now()
      from summary s
     where sm.id = s.scheduled_message_id
       and sm.status = 'processing'
       and s.remaining = 0
    returning sm.id
  )
  select count(*)::integer from done;
$$;

-- -----------------------------------------------------------------------------
-- Worker (service role): pega os próximos destinatários a enviar
--
-- Marca como "sending" na mesma transação (FOR UPDATE SKIP LOCKED), então duas
-- rodadas simultâneas nunca pegam o mesmo destinatário.
-- -----------------------------------------------------------------------------
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
  phone text
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
    c.phone
  from claimed c
  join public.scheduled_messages sm on sm.id = c.scheduled_message_id
  order by sm.clinic_id, sm.scheduled_at, sm.id, c.position;
$$;

revoke execute on function public.finalize_scheduled_messages() from public, anon, authenticated;
revoke execute on function public.claim_scheduled_message_recipients(integer, integer) from public, anon, authenticated;
grant execute on function public.finalize_scheduled_messages() to service_role;
grant execute on function public.claim_scheduled_message_recipients(integer, integer) to service_role;

commit;

-- -----------------------------------------------------------------------------
-- Agendamento: a cada minuto, e só chama a edge function quando há o que enviar
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'scheduled-messages-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/scheduled-messages-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_bot_secret')
    ),
    body := '{}'::jsonb
  )
  where exists (
    select 1
    from public.scheduled_messages sm
    where sm.status = 'processing'
       or (sm.status = 'scheduled' and sm.scheduled_at <= now())
  );
  $$
);
