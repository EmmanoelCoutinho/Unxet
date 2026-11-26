-- =============================================================================
-- Painel administrativo: ligar/desligar a recuperação de mensagens por empresa
--
-- A marca clinics.whatsapp_recovery_disabled (20261206500000) passa a ser
-- mudada pelo painel, na janela da assinatura da empresa:
--   platform_subscriptions          traz whatsapp_recovery_disabled de cada
--                                   empresa e whatsapp_recovery_enabled da
--                                   plataforma (desligada no develop)
--   platform_set_whatsapp_recovery  liga/desliga para uma empresa; ao desligar,
--                                   encerra uma recuperação em andamento
--
-- Todas as empresas voltam a ter a recuperação ligada (inclusive Unxet DEMO e
-- Teste Cezar, travadas pela 20261206500000): quem desliga agora é o painel.
--
-- Ordem de deploy: antes do front (o painel lê os campos novos).
-- =============================================================================

begin;

update public.clinics
   set whatsapp_recovery_disabled = false
 where whatsapp_recovery_disabled;

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
    'whatsapp_recovery_enabled', coalesce((select ps.whatsapp_recovery_enabled from public.platform_settings ps limit 1), true),
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
          'last_message_at', lm.last_message_at,
          'whatsapp_recovery_disabled', c.whatsapp_recovery_disabled
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

create or replace function public.platform_set_whatsapp_recovery(
  p_clinic_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.platform_assert_admin();

  update public.clinics
     set whatsapp_recovery_disabled = not coalesce(p_enabled, true)
   where id = p_clinic_id;
  if not found then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;

  -- Desligou: o que estava sendo recuperado para por aqui
  if not coalesce(p_enabled, true) then
    update public.channel_connections
       set inbound_recovery_requested_at = null,
           inbound_recovery_from = null,
           inbound_recovery_total = null,
           inbound_recovery_done = 0
     where clinic_id = p_clinic_id
       and inbound_recovery_requested_at is not null;
  end if;
end;
$$;

revoke execute on function public.platform_set_whatsapp_recovery(uuid, boolean) from public, anon;
grant execute on function public.platform_set_whatsapp_recovery(uuid, boolean) to authenticated;

commit;
