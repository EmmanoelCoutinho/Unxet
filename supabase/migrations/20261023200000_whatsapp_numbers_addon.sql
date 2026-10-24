-- =============================================================================
-- Adicional "Vários números de WhatsApp" (QR Code), ativado por empresa
--
-- Ter mais de um número por QR Code não faz parte de nenhum plano: é um
-- adicional que a Unxet liga pelo painel ("Assinantes" e "Nova empresa"),
-- definindo quantos números a empresa pode ter.
--
--   clinic_subscriptions.whatsapp_numbers_addon
--     null  adicional desligado: um número por QR Code, como sempre foi
--     N     adicional ligado: até N números de WhatsApp (2 a 50)
--
-- O valor cobrado continua no campo "valor" da assinatura.
--
-- Travas:
--   - clinic_can_add_qr_number: um número QR Code novo só entra se a empresa
--     ainda não tem nenhum, ou se o adicional está ligado e há vaga
--     (números removidos não contam). Usada pela edge function
--     create-evolution-connection e pelo gatilho enforce_whatsapp_numbers_addon.
--   - clinic_can_use_whatsapp_number (limite de números conectados) passa a
--     usar a quantidade do adicional quando ele está ligado, e é conferida
--     de novo quando o QR Code é escaneado (seção 5).
--   Desligar o adicional não apaga nada: os números que já existem ficam,
--   só não dá para adicionar outro.
--
-- Ordem de deploy: aplique depois da 20261023100000 e ANTES de publicar
-- admin-onboard-clinic, create-evolution-connection e o frontend (painel e
-- app). O painel antigo chamaria platform_set_subscription sem o adicional e
-- o desligaria ao salvar.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Coluna do adicional
-- -----------------------------------------------------------------------------
alter table public.clinic_subscriptions
  add column if not exists whatsapp_numbers_addon integer;

alter table public.clinic_subscriptions
  drop constraint if exists clinic_subscriptions_whatsapp_numbers_addon_check,
  add constraint clinic_subscriptions_whatsapp_numbers_addon_check
    check (whatsapp_numbers_addon is null or whatsapp_numbers_addon between 2 and 50);

-- A empresa lê o adicional para saber se mostra a tela de vários números
grant select (whatsapp_numbers_addon)
  on table public.clinic_subscriptions to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Travas
-- -----------------------------------------------------------------------------
create or replace function public.clinic_whatsapp_numbers_addon(p_clinic_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select s.whatsapp_numbers_addon
  from public.clinic_subscriptions s
  where s.clinic_id = p_clinic_id;
$$;

-- Vaga para mais um número conectado (sem contar a própria conexão). Com o
-- adicional ligado, o limite é a quantidade do adicional.
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
  v_max integer := coalesce(
    public.clinic_whatsapp_numbers_addon(p_clinic_id),
    (public.clinic_plan(p_clinic_id)).max_whatsapp_numbers
  );
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

-- Vaga para cadastrar mais um número QR Code
create or replace function public.clinic_can_add_qr_number(p_clinic_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_addon integer := public.clinic_whatsapp_numbers_addon(p_clinic_id);
  v_count integer;
begin
  select count(*) into v_count
  from public.channel_connections cc
  where cc.clinic_id = p_clinic_id
    and cc.provider = 'evolution'
    and cc.channel = 'whatsapp'
    and cc.archived_at is null;

  if v_count = 0 then
    return true;
  end if;

  return v_addon is not null and v_count < v_addon;
end;
$$;

revoke execute on function public.clinic_whatsapp_numbers_addon(uuid) from public, anon, authenticated;
revoke execute on function public.clinic_can_use_whatsapp_number(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.clinic_can_add_qr_number(uuid) from public, anon, authenticated;
grant execute on function public.clinic_whatsapp_numbers_addon(uuid) to service_role;
grant execute on function public.clinic_can_use_whatsapp_number(uuid, uuid) to service_role;
grant execute on function public.clinic_can_add_qr_number(uuid) to service_role;

create or replace function public.enforce_whatsapp_numbers_addon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.provider = 'evolution'
     and new.channel = 'whatsapp'
     and new.archived_at is null then
    -- Dois cadastros simultâneos: o segundo espera o primeiro gravar e já o
    -- enxerga na contagem (sem o lock, os dois viam zero e entravam)
    perform pg_advisory_xact_lock(hashtextextended('whatsapp_limit:' || new.clinic_id::text, 0));

    if not public.clinic_can_add_qr_number(new.clinic_id) then
      raise exception 'A empresa atingiu o limite de números de WhatsApp. Fale com a Unxet para ativar mais números.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_whatsapp_numbers_addon on public.channel_connections;
create trigger enforce_whatsapp_numbers_addon
  before insert on public.channel_connections
  for each row execute function public.enforce_whatsapp_numbers_addon();

-- -----------------------------------------------------------------------------
-- 3. Painel: editar assinatura com o adicional
-- -----------------------------------------------------------------------------
drop function if exists public.platform_set_subscription(uuid, text, text, date, text, text, numeric, integer);

create or replace function public.platform_set_subscription(
  p_clinic_id uuid,
  p_plan_code text,
  p_status text,
  p_current_period_end date default null,
  p_notes text default null,
  p_billing_cycle text default 'monthly',
  p_price numeric default null,
  p_grace_days integer default 10,
  p_whatsapp_numbers_addon integer default null
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
    billing_cycle, price, grace_days, whatsapp_numbers_addon,
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

revoke execute on function public.platform_set_subscription(uuid, text, text, date, text, text, numeric, integer, integer) from public, anon;
grant execute on function public.platform_set_subscription(uuid, text, text, date, text, text, numeric, integer, integer) to authenticated;

-- Lista do painel: mesma de 20261022100000, com o adicional e os números
-- QR Code cadastrados
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
-- 4. Onboarding: a nova empresa já pode nascer com o adicional
-- -----------------------------------------------------------------------------
drop function if exists public.platform_onboard_clinic(text, uuid, text, text, text, text, date, text, numeric);

create or replace function public.platform_onboard_clinic(
  p_clinic_name text,
  p_user_id uuid,
  p_user_name text,
  p_user_email text,
  p_plan_code text default 'essencial',
  p_status text default 'active',
  p_current_period_end date default null,
  p_billing_cycle text default 'monthly',
  p_price numeric default null,
  p_whatsapp_numbers_addon integer default null
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
    clinic_id, plan_code, status, current_period_end, billing_cycle, price,
    whatsapp_numbers_addon
  )
  values (
    v_clinic_id, p_plan_code, p_status, p_current_period_end, p_billing_cycle, p_price,
    p_whatsapp_numbers_addon
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

revoke execute on function public.platform_onboard_clinic(text, uuid, text, text, text, text, date, text, numeric, integer)
  from public, anon, authenticated;
grant execute on function public.platform_onboard_clinic(text, uuid, text, text, text, text, date, text, numeric, integer)
  to service_role;

-- -----------------------------------------------------------------------------
-- 5. Limite conferido quando o QR Code é escaneado
--
-- O limite de números conectados era conferido só ao GERAR o QR Code. Como
-- "conectando" não ocupa vaga, dava para gerar QR Codes (ou ligar o WhatsApp
-- oficial) e escanear depois, passando do limite. Agora a passagem para
-- "connected" de um número QR Code que está sendo pareado (estava
-- "connecting", ou nunca tinha conectado) confere a vaga de novo.
--
-- Reconexão de um número que já estava em uso (queda rápida da Evolution:
-- "disconnected" → "connected") não é barrada: empresa que ficou acima do
-- plano depois de rebaixar não perde o número que já usava.
--
-- O lock por empresa serializa dois pareamentos simultâneos: o segundo espera
-- o primeiro gravar e já o enxerga na contagem.
--
-- O mesmo pareamento também recusa um celular que já está conectado em outra
-- conexão QR Code ativa (hint 'whatsapp_number_duplicate').
--
-- Barrado: o gatilho recusa a gravação; as edge functions deslogam a
-- instância e marcam a conexão como desconectada com disconnect_reason
-- 'plan_limit' ou 'duplicate_number', que a tela de Integrações explica.
-- -----------------------------------------------------------------------------
alter table public.channel_connections
  add column if not exists disconnect_reason text;

alter table public.channel_connections
  drop constraint if exists channel_connections_disconnect_reason_check,
  add constraint channel_connections_disconnect_reason_check
    check (disconnect_reason is null or disconnect_reason in ('plan_limit', 'duplicate_number'));

grant select (disconnect_reason) on public.channel_connections to authenticated;

create or replace function public.enforce_whatsapp_connected_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.provider = 'evolution'
     and new.channel = 'whatsapp'
     and new.status = 'connected'
     and old.status is distinct from 'connected'
     and (old.status = 'connecting' or old.last_connection_at is null) then
    perform pg_advisory_xact_lock(hashtextextended('whatsapp_limit:' || new.clinic_id::text, 0));

    if not public.clinic_can_use_whatsapp_number(new.clinic_id, new.id) then
      raise exception 'A empresa atingiu o limite de números de WhatsApp conectados.'
        using errcode = 'P0001', hint = 'whatsapp_number_limit';
    end if;

    -- O mesmo celular em duas instâncias recebe cada mensagem duas vezes; o id
    -- da mensagem é único no sistema, então só a primeira entrega fica e a
    -- conversa cairia ora num número, ora no outro (ou em outra empresa)
    if new.connected_phone is not null and exists (
      select 1
      from public.channel_connections other
      where other.id <> new.id
        and other.provider = 'evolution'
        and other.channel = 'whatsapp'
        and other.status = 'connected'
        and other.archived_at is null
        and split_part(other.connected_phone, '@', 1) = split_part(new.connected_phone, '@', 1)
    ) then
      raise exception 'Este WhatsApp já está conectado em outro número do sistema.'
        using errcode = 'P0001', hint = 'whatsapp_number_duplicate';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_whatsapp_connected_limit on public.channel_connections;
create trigger enforce_whatsapp_connected_limit
  before update of status on public.channel_connections
  for each row execute function public.enforce_whatsapp_connected_limit();

commit;
