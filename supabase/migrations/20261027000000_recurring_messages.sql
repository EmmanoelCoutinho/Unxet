-- =============================================================================
-- Mensagens agendadas para um cliente (Carteira de clientes), com recorrência
--
--   recurring_messages   a regra: texto, cliente, frequência e horário
--     once     uma vez (agora ou numa data/hora)
--     daily    todo dia no horário
--     weekly   nos dias da semana escolhidos (weekdays: 0 = domingo ... 6)
--     monthly  todo mês no dia escolhido (month_day 1-31; em mês mais curto,
--              sai no último dia)
--   Termina: nunca, numa data (ends_on) ou depois de N envios (max_runs).
--
-- A cada minuto o pg_cron roda materialize_recurring_messages(): para cada
-- regra vencida cria um envio comum (scheduled_messages + 1 destinatário),
-- que o scheduled-messages-dispatch manda no ritmo seguro de sempre, e
-- calcula o próximo. Esses envios não aparecem na lista de Campanhas.
--
-- Horário: send_time no fuso da pessoa que agendou (timezone, ex.
-- America/Sao_Paulo).
--
-- Quem vê/altera: quem criou e os admins da empresa (mesma regra das
-- campanhas). Gravação só pelas RPCs.
--
-- Ordem de deploy: depois da 20261026000000_leads_kanban; antes do frontend.
-- Não precisa de edge function nova.
-- =============================================================================

begin;

create table if not exists public.recurring_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  channel_connection_id uuid references public.channel_connections (id) on delete set null,
  frequency text not null check (frequency in ('once', 'daily', 'weekly', 'monthly')),
  weekdays smallint[] check (weekdays is null or weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  month_day smallint check (month_day is null or month_day between 1 and 31),
  send_time time not null,
  timezone text not null default 'America/Sao_Paulo',
  starts_on date not null,
  ends_on date,
  max_runs integer check (max_runs is null or max_runs between 1 and 1000),
  run_count integer not null default 0,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'finished')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recurring_messages_contact_idx
  on public.recurring_messages (contact_id, created_at desc);
create index if not exists recurring_messages_due_idx
  on public.recurring_messages (next_run_at) where status = 'active';

-- Cada envio gerado aponta para a regra (histórico no cliente)
alter table public.scheduled_messages
  add column if not exists recurring_message_id uuid
    references public.recurring_messages (id) on delete set null;

create index if not exists scheduled_messages_recurring_idx
  on public.scheduled_messages (recurring_message_id, scheduled_at desc)
  where recurring_message_id is not null;

drop trigger if exists enforce_plan_feature on public.recurring_messages;
create trigger enforce_plan_feature
  before insert on public.recurring_messages
  for each row execute function public.enforce_plan_feature('scheduled_messages', 'Mensagens agendadas não fazem parte');

alter table public.recurring_messages enable row level security;
revoke all on public.recurring_messages from anon, authenticated;
grant select on public.recurring_messages to authenticated;

drop policy if exists recurring_messages_select on public.recurring_messages;
create policy recurring_messages_select on public.recurring_messages for select to authenticated
  using (public.can_access_scheduled_message(clinic_id, created_by));

-- -----------------------------------------------------------------------------
-- Próximo envio depois de p_after (null = não há mais)
-- -----------------------------------------------------------------------------
create or replace function public.recurring_next_run(
  p_frequency text,
  p_weekdays smallint[],
  p_month_day smallint,
  p_send_time time,
  p_timezone text,
  p_starts_on date,
  p_ends_on date,
  p_after timestamptz
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_day date := greatest(p_starts_on, (p_after at time zone p_timezone)::date);
  v_date date;
  v_month date;
  v_dom integer;
  v_candidate timestamptz;
  i integer;
begin
  if p_frequency = 'once' then
    v_candidate := (p_starts_on + p_send_time) at time zone p_timezone;
    return case when v_candidate > p_after then v_candidate end;
  end if;

  if p_frequency in ('daily', 'weekly') then
    for i in 0..14 loop
      v_date := v_day + i;
      if p_ends_on is not null and v_date > p_ends_on then
        return null;
      end if;
      if p_frequency = 'daily' or extract(dow from v_date)::smallint = any (p_weekdays) then
        v_candidate := (v_date + p_send_time) at time zone p_timezone;
        if v_candidate > p_after then
          return v_candidate;
        end if;
      end if;
    end loop;
    return null;
  end if;

  if p_frequency = 'monthly' then
    v_month := date_trunc('month', v_day)::date;
    for i in 0..24 loop
      -- Dia 31 em mês de 30 dias (ou fevereiro): último dia do mês
      v_dom := least(p_month_day, extract(day from (v_month + interval '1 month' - interval '1 day'))::integer);
      v_date := v_month + (v_dom - 1);
      if p_ends_on is not null and v_date > p_ends_on then
        return null;
      end if;
      if v_date >= p_starts_on then
        v_candidate := (v_date + p_send_time) at time zone p_timezone;
        if v_candidate > p_after then
          return v_candidate;
        end if;
      end if;
      v_month := (v_month + interval '1 month')::date;
    end loop;
    return null;
  end if;

  return null;
end;
$$;

revoke execute on function public.recurring_next_run(text, smallint[], smallint, time, text, date, date, timestamptz) from public, anon;
grant execute on function public.recurring_next_run(text, smallint[], smallint, time, text, date, date, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Criar / editar
-- -----------------------------------------------------------------------------
create or replace function public.recurring_message_save(
  p_id uuid,
  p_contact_id uuid,
  p_message text,
  p_frequency text,
  p_weekdays smallint[],
  p_month_day smallint,
  p_send_time time,
  p_starts_on date,
  p_ends_on date,
  p_max_runs integer,
  p_send_now boolean,
  p_channel_connection_id uuid,
  p_timezone text
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
  v_tz text := coalesce(nullif(btrim(p_timezone), ''), 'America/Sao_Paulo');
  v_send_now boolean := p_frequency = 'once' and coalesce(p_send_now, false);
  v_starts_on date := p_starts_on;
  v_send_time time := p_send_time;
  v_weekdays smallint[];
  v_next timestamptz;
  v_current public.recurring_messages%rowtype;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'Não autorizado';
  end if;

  select cu.clinic_id, cu.role into v_clinic_id, v_role
    from public.clinic_users cu where cu.user_id = v_user_id limit 1;
  if v_clinic_id is null then
    raise exception 'Não autorizado';
  end if;

  -- Fuso inválido: usa o de Brasília
  begin
    perform now() at time zone v_tz;
  exception when others then
    v_tz := 'America/Sao_Paulo';
  end;

  if not exists (
    select 1 from public.contacts c
    where c.id = p_contact_id
      and c.clinic_id = v_clinic_id
      and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') ~ '^\d{10,15}$'
  ) then
    raise exception 'Cliente sem telefone de WhatsApp válido.';
  end if;

  if char_length(v_message) = 0 then
    raise exception 'Escreva a mensagem.';
  end if;
  if char_length(v_message) > 4000 then
    raise exception 'A mensagem pode ter no máximo 4000 caracteres.';
  end if;

  if p_frequency not in ('once', 'daily', 'weekly', 'monthly') then
    raise exception 'Escolha quando repetir.';
  end if;
  if p_send_time is null or p_starts_on is null then
    raise exception 'Informe a data e o horário.';
  end if;

  if p_frequency = 'weekly' then
    select array_agg(distinct d order by d) into v_weekdays
      from unnest(coalesce(p_weekdays, '{}'::smallint[])) as d
     where d between 0 and 6;
    if v_weekdays is null then
      raise exception 'Escolha pelo menos um dia da semana.';
    end if;
  end if;
  if p_frequency = 'monthly' and (p_month_day is null or p_month_day not between 1 and 31) then
    raise exception 'Escolha o dia do mês.';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'A data final precisa ser depois do início.';
  end if;
  if p_max_runs is not null and p_max_runs not between 1 and 1000 then
    raise exception 'O número de envios deve ser de 1 a 1000.';
  end if;
  if not v_send_now and p_starts_on > current_date + 366 then
    raise exception 'O primeiro envio pode ser em no máximo 1 ano.';
  end if;

  if p_channel_connection_id is not null and not exists (
    select 1 from public.channel_connections cc
    where cc.id = p_channel_connection_id
      and cc.clinic_id = v_clinic_id
      and cc.provider = 'evolution'
      and cc.channel = 'whatsapp'
      and cc.archived_at is null
  ) then
    raise exception 'Número de WhatsApp não encontrado.';
  end if;

  if v_send_now then
    -- "Enviar agora": a data e a hora guardadas são as de agora (é o que a
    -- tela mostra depois)
    v_next := now();
    v_starts_on := (now() at time zone v_tz)::date;
    v_send_time := date_trunc('minute', (now() at time zone v_tz))::time;
  else
    v_next := public.recurring_next_run(
      p_frequency, v_weekdays, p_month_day, p_send_time, v_tz, p_starts_on, p_ends_on, now()
    );
    if v_next is null then
      raise exception 'Com essas datas não sobra nenhum envio no futuro.';
    end if;
  end if;

  if p_id is null then
    insert into public.recurring_messages (
      clinic_id, contact_id, created_by, message, channel_connection_id, frequency,
      weekdays, month_day, send_time, timezone, starts_on, ends_on, max_runs, next_run_at
    )
    values (
      v_clinic_id, p_contact_id, v_user_id, v_message, p_channel_connection_id, p_frequency,
      v_weekdays, case when p_frequency = 'monthly' then p_month_day end, v_send_time, v_tz,
      v_starts_on, case when p_frequency = 'once' then null else p_ends_on end,
      case when p_frequency = 'once' then null else p_max_runs end, v_next
    )
    returning id into v_id;
  else
    select * into v_current from public.recurring_messages where id = p_id for update;
    if not found
       or v_current.clinic_id <> v_clinic_id
       or not (v_role = 'admin' or v_current.created_by = v_user_id) then
      raise exception 'Mensagem agendada não encontrada.';
    end if;

    update public.recurring_messages
       set contact_id = p_contact_id,
           message = v_message,
           channel_connection_id = p_channel_connection_id,
           frequency = p_frequency,
           weekdays = v_weekdays,
           month_day = case when p_frequency = 'monthly' then p_month_day end,
           send_time = v_send_time,
           timezone = v_tz,
           starts_on = v_starts_on,
           ends_on = case when p_frequency = 'once' then null else p_ends_on end,
           max_runs = case when p_frequency = 'once' then null else p_max_runs end,
           -- Editar recomeça a contagem de envios
           run_count = 0,
           next_run_at = v_next,
           status = 'active',
           last_error = null,
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;

  return v_id;
end;
$$;

-- Pausar / retomar (retomar recalcula o próximo a partir de agora)
create or replace function public.recurring_message_set_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.recurring_messages%rowtype;
  v_next timestamptz;
begin
  select * into v_current from public.recurring_messages where id = p_id for update;
  if not found or not public.can_access_scheduled_message(v_current.clinic_id, v_current.created_by) then
    raise exception 'Mensagem agendada não encontrada.';
  end if;

  if p_status = 'paused' then
    update public.recurring_messages
       set status = 'paused', updated_at = now()
     where id = p_id and status = 'active';
    return;
  end if;

  if p_status <> 'active' then
    raise exception 'Situação inválida.';
  end if;
  if v_current.status = 'finished' then
    raise exception 'Esta mensagem já terminou. Edite para agendar de novo.';
  end if;

  v_next := public.recurring_next_run(
    v_current.frequency, v_current.weekdays, v_current.month_day, v_current.send_time,
    v_current.timezone, v_current.starts_on, v_current.ends_on, now()
  );

  update public.recurring_messages
     set status = case when v_next is null then 'finished' else 'active' end,
         next_run_at = v_next,
         last_error = null,
         updated_at = now()
   where id = p_id;
end;
$$;

create or replace function public.recurring_message_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.recurring_messages%rowtype;
begin
  select * into v_current from public.recurring_messages where id = p_id for update;
  if not found or not public.can_access_scheduled_message(v_current.clinic_id, v_current.created_by) then
    raise exception 'Mensagem agendada não encontrada.';
  end if;
  -- Os envios já feitos continuam nas conversas (recurring_message_id fica nulo)
  delete from public.recurring_messages where id = p_id;
end;
$$;

revoke execute on function public.recurring_message_save(uuid, uuid, text, text, smallint[], smallint, time, date, date, integer, boolean, uuid, text) from public, anon;
revoke execute on function public.recurring_message_set_status(uuid, text) from public, anon;
revoke execute on function public.recurring_message_delete(uuid) from public, anon;
grant execute on function public.recurring_message_save(uuid, uuid, text, text, smallint[], smallint, time, date, date, integer, boolean, uuid, text) to authenticated;
grant execute on function public.recurring_message_set_status(uuid, text) to authenticated;
grant execute on function public.recurring_message_delete(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Gerador (pg_cron, a cada minuto): cria o envio de cada regra vencida
-- -----------------------------------------------------------------------------
create or replace function public.materialize_recurring_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurring_messages%rowtype;
  v_contact record;
  v_sm uuid;
  v_next timestamptz;
  v_done boolean;
  v_count integer := 0;
begin
  for r in
    select * from public.recurring_messages
     where status = 'active' and next_run_at <= now()
     order by next_run_at
     limit 200
     for update skip locked
  loop
    begin
      select c.name, regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') as phone
        into v_contact
        from public.contacts c where c.id = r.contact_id;
      if v_contact.phone is null or v_contact.phone !~ '^\d{10,15}$' then
        raise exception 'Cliente sem telefone de WhatsApp válido.';
      end if;

      insert into public.scheduled_messages (
        clinic_id, created_by, name, message, scheduled_at, channel_connection_id,
        recurring_message_id, reply_window_days
      )
      values (
        r.clinic_id, r.created_by,
        left('Mensagem para ' || coalesce(nullif(btrim(v_contact.name), ''), v_contact.phone), 120),
        r.message, r.next_run_at, r.channel_connection_id, r.id, 7
      )
      returning id into v_sm;

      insert into public.scheduled_message_recipients (scheduled_message_id, position, contact_id, name, phone)
      values (v_sm, 1, r.contact_id, v_contact.name, v_contact.phone);

      -- Próximo a partir de agora: se o sistema ficou parado, não manda os
      -- atrasados todos de uma vez
      v_next := public.recurring_next_run(
        r.frequency, r.weekdays, r.month_day, r.send_time, r.timezone,
        r.starts_on, r.ends_on, greatest(now(), r.next_run_at)
      );
      v_done := r.frequency = 'once'
        or v_next is null
        or (r.max_runs is not null and r.run_count + 1 >= r.max_runs);

      update public.recurring_messages
         set run_count = run_count + 1,
             last_run_at = now(),
             last_error = null,
             next_run_at = case when v_done then null else v_next end,
             status = case when v_done then 'finished' else 'active' end,
             updated_at = now()
       where id = r.id;

      v_count := v_count + 1;
    exception when others then
      -- Ex.: plano sem o recurso, cliente sem telefone: pausa e mostra o motivo
      update public.recurring_messages
         set status = 'paused', last_error = left(sqlerrm, 300), updated_at = now()
       where id = r.id;
    end;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.materialize_recurring_messages() from public, anon, authenticated;
grant execute on function public.materialize_recurring_messages() to service_role;

-- -----------------------------------------------------------------------------
-- Lista de campanhas: envios do cliente (cartão do funil ou recorrentes) fora
-- -----------------------------------------------------------------------------
create or replace view public.scheduled_message_summaries
with (security_invoker = true)
as
select
  sm.id,
  sm.clinic_id,
  sm.created_by,
  sm.name,
  sm.message,
  sm.scheduled_at,
  sm.status,
  sm.started_at,
  sm.finished_at,
  sm.created_at,
  sm.updated_at,
  sm.channel_connection_id,
  sm.conversion_tag_id,
  sm.reply_window_days,
  coalesce(s.total, 0)::integer as total_count,
  coalesce(s.sent, 0)::integer as sent_count,
  coalesce(s.failed, 0)::integer as failed_count,
  coalesce(s.waiting, 0)::integer as waiting_count,
  coalesce(s.cancelled, 0)::integer as cancelled_count,
  coalesce(s.delivered, 0)::integer as delivered_count,
  coalesce(s.read, 0)::integer as read_count,
  coalesce(s.replied, 0)::integer as replied_count,
  coalesce(s.converted, 0)::integer as converted_count,
  coalesce(s.revenue, 0)::numeric(14, 2) as conversion_revenue,
  coalesce(s.preview_names, '{}'::text[]) as preview_names,
  sm.deal_id,
  sm.recurring_message_id
from public.scheduled_messages sm
left join lateral (
  select
    count(*) as total,
    count(*) filter (where r.status = 'sent') as sent,
    count(*) filter (where r.status = 'failed') as failed,
    count(*) filter (where r.status in ('pending', 'sending')) as waiting,
    count(*) filter (where r.status = 'cancelled') as cancelled,
    count(*) filter (where r.status = 'sent' and (r.delivered_at is not null or r.read_at is not null)) as delivered,
    count(*) filter (where r.status = 'sent' and r.read_at is not null) as read,
    count(*) filter (where r.replied_at is not null) as replied,
    count(*) filter (where r.converted_at is not null) as converted,
    sum(r.conversion_value) filter (where r.converted_at is not null) as revenue,
    (array_agg(coalesce(nullif(btrim(r.name), ''), r.phone) order by r.position))[1:2] as preview_names
  from public.scheduled_message_recipients r
  where r.scheduled_message_id = sm.id
) s on true;

grant select on public.scheduled_message_summaries to authenticated;

commit;

-- -----------------------------------------------------------------------------
-- Agendamento do gerador: SQL puro, a cada minuto, só quando há regra vencida
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.unschedule('recurring-messages')
 where exists (select 1 from cron.job where jobname = 'recurring-messages');

select cron.schedule(
  'recurring-messages',
  '* * * * *',
  $$
  select public.materialize_recurring_messages()
  where exists (
    select 1 from public.recurring_messages
    where status = 'active' and next_run_at <= now()
  );
  $$
);
