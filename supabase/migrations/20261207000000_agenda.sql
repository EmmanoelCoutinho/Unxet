-- =============================================================================
-- Agenda
--
--   agenda_professionals          quem atende (médico, dentista, cabeleireiro...).
--                                 Não precisa ter login; pode ser ligado a um
--                                 atendente (user_id).
--   agenda_services               o que se marca, com duração (Consulta 30 min)
--   agenda_professional_services  quais profissionais fazem cada serviço
--   agenda_working_hours          horários de trabalho por dia da semana
--                                 (mais de uma faixa por dia: manhã e tarde)
--   agenda_time_off               folgas, férias e bloqueios de horário
--   agenda_settings               uma linha por empresa: intervalo entre
--                                 horários, antecedência, lembretes
--   appointments                  os agendamentos (cliente da carteira)
--
-- Quem pode: todos da empresa veem a agenda e marcam/desmarcam. Cadastrar
-- profissionais, serviços, horários, folgas e lembretes exige a permissão nova
-- agenda.manage (administrador sempre tem).
--
-- A IA (bot-engine, etapa de IA com agenda ligada) usa agenda_free_slots para
-- oferecer horários e grava pelo service role. Dois agendamentos ativos do
-- mesmo profissional não podem se sobrepor (gatilho com trava por profissional).
--
-- Lembretes: cada agendamento ativo ganha uma mensagem programada
-- (scheduled_messages.appointment_id) que sai pelo mesmo disparador das
-- Campanhas, X horas antes. No WhatsApp oficial vai o modelo aprovado
-- escolhido, com {data}, {hora}, {profissional} e {servico} em
-- scheduled_messages.template_params. Remarcar ou cancelar refaz o lembrete.
--
-- Plano: a agenda existe em todos os planos (sem enforce_plan_feature); o
-- lembrete passa pela trava de plano das mensagens programadas sem cair nela.
--
-- Ordem de deploy: aplique ANTES das edge functions (bot-engine,
-- scheduled-messages-dispatch, whatsapp-templates) e do front.
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
    'messages.delete',
    'contacts.view',
    'leads.all',
    'campaigns.all',
    'meta_templates.create',
    'agenda.manage',
    'bots.manage',
    'ai.manage',
    'reports.view'
  ]::text[];
$$;

-- -----------------------------------------------------------------------------
-- 2. Tabelas
-- -----------------------------------------------------------------------------
create table if not exists public.agenda_professionals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Especialidade ou função (Dermatologista, Cabeleireira)
  specialty text check (specialty is null or char_length(btrim(specialty)) between 1 and 80),
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- Atendente ligado (vê a própria agenda); opcional
  user_id uuid references auth.users (id) on delete set null,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agenda_professionals_clinic_idx
  on public.agenda_professionals (clinic_id, position);

create table if not exists public.agenda_services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 600),
  -- Preço que a IA pode informar; vazio = não informa
  price numeric(12, 2) check (price is null or price >= 0),
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agenda_services_clinic_idx
  on public.agenda_services (clinic_id, position);

create table if not exists public.agenda_professional_services (
  professional_id uuid not null references public.agenda_professionals (id) on delete cascade,
  service_id uuid not null references public.agenda_services (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  primary key (professional_id, service_id)
);

create index if not exists agenda_professional_services_service_idx
  on public.agenda_professional_services (service_id);

create table if not exists public.agenda_working_hours (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.agenda_professionals (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- 0 = domingo ... 6 = sábado (extract(dow))
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  constraint agenda_working_hours_range check (end_time > start_time)
);

create index if not exists agenda_working_hours_professional_idx
  on public.agenda_working_hours (professional_id, weekday, start_time);

create table if not exists public.agenda_time_off (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.agenda_professionals (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (reason is null or char_length(reason) <= 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint agenda_time_off_range check (ends_at > starts_at)
);

create index if not exists agenda_time_off_professional_idx
  on public.agenda_time_off (professional_id, starts_at);

create table if not exists public.agenda_settings (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo',
  -- De quanto em quanto tempo os horários livres começam
  slot_step_minutes integer not null default 30
    check (slot_step_minutes in (5, 10, 15, 20, 30, 45, 60)),
  -- A IA não marca com menos antecedência que isso
  min_notice_minutes integer not null default 60 check (min_notice_minutes between 0 and 10080),
  -- Nem mais longe que isso
  max_days_ahead integer not null default 60 check (max_days_ahead between 1 and 365),
  reminder_enabled boolean not null default false,
  reminder_hours_before integer not null default 24 check (reminder_hours_before between 1 and 168),
  -- Número por onde o lembrete sai; no oficial, com o modelo aprovado abaixo
  reminder_connection_id uuid references public.channel_connections (id) on delete set null,
  reminder_template_id uuid references public.message_templates (id) on delete set null,
  -- Texto do lembrete no WhatsApp por QR Code
  reminder_message text not null default
    'Olá, {nome}! Passando para lembrar do seu horário de {servico} com {profissional} em {data}, às {hora}. Se precisar remarcar, é só responder esta mensagem.'
    check (char_length(btrim(reminder_message)) between 1 and 1000),
  updated_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- Profissional com agendamentos não some (a tela desativa em vez de apagar)
  professional_id uuid not null references public.agenda_professionals (id) on delete restrict,
  service_id uuid references public.agenda_services (id) on delete set null,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled')),
  notes text check (notes is null or char_length(notes) <= 1000),
  -- manual = pela tela; ai = pela IA no WhatsApp
  source text not null default 'manual' check (source in ('manual', 'ai')),
  conversation_id uuid references public.conversations (id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  confirmed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_range check (ends_at > starts_at),
  constraint appointments_max_length check (ends_at - starts_at <= interval '12 hours')
);

create index if not exists appointments_calendar_idx
  on public.appointments (clinic_id, starts_at);
create index if not exists appointments_professional_idx
  on public.appointments (professional_id, starts_at)
  where status in ('scheduled', 'confirmed');
create index if not exists appointments_contact_idx
  on public.appointments (contact_id, starts_at);

-- Lembrete de agendamento: uma mensagem programada por agendamento
alter table public.scheduled_messages
  add column if not exists appointment_id uuid references public.appointments (id) on delete cascade,
  -- Valores das variáveis do modelo da Meta além de {nome} (ex.: {"data": "..."})
  add column if not exists template_params jsonb;

create index if not exists scheduled_messages_appointment_idx
  on public.scheduled_messages (appointment_id) where appointment_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Consistência: tudo da mesma empresa, sem sobreposição
-- -----------------------------------------------------------------------------
create or replace function public.agenda_professional_in_clinic()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.agenda_professionals p
    where p.id = new.professional_id and p.clinic_id = new.clinic_id
  ) then
    raise exception 'Profissional não encontrado nesta empresa.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.agenda_professional_in_clinic() from public, anon, authenticated;

drop trigger if exists agenda_working_hours_clinic on public.agenda_working_hours;
create trigger agenda_working_hours_clinic
  before insert or update on public.agenda_working_hours
  for each row execute function public.agenda_professional_in_clinic();

drop trigger if exists agenda_time_off_clinic on public.agenda_time_off;
create trigger agenda_time_off_clinic
  before insert or update on public.agenda_time_off
  for each row execute function public.agenda_professional_in_clinic();

create or replace function public.agenda_professional_services_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.agenda_professionals p
    where p.id = new.professional_id and p.clinic_id = new.clinic_id
  ) or not exists (
    select 1 from public.agenda_services s
    where s.id = new.service_id and s.clinic_id = new.clinic_id
  ) then
    raise exception 'Profissional ou serviço não encontrado nesta empresa.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.agenda_professional_services_check() from public, anon, authenticated;

drop trigger if exists agenda_professional_services_check on public.agenda_professional_services;
create trigger agenda_professional_services_check
  before insert or update on public.agenda_professional_services
  for each row execute function public.agenda_professional_services_check();

create or replace function public.agenda_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agenda_professionals_touch on public.agenda_professionals;
create trigger agenda_professionals_touch
  before update on public.agenda_professionals
  for each row execute function public.agenda_touch_updated_at();

drop trigger if exists agenda_services_touch on public.agenda_services;
create trigger agenda_services_touch
  before update on public.agenda_services
  for each row execute function public.agenda_touch_updated_at();

drop trigger if exists agenda_settings_touch on public.agenda_settings;
create trigger agenda_settings_touch
  before update on public.agenda_settings
  for each row execute function public.agenda_touch_updated_at();

-- Lembrete: número e modelo precisam ser da própria empresa
create or replace function public.agenda_settings_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reminder_connection_id is not null and not exists (
    select 1 from public.channel_connections cc
    where cc.id = new.reminder_connection_id and cc.clinic_id = new.clinic_id
  ) then
    raise exception 'Número de WhatsApp não encontrado nesta empresa.' using errcode = 'P0001';
  end if;
  if new.reminder_template_id is not null and not exists (
    select 1 from public.message_templates mt
    where mt.id = new.reminder_template_id and mt.clinic_id = new.clinic_id
  ) then
    raise exception 'Modelo não encontrado nesta empresa.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_timezone_names tz where tz.name = new.timezone) then
    raise exception 'Fuso horário inválido.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.agenda_settings_check() from public, anon, authenticated;

drop trigger if exists agenda_settings_check on public.agenda_settings;
create trigger agenda_settings_check
  before insert or update on public.agenda_settings
  for each row execute function public.agenda_settings_check();

create or replace function public.appointments_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.agenda_professionals p
    where p.id = new.professional_id and p.clinic_id = new.clinic_id
  ) then
    raise exception 'Profissional não encontrado nesta empresa.' using errcode = 'P0001';
  end if;
  if new.service_id is not null and not exists (
    select 1 from public.agenda_services s
    where s.id = new.service_id and s.clinic_id = new.clinic_id
  ) then
    raise exception 'Serviço não encontrado nesta empresa.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.contacts c
    where c.id = new.contact_id and c.clinic_id = new.clinic_id
  ) then
    raise exception 'Cliente não encontrado nesta empresa.' using errcode = 'P0001';
  end if;
  if new.conversation_id is not null and not exists (
    select 1 from public.conversations cv
    where cv.id = new.conversation_id and cv.clinic_id = new.clinic_id
  ) then
    new.conversation_id := null;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := now();
  else
    -- Empresa, origem e autor não mudam depois de criado
    new.clinic_id := old.clinic_id;
    new.source := old.source;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  if new.status = 'cancelled' then
    if tg_op = 'INSERT' or old.status <> 'cancelled' then
      new.cancelled_at := now();
    end if;
  else
    new.cancelled_at := null;
    new.cancel_reason := null;
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then
    new.confirmed_at := now();
  end if;

  -- Sem sobreposição no mesmo profissional (trava por profissional evita que
  -- dois pedidos ao mesmo tempo marquem o mesmo horário)
  if new.status in ('scheduled', 'confirmed') then
    perform pg_advisory_xact_lock(hashtextextended('agenda:' || new.professional_id::text, 0));
    if exists (
      select 1 from public.appointments a
      where a.professional_id = new.professional_id
        and a.id <> new.id
        and a.status in ('scheduled', 'confirmed')
        and a.starts_at < new.ends_at
        and a.ends_at > new.starts_at
    ) then
      raise exception 'Este horário já está ocupado para este profissional.' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.appointments_before_write() from public, anon, authenticated;

drop trigger if exists appointments_before_write on public.appointments;
create trigger appointments_before_write
  before insert or update on public.appointments
  for each row execute function public.appointments_before_write();

-- -----------------------------------------------------------------------------
-- 4. Acesso
-- -----------------------------------------------------------------------------
alter table public.agenda_professionals enable row level security;
alter table public.agenda_services enable row level security;
alter table public.agenda_professional_services enable row level security;
alter table public.agenda_working_hours enable row level security;
alter table public.agenda_time_off enable row level security;
alter table public.agenda_settings enable row level security;
alter table public.appointments enable row level security;

revoke all on public.agenda_professionals from anon, authenticated;
revoke all on public.agenda_services from anon, authenticated;
revoke all on public.agenda_professional_services from anon, authenticated;
revoke all on public.agenda_working_hours from anon, authenticated;
revoke all on public.agenda_time_off from anon, authenticated;
revoke all on public.agenda_settings from anon, authenticated;
revoke all on public.appointments from anon, authenticated;

grant select, insert, update, delete on public.agenda_professionals to authenticated;
grant select, insert, update, delete on public.agenda_services to authenticated;
grant select, insert, update, delete on public.agenda_professional_services to authenticated;
grant select, insert, update, delete on public.agenda_working_hours to authenticated;
grant select, insert, update, delete on public.agenda_time_off to authenticated;
grant select, insert, update on public.agenda_settings to authenticated;
-- Agendamento não se apaga: cancela (fica no histórico do cliente)
grant select, insert, update on public.appointments to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'agenda_professionals',
    'agenda_services',
    'agenda_professional_services',
    'agenda_working_hours',
    'agenda_time_off',
    'agenda_settings'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_clinic_member(clinic_id))',
      t || '_select', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.has_clinic_permission(clinic_id, ''agenda.manage'')) '
      'with check (public.has_clinic_permission(clinic_id, ''agenda.manage''))',
      t || '_write', t
    );
  end loop;
end $$;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.is_clinic_member(clinic_id) and source = 'manual');

drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments for update to authenticated
  using (public.is_clinic_member(clinic_id))
  with check (public.is_clinic_member(clinic_id));

-- -----------------------------------------------------------------------------
-- 5. Horários livres (tela e IA)
-- -----------------------------------------------------------------------------
-- Horários em que o serviço cabe inteiro dentro do expediente, sem
-- agendamento ativo nem folga no meio, respeitando a antecedência mínima e o
-- limite de dias. p_professional_id vazio = todos que fazem o serviço.
create or replace function public.agenda_free_slots(
  p_clinic_id uuid,
  p_service_id uuid,
  p_professional_id uuid default null,
  p_from date default null,
  p_days integer default 7,
  p_limit integer default 200
)
returns table (
  professional_id uuid,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := 'America/Sao_Paulo';
  v_step integer := 30;
  v_notice integer := 60;
  v_max_days integer := 60;
  v_duration integer;
  v_today date;
  v_from date;
  v_to date;
begin
  -- Pela tela: só quem é da empresa. Pelo service role (IA): auth.uid() vazio
  if auth.uid() is not null and not public.is_clinic_member(p_clinic_id) then
    raise exception 'Sem acesso a esta empresa.' using errcode = '42501';
  end if;

  select s.timezone, s.slot_step_minutes, s.min_notice_minutes, s.max_days_ahead
    into v_tz, v_step, v_notice, v_max_days
    from public.agenda_settings s
   where s.clinic_id = p_clinic_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_step := coalesce(v_step, 30);
  v_notice := coalesce(v_notice, 60);
  v_max_days := coalesce(v_max_days, 60);

  select sv.duration_minutes into v_duration
    from public.agenda_services sv
   where sv.id = p_service_id and sv.clinic_id = p_clinic_id and sv.active;
  if v_duration is null then
    return;
  end if;

  v_today := (now() at time zone v_tz)::date;
  v_from := greatest(coalesce(p_from, v_today), v_today);
  v_to := least(v_from + greatest(1, least(coalesce(p_days, 7), 31)) - 1, v_today + v_max_days);
  if v_to < v_from then
    return;
  end if;

  return query
  with days as (
    select d::date as day
    from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d
  ),
  profs as (
    select p.id
    from public.agenda_professionals p
    join public.agenda_professional_services ps
      on ps.professional_id = p.id and ps.service_id = p_service_id
    where p.clinic_id = p_clinic_id
      and p.active
      and (p_professional_id is null or p.id = p_professional_id)
  ),
  windows as (
    select
      pr.id as prof_id,
      (dy.day + wh.start_time) at time zone v_tz as w_start,
      (dy.day + wh.end_time) at time zone v_tz as w_end
    from profs pr
    cross join days dy
    join public.agenda_working_hours wh
      on wh.professional_id = pr.id
     and wh.weekday = extract(dow from dy.day)::smallint
  ),
  candidates as (
    select
      w.prof_id,
      gs as s_start,
      gs + make_interval(mins => v_duration) as s_end
    from windows w
    cross join lateral generate_series(
      w.w_start,
      w.w_end - make_interval(mins => v_duration),
      make_interval(mins => v_step)
    ) gs
  )
  select c.prof_id, c.s_start, c.s_end
  from candidates c
  where c.s_start >= now() + make_interval(mins => v_notice)
    and not exists (
      select 1 from public.appointments a
      where a.professional_id = c.prof_id
        and a.status in ('scheduled', 'confirmed')
        and a.starts_at < c.s_end
        and a.ends_at > c.s_start
    )
    and not exists (
      select 1 from public.agenda_time_off t
      where t.professional_id = c.prof_id
        and t.starts_at < c.s_end
        and t.ends_at > c.s_start
    )
  order by c.s_start, c.prof_id
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke execute on function public.agenda_free_slots(uuid, uuid, uuid, date, integer, integer) from public, anon;
grant execute on function public.agenda_free_slots(uuid, uuid, uuid, date, integer, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Lembretes
-- -----------------------------------------------------------------------------
-- Texto de data/hora no fuso da empresa: "sexta-feira, 28/11" e "14:30"
create or replace function public.agenda_format_date(p_at timestamptz, p_tz text)
returns text
language sql
stable
set search_path = public
as $$
  select (array[
      'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
      'quinta-feira', 'sexta-feira', 'sábado'
    ])[extract(dow from (p_at at time zone p_tz))::integer + 1]
    || ', ' || to_char(p_at at time zone p_tz, 'DD/MM');
$$;

create or replace function public.agenda_reminder_params(p_appointment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'data', public.agenda_format_date(a.starts_at, coalesce(s.timezone, 'America/Sao_Paulo')),
    'hora', to_char(a.starts_at at time zone coalesce(s.timezone, 'America/Sao_Paulo'), 'HH24:MI'),
    'profissional', p.name,
    'servico', coalesce(sv.name, 'atendimento')
  )
  from public.appointments a
  join public.agenda_professionals p on p.id = a.professional_id
  left join public.agenda_services sv on sv.id = a.service_id
  left join public.agenda_settings s on s.clinic_id = a.clinic_id
  where a.id = p_appointment_id;
$$;

revoke execute on function public.agenda_format_date(timestamptz, text) from public, anon;
grant execute on function public.agenda_format_date(timestamptz, text) to authenticated, service_role;
revoke execute on function public.agenda_reminder_params(uuid) from public, anon, authenticated;
grant execute on function public.agenda_reminder_params(uuid) to service_role;

-- Troca as variáveis do texto ({nome} fica para o disparador)
create or replace function public.agenda_render_text(p_text text, p_params jsonb)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(coalesce(p_text, ''),
    '{data}', coalesce(p_params ->> 'data', '')),
    '{hora}', coalesce(p_params ->> 'hora', '')),
    '{profissional}', coalesce(p_params ->> 'profissional', '')),
    '{servico}', coalesce(p_params ->> 'servico', ''));
$$;

-- Refaz o lembrete de um agendamento: apaga o que ainda não saiu e cria de
-- novo se o agendamento continua ativo e o lembrete está ligado.
create or replace function public.agenda_sync_reminder(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt public.appointments%rowtype;
  v_settings public.agenda_settings%rowtype;
  v_contact record;
  v_connection record;
  v_template_id uuid;
  v_template_body text;
  v_params jsonb;
  v_at timestamptz;
  v_text text;
  v_message_id uuid;
begin
  delete from public.scheduled_messages
   where appointment_id = p_appointment_id
     and status = 'scheduled';

  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found or v_appt.status not in ('scheduled', 'confirmed') then
    return;
  end if;

  select * into v_settings from public.agenda_settings where clinic_id = v_appt.clinic_id;
  if not found or not v_settings.reminder_enabled or v_settings.reminder_connection_id is null then
    return;
  end if;

  v_at := v_appt.starts_at - make_interval(hours => v_settings.reminder_hours_before);
  -- Marcado dentro da janela do lembrete: não manda (acabou de combinar)
  if v_at < now() + interval '2 minutes' then
    return;
  end if;

  select c.id, c.name, regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') as phone
    into v_contact
    from public.contacts c
   where c.id = v_appt.contact_id;
  if v_contact.id is null or char_length(v_contact.phone) < 10 then
    return;
  end if;

  select cc.id, cc.provider into v_connection
    from public.channel_connections cc
   where cc.id = v_settings.reminder_connection_id
     and cc.clinic_id = v_appt.clinic_id
     and cc.archived_at is null;
  if v_connection.id is null then
    return;
  end if;

  v_params := public.agenda_reminder_params(p_appointment_id);

  if v_connection.provider = 'meta' then
    -- Oficial: só com modelo aprovado do mesmo número
    select mt.id, mt.body into v_template_id, v_template_body
      from public.message_templates mt
     where mt.id = v_settings.reminder_template_id
       and mt.clinic_id = v_appt.clinic_id
       and mt.status = 'approved'
       and (mt.channel_connection_id is null or mt.channel_connection_id = v_connection.id);
    if v_template_id is null then
      return;
    end if;
    v_text := public.agenda_render_text(v_template_body, v_params);
  else
    v_text := public.agenda_render_text(v_settings.reminder_message, v_params);
  end if;

  insert into public.scheduled_messages (
    clinic_id, created_by, name, message, scheduled_at, status,
    channel_connection_id, template_id, appointment_id, template_params
  ) values (
    v_appt.clinic_id, null, 'Lembrete de agendamento', left(v_text, 4000), v_at, 'scheduled',
    v_connection.id,
    v_template_id,
    p_appointment_id,
    v_params
  )
  returning id into v_message_id;

  insert into public.scheduled_message_recipients (
    scheduled_message_id, position, contact_id, name, phone
  ) values (
    v_message_id, 0, v_contact.id, v_contact.name, v_contact.phone
  );
end;
$$;

revoke execute on function public.agenda_sync_reminder(uuid) from public, anon, authenticated;

create or replace function public.appointments_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status = old.status
     and new.starts_at = old.starts_at
     and new.professional_id = old.professional_id
     and new.service_id is not distinct from old.service_id
     and new.contact_id = old.contact_id then
    return null;
  end if;
  perform public.agenda_sync_reminder(new.id);
  return null;
end;
$$;

revoke execute on function public.appointments_after_write() from public, anon, authenticated;

drop trigger if exists appointments_after_write on public.appointments;
create trigger appointments_after_write
  after insert or update on public.appointments
  for each row execute function public.appointments_after_write();

-- Mudou a configuração do lembrete: refaz os lembretes dos próximos horários
create or replace function public.agenda_settings_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.reminder_enabled = old.reminder_enabled
     and new.reminder_hours_before = old.reminder_hours_before
     and new.reminder_connection_id is not distinct from old.reminder_connection_id
     and new.reminder_template_id is not distinct from old.reminder_template_id
     and new.reminder_message = old.reminder_message
     and new.timezone = old.timezone then
    return null;
  end if;
  for v_id in
    select a.id from public.appointments a
     where a.clinic_id = new.clinic_id
       and a.status in ('scheduled', 'confirmed')
       and a.starts_at > now()
  loop
    perform public.agenda_sync_reminder(v_id);
  end loop;
  return null;
end;
$$;

revoke execute on function public.agenda_settings_after_write() from public, anon, authenticated;

drop trigger if exists agenda_settings_after_write on public.agenda_settings;
create trigger agenda_settings_after_write
  after insert or update on public.agenda_settings
  for each row execute function public.agenda_settings_after_write();

-- Nome do profissional ou do serviço mudou: o texto do lembrete acompanha
create or replace function public.agenda_names_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if new.name = old.name then
    return null;
  end if;
  for v_id in
    select a.id from public.appointments a
     where a.status in ('scheduled', 'confirmed')
       and a.starts_at > now()
       and (
         (tg_table_name = 'agenda_professionals' and a.professional_id = new.id)
         or (tg_table_name = 'agenda_services' and a.service_id = new.id)
       )
  loop
    perform public.agenda_sync_reminder(v_id);
  end loop;
  return null;
end;
$$;

revoke execute on function public.agenda_names_after_update() from public, anon, authenticated;

drop trigger if exists agenda_professionals_names on public.agenda_professionals;
create trigger agenda_professionals_names
  after update of name on public.agenda_professionals
  for each row execute function public.agenda_names_after_update();

drop trigger if exists agenda_services_names on public.agenda_services;
create trigger agenda_services_names
  after update of name on public.agenda_services
  for each row execute function public.agenda_names_after_update();

-- -----------------------------------------------------------------------------
-- 7. Lembrete passa pelas travas das Campanhas
-- -----------------------------------------------------------------------------
-- Trava de plano: o lembrete da agenda existe em todos os planos. to_jsonb
-- porque as outras tabelas com esta trava não têm appointment_id.
create or replace function public.enforce_plan_feature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feature text := tg_argv[0];
  -- Frase pronta com a concordância certa, ex.: "Bots não fazem parte"
  v_label text := tg_argv[1];
begin
  -- O departamento padrão é criado no onboarding e existe em todos os planos.
  -- IFs aninhados: as outras tabelas não têm is_default
  if tg_table_name = 'departments' then
    if new.is_default then
      return new;
    end if;
  end if;

  if tg_table_name = 'scheduled_messages' then
    if (to_jsonb(new) ->> 'appointment_id') is not null then
      return new;
    end if;
  end if;

  if not public.clinic_has_feature(new.clinic_id, v_feature) then
    raise exception '% do plano %.', v_label, (public.clinic_plan(new.clinic_id)).name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- QR Code: lembrete de um cliente só, como a mensagem do funil
create or replace function public.block_qr_campaigns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scheduled_messages%rowtype;
begin
  -- Disparador, cron e migrations: sem usuário, sem trava
  if auth.uid() is null then
    return null;
  end if;

  -- Estado no fim da transação (deal_id pode ter sido preenchido depois)
  select * into v_row from public.scheduled_messages where id = new.id;
  if not found then
    return null;
  end if;

  if v_row.status in ('scheduled', 'processing')
     and v_row.template_id is null
     and v_row.deal_id is null
     and v_row.recurring_message_id is null
     and v_row.appointment_id is null then
    raise exception 'Campanhas pelo WhatsApp por QR Code foram desativadas para proteger o seu número de bloqueio. Use o WhatsApp oficial (API da Meta) com um modelo aprovado.'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

revoke execute on function public.block_qr_campaigns() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Tempo real: a tela atualiza quando a IA marca ou desmarca
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Etapa de IA: pode mexer na agenda?
-- -----------------------------------------------------------------------------
alter table public.bot_nodes
  add column if not exists ai_agenda_enabled boolean not null default false;

commit;
