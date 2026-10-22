-- =============================================================================
-- Cobrança das assinaturas: ciclo, pagamentos, inadimplência e suspensão
--
-- 1. clinic_subscriptions ganha:
--      - billing_cycle: mensal ou anual;
--      - price: valor de cada mensalidade/anuidade (sugestão ao registrar pagamento);
--      - grace_days: dias de carência depois do vencimento (padrão 10);
--      - blocked_at / blocked_reason: quando e por que foi suspensa
--        ('overdue' = rotina de inadimplência, 'manual' = painel).
--    Nova situação 'suspended': o app da empresa fica travado, mas as
--    mensagens recebidas continuam chegando e sendo gravadas.
--    A empresa só lê plano, situação, vencimento, ciclo e carência: preço,
--    observações e bloqueio ficam só para o painel.
--
-- 2. subscription_payments: histórico de pagamentos (data, valor, forma,
--    período coberto, observação). Registrar um pagamento empurra o vencimento
--    um mês (ou um ano) por período pago; ninguém precisa trocar a data à mão.
--    Excluir o último pagamento devolve o vencimento ao que era.
--
-- 3. subscription_refresh_status: aplica a régua de cobrança
--      - em dia (vencimento >= hoje): inadimplente/suspensa volta a ativa;
--      - vencida dentro da carência: inadimplente (teste continua em teste);
--      - vencida além da carência: suspensa (motivo 'overdue').
--    Cancelada e suspensão manual não são tocadas. "Hoje" é o dia em
--    America/Sao_Paulo. Roda de hora em hora (pg_cron) e logo depois de cada
--    pagamento registrado ou excluído.
--
-- 4. clinic_is_suspended: usada pelas edge functions de envio para recusar
--    mensagens de empresa suspensa.
--
-- Ordem de deploy: aplique ANTES de publicar as edge functions
-- (admin-onboard-clinic, send-*, scheduled-messages-dispatch) e o frontend.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Assinatura: ciclo, valor, carência e suspensão
-- -----------------------------------------------------------------------------
alter table public.clinic_subscriptions
  add column if not exists billing_cycle text not null default 'monthly',
  add column if not exists price numeric(10, 2),
  add column if not exists grace_days integer not null default 10,
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_reason text;

alter table public.clinic_subscriptions
  drop constraint if exists clinic_subscriptions_billing_cycle_check,
  add constraint clinic_subscriptions_billing_cycle_check
    check (billing_cycle in ('monthly', 'annual')),
  drop constraint if exists clinic_subscriptions_price_check,
  add constraint clinic_subscriptions_price_check
    check (price is null or price >= 0),
  drop constraint if exists clinic_subscriptions_grace_days_check,
  add constraint clinic_subscriptions_grace_days_check
    check (grace_days between 0 and 90),
  drop constraint if exists clinic_subscriptions_blocked_reason_check,
  add constraint clinic_subscriptions_blocked_reason_check
    check (blocked_reason is null or blocked_reason in ('overdue', 'manual')),
  drop constraint if exists clinic_subscriptions_status_check,
  add constraint clinic_subscriptions_status_check
    check (status in ('trial', 'active', 'past_due', 'suspended', 'canceled'));

-- A empresa não enxerga preço, observações nem o motivo do bloqueio
revoke select on table public.clinic_subscriptions from authenticated;
grant select (clinic_id, plan_code, status, current_period_end, billing_cycle, grace_days)
  on table public.clinic_subscriptions to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Histórico de pagamentos (só o painel, pelas funções abaixo)
-- -----------------------------------------------------------------------------
create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  paid_at date not null,
  amount numeric(10, 2) not null check (amount >= 0),
  method text not null check (
    method in ('pix', 'boleto', 'credit_card', 'debit_card', 'bank_transfer', 'cash', 'other')
  ),
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  periods integer not null default 1 check (periods between 1 and 36),
  -- Período que o pagamento cobre: o vencimento passou de period_start para period_end
  period_start date not null,
  period_end date not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create index if not exists subscription_payments_clinic_paid_idx
  on public.subscription_payments (clinic_id, paid_at desc);

alter table public.subscription_payments enable row level security;
revoke all on table public.subscription_payments from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Régua de cobrança
-- -----------------------------------------------------------------------------
create or replace function public.subscription_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- p_clinic_id null = todas as empresas. Devolve quantas mudaram de situação.
create or replace function public.subscription_refresh_status(p_clinic_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.subscription_today();
  v_changed integer;
begin
  with target as (
    select
      s.clinic_id,
      case
        when s.current_period_end >= v_today then
          case when s.status in ('past_due', 'suspended') then 'active' else s.status end
        when v_today > s.current_period_end + s.grace_days then 'suspended'
        -- Teste vencido continua "em teste" na carência: não houve pagamento atrasado
        when s.status = 'trial' then 'trial'
        else 'past_due'
      end as next_status
    from public.clinic_subscriptions s
    where (p_clinic_id is null or s.clinic_id = p_clinic_id)
      and s.current_period_end is not null
      and s.status <> 'canceled'
      and not (s.status = 'suspended' and s.blocked_reason = 'manual')
  ),
  changed as (
    update public.clinic_subscriptions s
    set
      status = t.next_status,
      blocked_at = case when t.next_status = 'suspended' then coalesce(s.blocked_at, now()) end,
      blocked_reason = case when t.next_status = 'suspended' then 'overdue' end,
      updated_at = now()
    from target t
    where s.clinic_id = t.clinic_id
      and s.status is distinct from t.next_status
    returning 1
  )
  select count(*) into v_changed from changed;

  return v_changed;
end;
$$;

create or replace function public.clinic_is_suspended(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clinic_subscriptions s
    where s.clinic_id = p_clinic_id and s.status = 'suspended'
  );
$$;

revoke execute on function public.subscription_refresh_status(uuid) from public, anon, authenticated;
revoke execute on function public.clinic_is_suspended(uuid) from public, anon, authenticated;
grant execute on function public.subscription_refresh_status(uuid) to service_role;
grant execute on function public.clinic_is_suspended(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Painel: assinatura, pagamentos e lista de assinantes
-- -----------------------------------------------------------------------------
create or replace function public.platform_assert_admin()
returns void
language plpgsql
stable
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
end;
$$;

revoke execute on function public.platform_assert_admin() from public, anon;
grant execute on function public.platform_assert_admin() to authenticated;

drop function if exists public.platform_set_subscription(uuid, text, text, date, text);

create or replace function public.platform_set_subscription(
  p_clinic_id uuid,
  p_plan_code text,
  p_status text,
  p_current_period_end date default null,
  p_notes text default null,
  p_billing_cycle text default 'monthly',
  p_price numeric default null,
  p_grace_days integer default 10
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.platform_assert_admin();

  if not exists (select 1 from public.clinics c where c.id = p_clinic_id) then
    raise exception 'Empresa não encontrada';
  end if;

  insert into public.clinic_subscriptions (
    clinic_id, plan_code, status, current_period_end, notes,
    billing_cycle, price, grace_days, blocked_at, blocked_reason,
    updated_at, updated_by
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

create or replace function public.platform_register_payment(
  p_clinic_id uuid,
  p_paid_at date,
  p_amount numeric,
  p_method text,
  p_periods integer default 1,
  p_notes text default null,
  -- Início do período pago; padrão: o vencimento atual (ou a data do pagamento)
  p_period_start date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.clinic_subscriptions;
  v_start date;
  v_end date;
  v_payment_id uuid;
begin
  perform public.platform_assert_admin();

  if p_paid_at is null then
    raise exception 'Informe a data do pagamento';
  end if;

  if p_paid_at > public.subscription_today() then
    raise exception 'A data do pagamento não pode ser no futuro';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Informe o valor pago';
  end if;

  select * into v_sub
  from public.clinic_subscriptions s
  where s.clinic_id = p_clinic_id
  for update;

  if not found then
    raise exception 'Empresa sem assinatura';
  end if;

  v_start := coalesce(p_period_start, v_sub.current_period_end, p_paid_at);
  v_end := (
    v_start
    + case when v_sub.billing_cycle = 'annual' then interval '1 year' else interval '1 month' end
      * coalesce(p_periods, 1)
  )::date;

  insert into public.subscription_payments (
    clinic_id, paid_at, amount, method, billing_cycle, periods,
    period_start, period_end, notes, created_by
  )
  values (
    p_clinic_id, p_paid_at, p_amount, p_method, v_sub.billing_cycle,
    coalesce(p_periods, 1), v_start, v_end, nullif(btrim(p_notes), ''), auth.uid()
  )
  returning id into v_payment_id;

  update public.clinic_subscriptions
  set
    current_period_end = v_end,
    -- Pagou: teste vira assinatura
    status = case when status = 'trial' then 'active' else status end,
    updated_at = now(),
    updated_by = auth.uid()
  where clinic_id = p_clinic_id;

  perform public.subscription_refresh_status(p_clinic_id);

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'period_start', v_start,
    'period_end', v_end
  );
end;
$$;

create or replace function public.platform_delete_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.subscription_payments;
begin
  perform public.platform_assert_admin();

  select * into v_payment
  from public.subscription_payments p
  where p.id = p_payment_id;

  if not found then
    raise exception 'Pagamento não encontrado';
  end if;

  -- Desfaz o avanço do vencimento quando é o pagamento mais recente
  update public.clinic_subscriptions
  set
    current_period_end = v_payment.period_start,
    updated_at = now(),
    updated_by = auth.uid()
  where clinic_id = v_payment.clinic_id
    and current_period_end = v_payment.period_end;

  delete from public.subscription_payments where id = p_payment_id;

  perform public.subscription_refresh_status(v_payment.clinic_id);
end;
$$;

create or replace function public.platform_subscription_payments(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.platform_assert_admin();

  return coalesce((
    select jsonb_agg(to_jsonb(p) order by p.paid_at desc, p.created_at desc)
    from public.subscription_payments p
    where p.clinic_id = p_clinic_id
  ), '[]'::jsonb);
end;
$$;

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
      left join last_payment lp on lp.clinic_id = c.id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.platform_set_subscription(uuid, text, text, date, text, text, numeric, integer) from public, anon;
revoke execute on function public.platform_register_payment(uuid, date, numeric, text, integer, text, date) from public, anon;
revoke execute on function public.platform_delete_payment(uuid) from public, anon;
revoke execute on function public.platform_subscription_payments(uuid) from public, anon;
revoke execute on function public.platform_subscriptions() from public, anon;
grant execute on function public.platform_set_subscription(uuid, text, text, date, text, text, numeric, integer) to authenticated;
grant execute on function public.platform_register_payment(uuid, date, numeric, text, integer, text, date) to authenticated;
grant execute on function public.platform_delete_payment(uuid) to authenticated;
grant execute on function public.platform_subscription_payments(uuid) to authenticated;
grant execute on function public.platform_subscriptions() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Onboarding: ciclo e valor da nova empresa
-- -----------------------------------------------------------------------------
drop function if exists public.platform_onboard_clinic(text, uuid, text, text, text, text, date);

create or replace function public.platform_onboard_clinic(
  p_clinic_name text,
  p_user_id uuid,
  p_user_name text,
  p_user_email text,
  p_plan_code text default 'essencial',
  p_status text default 'active',
  p_current_period_end date default null,
  p_billing_cycle text default 'monthly',
  p_price numeric default null
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
  insert into public.clinic_subscriptions (
    clinic_id, plan_code, status, current_period_end, billing_cycle, price
  )
  values (
    v_clinic_id, p_plan_code, p_status, p_current_period_end, p_billing_cycle, p_price
  );

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

revoke execute on function public.platform_onboard_clinic(text, uuid, text, text, text, text, date, text, numeric)
  from public, anon, authenticated;
grant execute on function public.platform_onboard_clinic(text, uuid, text, text, text, text, date, text, numeric)
  to service_role;

commit;

-- -----------------------------------------------------------------------------
-- 6. Rotina: de hora em hora (reagendar com o mesmo nome substitui o job)
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule(
  'subscription-refresh-status',
  '5 * * * *',
  $$select public.subscription_refresh_status();$$
);
