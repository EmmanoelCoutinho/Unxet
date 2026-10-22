-- =============================================================================
-- Planos e assinaturas das empresas
--
-- 1. subscription_plans: os três planos (Essencial, Profissional, Empresarial)
--    com o limite de atendentes, de números de WhatsApp e os recursos de cada
--    um. NULL nos limites = ilimitado.
--
-- 2. clinic_subscriptions: plano, situação (teste, ativa, inadimplente,
--    cancelada) e vencimento de cada empresa. Controle manual pela aba
--    "Assinantes" do painel da Unxet; a empresa só lê a própria linha. A
--    situação e o vencimento são só para acompanhamento: o app não bloqueia
--    a empresa por estar vencida ou inadimplente.
--    Empresas que já existem entram no Empresarial (ninguém perde recurso).
--    Empresa sem linha também vale como Empresarial.
--
-- 3. Travas no banco para o que a empresa não pode usar no plano:
--      - atendentes acima do limite (clinic_users);
--      - Instagram/Messenger fora do plano (channel_connections);
--      - bots, departamentos extras, mensagens programadas e chat interno.
--    O limite de números de WhatsApp é conferido pelas edge functions de
--    conexão (create-evolution-connection, whatsapp-connect), antes de gerar
--    o QR Code ou concluir o cadastro na Meta. Bots, transcrição de áudio e
--    transferências são barrados nas edge functions correspondentes.
--    Rebaixar o plano não apaga nada: o que já existe fica, só não dá para
--    criar mais, e o painel aponta o que está acima do plano.
--
-- 4. platform_subscriptions / platform_set_subscription: leitura e edição
--    pelo painel (só platform_admins). platform_onboard_clinic passa a
--    receber o plano da nova empresa.
--
-- Ordem de deploy: aplique ANTES de publicar as edge functions
-- (admin-onboard-clinic, invite-attendant, create-evolution-connection,
-- whatsapp-connect, transfer-conversation, bot-engine e as que transcrevem
-- áudio) e o frontend desta entrega.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Planos
-- -----------------------------------------------------------------------------
create table if not exists public.subscription_plans (
  code text primary key,
  name text not null,
  position integer not null,
  max_attendants integer check (max_attendants is null or max_attendants > 0),
  max_whatsapp_numbers integer check (max_whatsapp_numbers is null or max_whatsapp_numbers > 0),
  -- social_channels, bots, departments, scheduled_messages, analytics,
  -- audio_transcription, internal_chat
  features text[] not null default '{}'
);

insert into public.subscription_plans (code, name, position, max_attendants, max_whatsapp_numbers, features)
values
  ('essencial', 'Essencial', 1, 3, 1, '{}'),
  ('profissional', 'Profissional', 2, 10, 1, array[
    'social_channels', 'bots', 'departments', 'scheduled_messages',
    'analytics', 'audio_transcription', 'internal_chat'
  ]),
  ('empresarial', 'Empresarial', 3, null, null, array[
    'social_channels', 'bots', 'departments', 'scheduled_messages',
    'analytics', 'audio_transcription', 'internal_chat'
  ])
on conflict (code) do update set
  name = excluded.name,
  position = excluded.position,
  max_attendants = excluded.max_attendants,
  max_whatsapp_numbers = excluded.max_whatsapp_numbers,
  features = excluded.features;

alter table public.subscription_plans enable row level security;

revoke all on table public.subscription_plans from anon, authenticated;
grant select on table public.subscription_plans to authenticated;

drop policy if exists subscription_plans_select on public.subscription_plans;
create policy subscription_plans_select
  on public.subscription_plans
  for select
  to authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- 2. Assinatura de cada empresa
-- -----------------------------------------------------------------------------
create table if not exists public.clinic_subscriptions (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  plan_code text not null default 'essencial' references public.subscription_plans (code),
  status text not null default 'active'
    check (status in ('trial', 'active', 'past_due', 'canceled')),
  -- Até quando está paga (ou até quando vai o teste)
  current_period_end date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.clinic_subscriptions (clinic_id, plan_code, status)
select c.id, 'empresarial', 'active'
from public.clinics c
on conflict (clinic_id) do nothing;

alter table public.clinic_subscriptions enable row level security;

-- Escrita só pelas funções do painel (security definer)
revoke all on table public.clinic_subscriptions from anon, authenticated;
grant select on table public.clinic_subscriptions to authenticated;

drop policy if exists clinic_subscriptions_select_member on public.clinic_subscriptions;
create policy clinic_subscriptions_select_member
  on public.clinic_subscriptions
  for select
  to authenticated
  using (public.is_clinic_member(clinic_id));

-- -----------------------------------------------------------------------------
-- 3. Consultas de plano usadas pelas travas e pelas edge functions
-- -----------------------------------------------------------------------------
create or replace function public.clinic_plan(p_clinic_id uuid)
returns public.subscription_plans
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.subscription_plans p
  where p.code = coalesce(
    (select s.plan_code from public.clinic_subscriptions s where s.clinic_id = p_clinic_id),
    'empresarial'
  );
$$;

create or replace function public.clinic_has_feature(p_clinic_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_feature = any ((public.clinic_plan(p_clinic_id)).features), false);
$$;

-- Vaga para mais um atendente. Reconvidar quem já é da empresa não ocupa vaga.
create or replace function public.clinic_can_add_attendant(
  p_clinic_id uuid,
  p_email text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_max integer := (public.clinic_plan(p_clinic_id)).max_attendants;
  v_count integer;
begin
  if v_max is null then
    return true;
  end if;

  if p_email is not null and exists (
    select 1 from public.clinic_users cu
    where cu.clinic_id = p_clinic_id
      and lower(cu.email) = lower(btrim(p_email))
  ) then
    return true;
  end if;

  select count(*) into v_count
  from public.clinic_users cu
  where cu.clinic_id = p_clinic_id;

  return v_count < v_max;
end;
$$;

-- Vaga para mais um número de WhatsApp conectado, sem contar a própria
-- conexão que está sendo ligada. "Conectando" não conta: um QR Code gerado e
-- abandonado fica nesse estado e travaria a troca para o WhatsApp oficial.
create or replace function public.clinic_can_use_whatsapp_number(
  p_clinic_id uuid,
  p_connection_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_max integer := (public.clinic_plan(p_clinic_id)).max_whatsapp_numbers;
  v_count integer;
begin
  if v_max is null then
    return true;
  end if;

  select count(*) into v_count
  from public.channel_connections cc
  where cc.clinic_id = p_clinic_id
    and cc.channel = 'whatsapp'
    and cc.status = 'connected'
    and (p_connection_id is null or cc.id <> p_connection_id);

  return v_count < v_max;
end;
$$;

-- O app lê o plano pelas tabelas (RLS); as funções servem às travas e às
-- edge functions, e não podem revelar o plano de outra empresa
revoke execute on function public.clinic_plan(uuid) from public, anon, authenticated;
revoke execute on function public.clinic_has_feature(uuid, text) from public, anon, authenticated;
revoke execute on function public.clinic_can_add_attendant(uuid, text) from public, anon, authenticated;
revoke execute on function public.clinic_can_use_whatsapp_number(uuid, uuid) from public, anon, authenticated;
grant execute on function public.clinic_plan(uuid) to service_role;
grant execute on function public.clinic_has_feature(uuid, text) to service_role;
grant execute on function public.clinic_can_add_attendant(uuid, text) to service_role;
grant execute on function public.clinic_can_use_whatsapp_number(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Travas
-- -----------------------------------------------------------------------------
create or replace function public.enforce_plan_attendants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.subscription_plans := public.clinic_plan(new.clinic_id);
begin
  -- Upsert de quem já é da empresa (reconvite): o gatilho roda antes do
  -- ON CONFLICT, mas não ocupa vaga nova
  if exists (
    select 1 from public.clinic_users cu
    where cu.user_id = new.user_id and cu.clinic_id = new.clinic_id
  ) then
    return new;
  end if;

  if v_plan.max_attendants is not null
     and (select count(*) from public.clinic_users cu where cu.clinic_id = new.clinic_id)
         >= v_plan.max_attendants then
    raise exception 'O plano % permite até % atendentes.', v_plan.name, v_plan.max_attendants
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_plan_attendants on public.clinic_users;
create trigger enforce_plan_attendants
  before insert on public.clinic_users
  for each row execute function public.enforce_plan_attendants();

create or replace function public.enforce_plan_channels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.channel in ('instagram', 'messenger')
     and not public.clinic_has_feature(new.clinic_id, 'social_channels') then
    raise exception 'Instagram e Messenger não fazem parte do plano %.', (public.clinic_plan(new.clinic_id)).name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_plan_channels on public.channel_connections;
create trigger enforce_plan_channels
  before insert on public.channel_connections
  for each row execute function public.enforce_plan_channels();

-- Uma função para os recursos ligados/desligados: o recurso vem do gatilho
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

  if not public.clinic_has_feature(new.clinic_id, v_feature) then
    raise exception '% do plano %.', v_label, (public.clinic_plan(new.clinic_id)).name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_plan_feature on public.bots;
create trigger enforce_plan_feature
  before insert on public.bots
  for each row execute function public.enforce_plan_feature('bots', 'Bots não fazem parte');

drop trigger if exists enforce_plan_feature on public.departments;
create trigger enforce_plan_feature
  before insert on public.departments
  for each row execute function public.enforce_plan_feature('departments', 'Departamentos não fazem parte');

drop trigger if exists enforce_plan_feature on public.scheduled_messages;
create trigger enforce_plan_feature
  before insert on public.scheduled_messages
  for each row execute function public.enforce_plan_feature('scheduled_messages', 'Mensagens programadas não fazem parte');

-- Roda depois de internal_chat_messages_before_insert (ordem alfabética),
-- que preenche o clinic_id a partir da conversa
drop trigger if exists internal_chat_messages_plan_check on public.internal_chat_messages;
create trigger internal_chat_messages_plan_check
  before insert on public.internal_chat_messages
  for each row execute function public.enforce_plan_feature('internal_chat', 'Chat interno não faz parte');

revoke execute on function public.enforce_plan_attendants() from public, anon, authenticated;
revoke execute on function public.enforce_plan_channels() from public, anon, authenticated;
revoke execute on function public.enforce_plan_feature() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Painel: lista de assinantes com uso
-- -----------------------------------------------------------------------------
create or replace function public.platform_subscriptions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.platform_admins pa where pa.user_id = auth.uid()
     ) then
    raise exception 'Não autorizado' using errcode = '42501';
  end if;

  with
  people as (
    select
      cu.clinic_id,
      count(*) as attendants,
      count(*) filter (where cu.accepted_at is null) as pending_invites
    from public.clinic_users cu
    group by cu.clinic_id
  ),
  channel as (
    select
      cc.clinic_id,
      count(*) filter (where cc.channel = 'whatsapp') as whatsapp,
      count(*) filter (where cc.channel = 'instagram') as instagram,
      count(*) filter (where cc.channel = 'messenger') as messenger
    from public.channel_connections cc
    where cc.status = 'connected'
    group by cc.clinic_id
  ),
  bot as (
    select b.clinic_id, count(*) as active
    from public.bots b
    where b.status = 'active' and not b.is_deleted
    group by b.clinic_id
  ),
  dept as (
    select d.clinic_id, count(*) as extra
    from public.departments d
    where not d.is_default and d.is_active
    group by d.clinic_id
  ),
  scheduled as (
    select sm.clinic_id, count(*) as pending
    from public.scheduled_messages sm
    where sm.status in ('scheduled', 'processing')
    group by sm.clinic_id
  ),
  last_msg as (
    select c.clinic_id, max(c.last_message_at) as last_message_at
    from public.conversations c
    where c.clinic_id is not null
    group by c.clinic_id
  )
  select jsonb_build_object(
    'generated_at', now(),
    'plans', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p.position), '[]'::jsonb)
      from public.subscription_plans p
    ),
    'clinics', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'created_at', c.created_at,
          'plan_code', coalesce(s.plan_code, 'empresarial'),
          'status', coalesce(s.status, 'active'),
          'current_period_end', s.current_period_end,
          'notes', s.notes,
          'updated_at', s.updated_at,
          'attendants', coalesce(pe.attendants, 0),
          'pending_invites', coalesce(pe.pending_invites, 0),
          'whatsapp', coalesce(ch.whatsapp, 0),
          'instagram', coalesce(ch.instagram, 0),
          'messenger', coalesce(ch.messenger, 0),
          'active_bots', coalesce(bo.active, 0),
          'extra_departments', coalesce(de.extra, 0),
          'pending_scheduled', coalesce(sc.pending, 0),
          'last_message_at', lm.last_message_at
        )
        order by c.name
      )
      from public.clinics c
      left join public.clinic_subscriptions s on s.clinic_id = c.id
      left join people pe on pe.clinic_id = c.id
      left join channel ch on ch.clinic_id = c.id
      left join bot bo on bo.clinic_id = c.id
      left join dept de on de.clinic_id = c.id
      left join scheduled sc on sc.clinic_id = c.id
      left join last_msg lm on lm.clinic_id = c.id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.platform_set_subscription(
  p_clinic_id uuid,
  p_plan_code text,
  p_status text,
  p_current_period_end date default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.platform_admins pa where pa.user_id = auth.uid()
     ) then
    raise exception 'Não autorizado' using errcode = '42501';
  end if;

  if not exists (select 1 from public.clinics c where c.id = p_clinic_id) then
    raise exception 'Empresa não encontrada';
  end if;

  insert into public.clinic_subscriptions (
    clinic_id, plan_code, status, current_period_end, notes, updated_at, updated_by
  )
  values (
    p_clinic_id,
    p_plan_code,
    p_status,
    p_current_period_end,
    nullif(btrim(p_notes), ''),
    now(),
    auth.uid()
  )
  on conflict (clinic_id) do update set
    plan_code = excluded.plan_code,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    notes = excluded.notes,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

revoke execute on function public.platform_subscriptions() from public, anon;
revoke execute on function public.platform_set_subscription(uuid, text, text, date, text) from public, anon;
grant execute on function public.platform_subscriptions() to authenticated;
grant execute on function public.platform_set_subscription(uuid, text, text, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Onboarding: a nova empresa já nasce com o plano escolhido
-- -----------------------------------------------------------------------------
drop function if exists public.platform_onboard_clinic(text, uuid, text, text);

create or replace function public.platform_onboard_clinic(
  p_clinic_name text,
  p_user_id uuid,
  p_user_name text,
  p_user_email text,
  p_plan_code text default 'essencial',
  p_status text default 'active',
  p_current_period_end date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_department_id uuid;
begin
  if coalesce(btrim(p_clinic_name), '') = '' then
    raise exception 'Informe o nome da empresa';
  end if;

  if not exists (select 1 from public.subscription_plans p where p.code = p_plan_code) then
    raise exception 'Plano inválido';
  end if;

  insert into public.clinics (name)
  values (btrim(p_clinic_name))
  returning id into v_clinic_id;

  -- Antes do departamento e do usuário: as travas já leem o plano certo
  insert into public.clinic_subscriptions (clinic_id, plan_code, status, current_period_end)
  values (v_clinic_id, p_plan_code, p_status, p_current_period_end);

  -- O webhook só aceita mensagens se houver um departamento padrão ATIVO
  insert into public.departments (clinic_id, name, slug, is_default, is_active)
  values (v_clinic_id, 'Recepção', 'recepcao', true, true)
  returning id into v_department_id;

  insert into public.clinic_users (
    clinic_id, user_id, role, name, department_id, email, invited_at
  )
  values (
    v_clinic_id,
    p_user_id,
    'admin',
    nullif(btrim(p_user_name), ''),
    v_department_id,
    lower(btrim(p_user_email)),
    now()
  );

  insert into public.department_members (department_id, clinic_user_id)
  values (v_department_id, p_user_id);

  return jsonb_build_object(
    'clinic_id', v_clinic_id,
    'department_id', v_department_id
  );
end;
$$;

revoke execute on function public.platform_onboard_clinic(text, uuid, text, text, text, text, date)
  from public, anon, authenticated;
grant execute on function public.platform_onboard_clinic(text, uuid, text, text, text, text, date)
  to service_role;

commit;
