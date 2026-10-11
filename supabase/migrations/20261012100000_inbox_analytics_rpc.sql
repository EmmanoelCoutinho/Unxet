-- =============================================================================
-- Painel (Análise & Atendimento): agregação no banco
--
-- Antes o navegador baixava conversas e mensagens e somava em JavaScript:
--  - a API devolve no máximo 1000 linhas por consulta, então mensagens
--    recebidas/enviadas, horário de pico e tempo de 1ª resposta saíam
--    truncados sem aviso;
--  - os ids das conversas iam na URL e, com algumas centenas de conversas no
--    período, a consulta falhava (414 Request-URI Too Large);
--  - o backlog pegava a última mensagem só entre as 1000 mais recentes, e as
--    conversas esperando há mais tempo sumiam da lista.
--
-- As duas funções respeitam a mesma regra de acesso da RLS
-- (can_access_conversation): admin vê a clínica toda; atendente, as próprias
-- conversas e a fila do(s) seu(s) setor(es).
--
-- Ordem de deploy: aplique ANTES de publicar o frontend desta entrega.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Indicadores do período
-- -----------------------------------------------------------------------------
create or replace function public.inbox_analytics(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_channels text[] default null,
  p_department_id uuid default null,
  p_assigned_user_id uuid default null,
  p_timezone text default 'America/Sao_Paulo'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_sla_sec integer;
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_clinic_member(p_clinic_id) then
    raise exception 'Não autorizado';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Período inválido';
  end if;

  -- Fuso do navegador; cai no padrão se vier algo desconhecido
  select tz.name into v_tz from pg_timezone_names tz where tz.name = p_timezone;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  -- Meta de 1ª resposta: a configurada pela clínica ou 2 minutos
  select s.sla_first_response_after_minutes * 60
    into v_sla_sec
  from public.conversation_automation_settings s
  where s.clinic_id = p_clinic_id
    and s.sla_first_response_enabled = true
    and s.sla_first_response_after_minutes is not null;
  v_sla_sec := coalesce(v_sla_sec, 120);

  with scope as materialized (
    select
      c.id,
      c.channel::text as channel,
      c.department_id,
      c.assigned_user_id,
      c.status::text as status,
      c.created_at
    from public.conversations c
    where c.clinic_id = p_clinic_id
      and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
      and (p_department_id is null or c.department_id = p_department_id)
      and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      and public.can_access_conversation(c.clinic_id, c.department_id, c.assigned_user_id)
  ),
  -- "Lead" = conversa criada no período
  leads as materialized (
    select * from scope s where s.created_at >= p_start and s.created_at < p_end
  ),
  -- Mensagens do período, mesmo em conversas iniciadas antes dele
  msgs as materialized (
    select m.direction::text as direction, m.created_at
    from public.messages m
    join scope s on s.id = m.conversation_id
    where m.created_at >= p_start
      and m.created_at < p_end
  ),
  -- 1ª resposta humana depois da 1ª mensagem do cliente (bot não conta)
  first_response as materialized (
    select
      l.channel,
      extract(epoch from (fo.at - fi.at))::numeric as seconds
    from leads l
    cross join lateral (
      select min(m.created_at) as at
      from public.messages m
      where m.conversation_id = l.id
        and m.direction = 'inbound'
    ) fi
    cross join lateral (
      select min(m.created_at) as at
      from public.messages m
      where m.conversation_id = l.id
        and m.direction = 'outbound'
        and m.is_automated = false
        and m.created_at >= fi.at
    ) fo
    where fi.at is not null
      and fo.at is not null
  ),
  hourly as (
    select
      extract(hour from (m.created_at at time zone v_tz))::int as hour,
      count(*)::int as messages
    from msgs m
    where m.direction = 'inbound'
    group by 1
  )
  select jsonb_build_object(
    'slaThresholdSec', v_sla_sec,
    'kpis', jsonb_build_object(
      'leads', (select count(*) from leads),
      'activeConversations', (select count(*) from scope s where s.status in ('open', 'pending')),
      'inboundMessages', (select count(*) from msgs m where m.direction = 'inbound'),
      'outboundMessages', (select count(*) from msgs m where m.direction = 'outbound'),
      'p50FirstResponseSec', (select percentile_cont(0.5) within group (order by fr.seconds) from first_response fr),
      'p90FirstResponseSec', (select percentile_cont(0.9) within group (order by fr.seconds) from first_response fr),
      'withinSlaPct', (
        select round(100.0 * count(*) filter (where fr.seconds <= v_sla_sec) / nullif(count(*), 0), 2)
        from first_response fr
      )
    ),
    'leadsByChannel', coalesce((
      select jsonb_agg(jsonb_build_object('channel', x.channel, 'leads', x.leads) order by x.leads desc, x.channel)
      from (select l.channel, count(*)::int as leads from leads l group by l.channel) x
    ), '[]'::jsonb),
    'leadsByDepartment', coalesce((
      select jsonb_agg(jsonb_build_object('department', x.department, 'leads', x.leads) order by x.leads desc, x.department)
      from (
        select coalesce(d.name, 'Sem departamento') as department, count(*)::int as leads
        from leads l
        left join public.departments d on d.id = l.department_id
        group by 1
      ) x
    ), '[]'::jsonb),
    'leadsByUserId', coalesce((
      select jsonb_agg(jsonb_build_object('userId', x.user_id, 'userName', x.user_name, 'leads', x.leads) order by x.leads desc, x.user_name)
      from (
        select
          l.assigned_user_id as user_id,
          coalesce(nullif(btrim(cu.name), ''), 'Atendente') as user_name,
          count(*)::int as leads
        from leads l
        left join public.clinic_users cu
          on cu.user_id = l.assigned_user_id
         and cu.clinic_id = p_clinic_id
        where l.assigned_user_id is not null
        group by 1, 2
        order by 3 desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'dailyLeads', coalesce((
      select jsonb_agg(jsonb_build_object('day', x.day, 'leads', x.leads) order by x.day)
      from (
        select to_char((l.created_at at time zone v_tz)::date, 'YYYY-MM-DD') as day, count(*)::int as leads
        from leads l
        group by 1
      ) x
    ), '[]'::jsonb),
    'slaByChannel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel', x.channel,
        'p50Sec', x.p50,
        'p90Sec', x.p90,
        'withinSlaPct', x.within_pct
      ) order by x.channel)
      from (
        select
          fr.channel,
          round(percentile_cont(0.5) within group (order by fr.seconds)::numeric, 2) as p50,
          round(percentile_cont(0.9) within group (order by fr.seconds)::numeric, 2) as p90,
          round(100.0 * count(*) filter (where fr.seconds <= v_sla_sec) / count(*), 2) as within_pct
        from first_response fr
        group by fr.channel
      ) x
    ), '[]'::jsonb),
    'inboundByHour', (
      select jsonb_agg(coalesce(h.messages, 0) order by g.hour)
      from generate_series(0, 23) as g(hour)
      left join hourly h on h.hour = g.hour
    )
  )
  into v_result;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Backlog: conversas ativas cuja última mensagem é do cliente
-- -----------------------------------------------------------------------------
create or replace function public.inbox_backlog(
  p_clinic_id uuid,
  p_channels text[] default null,
  p_department_id uuid default null,
  p_assigned_user_id uuid default null,
  p_limit integer default 500
)
returns table (
  conversation_id uuid,
  contact text,
  channel text,
  department text,
  assigned_to text,
  last_message_at timestamptz,
  last_message_text text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_clinic_member(p_clinic_id) then
    raise exception 'Não autorizado';
  end if;

  return query
  select
    c.id,
    coalesce(nullif(btrim(ct.name), ''), ct.phone, 'Contato sem nome'),
    c.channel::text,
    coalesce(d.name, 'Sem departamento'),
    coalesce(nullif(btrim(cu.name), ''), 'Não atribuído'),
    lm.created_at,
    case when lm.deleted_at is not null then null else lm.text end,
    count(*) over ()
  from public.conversations c
  cross join lateral (
    select m.direction, m.created_at, m.text, m.deleted_at
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm
  left join public.contacts ct on ct.id = c.contact_id
  left join public.departments d on d.id = c.department_id
  left join public.clinic_users cu
    on cu.user_id = c.assigned_user_id
   and cu.clinic_id = c.clinic_id
  where c.clinic_id = p_clinic_id
    and c.status in ('open', 'pending')
    and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
    and (p_department_id is null or c.department_id = p_department_id)
    and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
    and public.can_access_conversation(c.clinic_id, c.department_id, c.assigned_user_id)
    and lm.direction = 'inbound'
  -- quem espera há mais tempo primeiro
  order by lm.created_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
end;
$$;

revoke execute on function public.inbox_analytics(uuid, timestamptz, timestamptz, text[], uuid, uuid, text) from public, anon;
revoke execute on function public.inbox_backlog(uuid, text[], uuid, uuid, integer) from public, anon;
grant execute on function public.inbox_analytics(uuid, timestamptz, timestamptz, text[], uuid, uuid, text) to authenticated;
grant execute on function public.inbox_backlog(uuid, text[], uuid, uuid, integer) to authenticated;

commit;
