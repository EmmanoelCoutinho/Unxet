-- =============================================================================
-- Painel da Unxet: atendentes extras e apagar empresa
--
-- 1. Atendentes extras (adicional por empresa)
--
--   clinic_subscriptions.extra_attendants
--     null  sem adicional: vale o limite do plano
--     N     N vagas a mais além do limite do plano (1 a 200)
--
--   Só faz diferença nos planos com limite (Essencial e Profissional); no
--   Empresarial, que é ilimitado, o painel grava null. O valor cobrado
--   continua no campo "valor" da assinatura.
--
--   clinic_max_attendants(clinic) = limite do plano + extras (null =
--   ilimitado) passa a ser usado por clinic_can_add_attendant (convites) e
--   pelo gatilho enforce_plan_attendants. Tirar o adicional não apaga
--   ninguém: a empresa só não consegue convidar mais.
--
-- 2. Apagar empresa (platform_delete_clinic)
--
--   Apaga a empresa e tudo o que é dela: conversas, mensagens, contatos,
--   funil, campanhas, bots, números, assinatura, pagamentos etc. Seis tabelas
--   apontam para clinics sem cascata (contacts, conversations, tags,
--   mass_campaigns, mass_messages_queue, conversation_automation_settings) e
--   algumas internas usam RESTRICT (conversas → departamentos, negócios →
--   funil); por isso a função apaga essas primeiro, na ordem certa, e o resto
--   sai pela cascata de clinics.
--
--   Quem chama é a edge function admin-delete-clinic (só service_role), que
--   antes remove as instâncias na Evolution e depois apaga os arquivos do
--   Storage e as contas que não pertencem a outra empresa. A função devolve
--   esses arquivos e contas, levantados antes de apagar.
--
--   legal_acceptances fica (clinic_id vira null): é o registro do aceite.
--
-- Ordem de deploy: aplique ANTES de publicar o frontend (painel e app) e a
-- function admin-delete-clinic. O painel antigo chamaria
-- platform_set_subscription sem os extras e os zeraria ao salvar.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Atendentes extras
-- -----------------------------------------------------------------------------
alter table public.clinic_subscriptions
  add column if not exists extra_attendants integer;

alter table public.clinic_subscriptions
  drop constraint if exists clinic_subscriptions_extra_attendants_check,
  add constraint clinic_subscriptions_extra_attendants_check
    check (extra_attendants is null or extra_attendants between 1 and 200);

-- A empresa lê os extras para mostrar o limite certo na tela de Atendentes
grant select (extra_attendants)
  on table public.clinic_subscriptions to authenticated;

-- Limite de atendentes da empresa: plano + extras (null = ilimitado)
create or replace function public.clinic_max_attendants(p_clinic_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.max_attendants is null then null
    else p.max_attendants + coalesce(
      (select s.extra_attendants from public.clinic_subscriptions s where s.clinic_id = p_clinic_id),
      0
    )
  end
  from public.clinic_plan(p_clinic_id) p;
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
  v_max integer := public.clinic_max_attendants(p_clinic_id);
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

revoke execute on function public.clinic_max_attendants(uuid) from public, anon, authenticated;
grant execute on function public.clinic_max_attendants(uuid) to service_role;

create or replace function public.enforce_plan_attendants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer := public.clinic_max_attendants(new.clinic_id);
begin
  -- Upsert de quem já é da empresa (reconvite): o gatilho roda antes do
  -- ON CONFLICT, mas não ocupa vaga nova
  if exists (
    select 1 from public.clinic_users cu
    where cu.user_id = new.user_id and cu.clinic_id = new.clinic_id
  ) then
    return new;
  end if;

  if v_max is not null
     and (select count(*) from public.clinic_users cu where cu.clinic_id = new.clinic_id)
         >= v_max then
    raise exception 'A empresa pode ter até % atendentes. Fale com a Unxet para liberar mais.', v_max
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Painel: editar assinatura com os extras
drop function if exists public.platform_set_subscription(uuid, text, text, date, text, text, numeric, integer, integer);

create or replace function public.platform_set_subscription(
  p_clinic_id uuid,
  p_plan_code text,
  p_status text,
  p_current_period_end date default null,
  p_notes text default null,
  p_billing_cycle text default 'monthly',
  p_price numeric default null,
  p_grace_days integer default 10,
  p_whatsapp_numbers_addon integer default null,
  p_extra_attendants integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_extra integer := p_extra_attendants;
begin
  perform public.platform_assert_admin();

  if not exists (select 1 from public.clinics c where c.id = p_clinic_id) then
    raise exception 'Empresa não encontrada';
  end if;

  -- Plano ilimitado não tem o que somar
  if (select p.max_attendants from public.subscription_plans p where p.code = p_plan_code) is null then
    v_extra := null;
  end if;

  insert into public.clinic_subscriptions (
    clinic_id, plan_code, status, current_period_end, notes,
    billing_cycle, price, grace_days, whatsapp_numbers_addon, extra_attendants,
    blocked_at, blocked_reason, updated_at, updated_by
  )
  values (
    p_clinic_id,
    p_plan_code,
    p_status,
    p_current_period_end,
    nullif(btrim(p_notes), ''),
    p_billing_cycle,
    p_price,
    coalesce(p_grace_days, 10),
    p_whatsapp_numbers_addon,
    v_extra,
    case when p_status = 'suspended' then now() end,
    -- Suspender pelo painel é manual: a rotina não reativa sozinha
    case when p_status = 'suspended' then 'manual' end,
    now(),
    auth.uid()
  )
  on conflict (clinic_id) do update set
    plan_code = excluded.plan_code,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    notes = excluded.notes,
    billing_cycle = excluded.billing_cycle,
    price = excluded.price,
    grace_days = excluded.grace_days,
    whatsapp_numbers_addon = excluded.whatsapp_numbers_addon,
    extra_attendants = excluded.extra_attendants,
    blocked_at = case
      when excluded.status <> 'suspended' then null
      when clinic_subscriptions.status = 'suspended' then clinic_subscriptions.blocked_at
      else excluded.blocked_at
    end,
    blocked_reason = case
      when excluded.status <> 'suspended' then null
      when clinic_subscriptions.status = 'suspended' then clinic_subscriptions.blocked_reason
      else excluded.blocked_reason
    end,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  -- A situação já sai certa para o novo vencimento, sem esperar a rotina
  perform public.subscription_refresh_status(p_clinic_id);
end;
$$;

revoke execute on function public.platform_set_subscription(uuid, text, text, date, text, text, numeric, integer, integer, integer) from public, anon;
grant execute on function public.platform_set_subscription(uuid, text, text, date, text, text, numeric, integer, integer, integer) to authenticated;

-- Lista do painel: mesma de 20261023200000, com os atendentes extras
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
  perform public.platform_assert_admin();

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
  qr as (
    select cc.clinic_id, count(*) as numbers
    from public.channel_connections cc
    where cc.provider = 'evolution'
      and cc.channel = 'whatsapp'
      and cc.archived_at is null
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
  ),
  last_payment as (
    select distinct on (p.clinic_id)
      p.clinic_id, p.paid_at, p.amount, p.method
    from public.subscription_payments p
    order by p.clinic_id, p.paid_at desc, p.created_at desc
  )
  select jsonb_build_object(
    'generated_at', now(),
    'today', public.subscription_today(),
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
          'billing_cycle', coalesce(s.billing_cycle, 'monthly'),
          'price', s.price,
          'grace_days', coalesce(s.grace_days, 10),
          'whatsapp_numbers_addon', s.whatsapp_numbers_addon,
          'extra_attendants', s.extra_attendants,
          'blocked_at', s.blocked_at,
          'blocked_reason', s.blocked_reason,
          'notes', s.notes,
          'updated_at', s.updated_at,
          'last_payment_at', lp.paid_at,
          'last_payment_amount', lp.amount,
          'last_payment_method', lp.method,
          'attendants', coalesce(pe.attendants, 0),
          'pending_invites', coalesce(pe.pending_invites, 0),
          'whatsapp', coalesce(ch.whatsapp, 0),
          'qr_numbers', coalesce(qr.numbers, 0),
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
      left join qr on qr.clinic_id = c.id
      left join bot bo on bo.clinic_id = c.id
      left join dept de on de.clinic_id = c.id
      left join scheduled sc on sc.clinic_id = c.id
      left join last_msg lm on lm.clinic_id = c.id
      left join last_payment lp on lp.clinic_id = c.id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.platform_subscriptions() from public, anon;
grant execute on function public.platform_subscriptions() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Apagar empresa
-- -----------------------------------------------------------------------------
create or replace function public.platform_delete_clinic(p_clinic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_users uuid[];
  v_files text[];
begin
  select c.name into v_name
  from public.clinics c
  where c.id = p_clinic_id
  for update;

  if not found then
    raise exception 'Empresa não encontrada';
  end if;

  -- Contas que ficam sem empresa (e não são da equipe da Unxet): a edge
  -- function apaga do Auth depois
  select coalesce(array_agg(cu.user_id), '{}') into v_users
  from public.clinic_users cu
  where cu.clinic_id = p_clinic_id
    and not exists (
      select 1 from public.clinic_users other
      where other.user_id = cu.user_id and other.clinic_id <> p_clinic_id
    )
    and not exists (
      select 1 from public.platform_admins pa where pa.user_id = cu.user_id
    );

  -- Arquivos da empresa no Storage (tudo fica na pasta com o id dela). O
  -- Storage não deixa apagar pela tabela; a edge function apaga pela API.
  select coalesce(array_agg(o.name), '{}') into v_files
  from storage.objects o
  where o.bucket_id = 'whatsapp-media'
    and o.name like p_clinic_id::text || '/%';

  -- Primeiro o que não sai pela cascata de clinics ou trava por RESTRICT
  delete from public.deals where clinic_id = p_clinic_id;
  delete from public.mass_messages_queue where clinic_id = p_clinic_id;
  delete from public.mass_campaigns where clinic_id = p_clinic_id;
  delete from public.conversations where clinic_id = p_clinic_id;
  delete from public.contacts where clinic_id = p_clinic_id;
  delete from public.tags where clinic_id = p_clinic_id;
  delete from public.conversation_automation_settings where clinic_id = p_clinic_id;

  -- O resto vai junto pela cascata
  delete from public.clinics where id = p_clinic_id;

  return jsonb_build_object(
    'name', v_name,
    'user_ids', to_jsonb(v_users),
    'files', to_jsonb(v_files)
  );
end;
$$;

revoke execute on function public.platform_delete_clinic(uuid) from public, anon, authenticated;
grant execute on function public.platform_delete_clinic(uuid) to service_role;

commit;
