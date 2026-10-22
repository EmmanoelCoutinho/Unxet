-- =============================================================================
-- Relatórios operacionais (tela Relatórios, só admin da empresa)
--
-- 1. operational_report: todos os números dos relatórios de um período, numa
--    chamada só (resumo executivo com comparação ao período anterior,
--    desempenho da equipe, atendimento e SLA, satisfação).
--
-- 2. report_exports: cada PDF/CSV exportado ganha um código (UNX-XXXX-XXXX)
--    impresso no rodapé, junto com quem gerou, quando, filtros e o hash dos
--    números. Pelo código o admin confere depois se um arquivo saiu mesmo da
--    Unxet e se os números batem.
--
-- 3. operational_now: o Painel (tempo real). Situação neste momento (fila,
--    SLA estourado, equipe online) e os números de hoje, calculados pela
--    mesma report_period_kpis dos relatórios, para os dois nunca divergirem.
--
-- 4. Inclui o recurso "analytics" em todos os planos (subscription_plans).
--    operational_report, operational_now e register_report_export exigem o
--    recurso; o histórico e a verificação de código não.
--
-- Só administradores da empresa chamam as funções; o atendente recebe
-- "Não autorizado" mesmo chamando a API direto.
--
-- Observação: a mensagem enviada não guarda quem a escreveu, então os números
-- por atendente consideram o responsável atual da conversa.
--
-- Ordem de deploy: aplique ANTES de publicar o frontend desta entrega.
-- =============================================================================

begin;

create or replace function public.is_clinic_admin_of(p_clinic_id uuid)
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
      and cu.role = 'admin'
  );
$$;

revoke execute on function public.is_clinic_admin_of(uuid) from public, anon;
grant execute on function public.is_clinic_admin_of(uuid) to authenticated;

-- Painel e Relatórios (recurso "analytics") fazem parte de todos os planos.
-- As telas e as funções abaixo continuam conferindo o recurso: para restringir
-- de novo um plano, basta tirar "analytics" da lista dele.
update public.subscription_plans
   set features = array_append(features, 'analytics')
 where not ('analytics' = any (features));

-- -----------------------------------------------------------------------------
-- Indicadores de um período (usado para o período escolhido e o anterior)
-- Interno: só operational_report chama.
-- -----------------------------------------------------------------------------
create or replace function public.report_period_kpis(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_channels text[],
  p_department_id uuid,
  p_assigned_user_id uuid,
  p_sla_sec integer
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scope as materialized (
    select c.id, c.contact_id, c.created_at, c.closed_at, c.auto_closed_at
    from public.conversations c
    where c.clinic_id = p_clinic_id
      and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
      and (p_department_id is null or c.department_id = p_department_id)
      and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
  ),
  leads as materialized (
    select * from scope s where s.created_at >= p_start and s.created_at < p_end
  ),
  msgs as materialized (
    select m.conversation_id, m.direction::text as direction, m.is_automated
    from public.messages m
    join scope s on s.id = m.conversation_id
    where m.created_at >= p_start and m.created_at < p_end
  ),
  first_response as materialized (
    select extract(epoch from (fo.at - fi.at))::numeric as seconds
    from leads l
    cross join lateral (
      select min(m.created_at) as at
      from public.messages m
      where m.conversation_id = l.id and m.direction = 'inbound'
    ) fi
    cross join lateral (
      select min(m.created_at) as at
      from public.messages m
      where m.conversation_id = l.id
        and m.direction = 'outbound'
        and m.is_automated = false
        and m.created_at >= fi.at
    ) fo
    where fi.at is not null and fo.at is not null
  ),
  resolution as (
    select extract(epoch from (s.closed_at - s.created_at))::numeric as seconds
    from scope s
    where s.closed_at >= p_start and s.closed_at < p_end and s.created_at is not null
  ),
  surveys as (
    select ss.status, ss.score
    from public.satisfaction_surveys ss
    where ss.clinic_id = p_clinic_id
      and ss.sent_at >= p_start and ss.sent_at < p_end
      and ss.status <> 'failed'
      and (coalesce(cardinality(p_channels), 0) = 0 or ss.channel = any (p_channels))
      and (p_department_id is null or ss.department_id = p_department_id)
      and (p_assigned_user_id is null or ss.agent_user_id = p_assigned_user_id)
  )
  select jsonb_build_object(
    'leads', (select count(*) from leads),
    'closed', (select count(*) from scope s where s.closed_at >= p_start and s.closed_at < p_end),
    'autoClosed', (select count(*) from scope s where s.auto_closed_at >= p_start and s.auto_closed_at < p_end),
    'contactsServed', (
      select count(distinct s.contact_id)
      from scope s
      where exists (select 1 from msgs m where m.conversation_id = s.id and m.direction = 'inbound')
    ),
    'newContacts', (
      select count(distinct l.contact_id)
      from leads l
      join public.contacts ct on ct.id = l.contact_id
      where ct.created_at >= p_start and ct.created_at < p_end
    ),
    'inboundMessages', (select count(*) from msgs where direction = 'inbound'),
    'outboundMessages', (select count(*) from msgs where direction = 'outbound' and not is_automated),
    'botMessages', (select count(*) from msgs where direction = 'outbound' and is_automated),
    'firstResponseCount', (select count(*) from first_response),
    'p50FirstResponseSec', (select round(percentile_cont(0.5) within group (order by seconds)::numeric, 1) from first_response),
    'p90FirstResponseSec', (select round(percentile_cont(0.9) within group (order by seconds)::numeric, 1) from first_response),
    'withinSlaPct', (
      select round(100.0 * count(*) filter (where seconds <= p_sla_sec) / nullif(count(*), 0), 1)
      from first_response
    ),
    'unansweredLeads', (
      select count(*)
      from leads l
      where exists (
          select 1 from public.messages m
          where m.conversation_id = l.id and m.direction = 'inbound'
        )
        and not exists (
          select 1 from public.messages m
          where m.conversation_id = l.id and m.direction = 'outbound' and m.is_automated = false
        )
    ),
    'p50ResolutionSec', (select round(percentile_cont(0.5) within group (order by seconds)::numeric, 1) from resolution),
    'surveysSent', (select count(*) from surveys),
    'surveysAnswered', (select count(*) from surveys where status = 'answered'),
    'averageScore', (select round(avg(score)::numeric, 2) from surveys where status = 'answered'),
    'csatPct', (
      select round(100.0 * count(*) filter (where score >= 4) / nullif(count(*), 0), 1)
      from surveys where status = 'answered'
    )
  );
$$;

revoke execute on function public.report_period_kpis(uuid, timestamptz, timestamptz, text[], uuid, uuid, integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Relatório completo do período
-- -----------------------------------------------------------------------------
create or replace function public.operational_report(
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
  v_prev_start timestamptz;
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_clinic_admin_of(p_clinic_id) then
    raise exception 'Não autorizado';
  end if;

  if not public.clinic_has_feature(p_clinic_id, 'analytics') then
    raise exception 'Recurso fora do plano';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Período inválido';
  end if;

  if p_end - p_start > interval '400 days' then
    raise exception 'Período máximo de 400 dias';
  end if;

  select tz.name into v_tz from pg_timezone_names tz where tz.name = p_timezone;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select s.sla_first_response_after_minutes * 60
    into v_sla_sec
  from public.conversation_automation_settings s
  where s.clinic_id = p_clinic_id
    and s.sla_first_response_enabled = true
    and s.sla_first_response_after_minutes is not null;
  v_sla_sec := coalesce(v_sla_sec, 120);

  -- Período anterior de mesmo tamanho, para a comparação do resumo
  v_prev_start := p_start - (p_end - p_start);

  with scope as materialized (
    select
      c.id,
      c.contact_id,
      c.channel::text as channel,
      c.department_id,
      c.assigned_user_id,
      c.created_at,
      c.closed_at
    from public.conversations c
    where c.clinic_id = p_clinic_id
      and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
      and (p_department_id is null or c.department_id = p_department_id)
      and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
  ),
  leads as materialized (
    select * from scope s where s.created_at >= p_start and s.created_at < p_end
  ),
  msgs as materialized (
    select m.conversation_id, m.direction::text as direction, m.is_automated, m.created_at
    from public.messages m
    join scope s on s.id = m.conversation_id
    where m.created_at >= p_start and m.created_at < p_end
  ),
  first_response as materialized (
    select
      l.id as conversation_id,
      l.channel,
      l.department_id,
      l.assigned_user_id,
      l.contact_id,
      fi.at as first_inbound_at,
      fo.at as first_outbound_at,
      case when fo.at is null then null
           else extract(epoch from (fo.at - fi.at))::numeric end as seconds
    from leads l
    cross join lateral (
      select min(m.created_at) as at
      from public.messages m
      where m.conversation_id = l.id and m.direction = 'inbound'
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
  ),
  answered as materialized (
    select * from first_response where seconds is not null
  ),
  resolution as materialized (
    select
      s.assigned_user_id,
      extract(epoch from (s.closed_at - s.created_at))::numeric as seconds
    from scope s
    where s.closed_at >= p_start and s.closed_at < p_end and s.created_at is not null
  ),
  surveys as materialized (
    select ss.*
    from public.satisfaction_surveys ss
    where ss.clinic_id = p_clinic_id
      and ss.sent_at >= p_start and ss.sent_at < p_end
      and ss.status <> 'failed'
      and (coalesce(cardinality(p_channels), 0) = 0 or ss.channel = any (p_channels))
      and (p_department_id is null or ss.department_id = p_department_id)
      and (p_assigned_user_id is null or ss.agent_user_id = p_assigned_user_id)
  ),
  team as (
    select cu.user_id, cu.name, cu.role, cu.email
    from public.clinic_users cu
    where cu.clinic_id = p_clinic_id
      and (p_assigned_user_id is null or cu.user_id = p_assigned_user_id)
  )
  select jsonb_build_object(
    'slaThresholdSec', v_sla_sec,
    'timezone', v_tz,
    'summary', jsonb_build_object(
      'current', public.report_period_kpis(p_clinic_id, p_start, p_end, p_channels, p_department_id, p_assigned_user_id, v_sla_sec),
      'previous', public.report_period_kpis(p_clinic_id, v_prev_start, p_start, p_channels, p_department_id, p_assigned_user_id, v_sla_sec),
      'previousStart', v_prev_start,
      'previousEnd', p_start,
      'activeNow', (
        select count(*) from public.conversations c
        where c.clinic_id = p_clinic_id
          and c.status in ('open', 'pending')
          and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
          and (p_department_id is null or c.department_id = p_department_id)
          and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      )
    ),
    'leadsByChannel', (
      select coalesce(jsonb_agg(jsonb_build_object('channel', x.channel, 'leads', x.n) order by x.n desc), '[]'::jsonb)
      from (select channel, count(*) as n from leads group by channel) x
    ),
    'leadsByDepartment', (
      select coalesce(jsonb_agg(jsonb_build_object('department', x.name, 'leads', x.n) order by x.n desc, x.name), '[]'::jsonb)
      from (
        select coalesce(d.name, 'Sem departamento') as name, count(*) as n
        from leads l left join public.departments d on d.id = l.department_id
        group by 1
      ) x
    ),
    'team', (
      select coalesce(jsonb_agg(row_data order by (row_data->>'conversations')::int desc, row_data->>'name'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'userId', t.user_id,
          'name', coalesce(nullif(btrim(t.name), ''), t.email, 'Sem nome'),
          'role', t.role,
          'lastSeenAt', (select up.last_seen_at from public.user_presence up where up.user_id = t.user_id),
          'conversations', (
            select count(*) from scope s
            where s.assigned_user_id = t.user_id
              and (
                (s.created_at >= p_start and s.created_at < p_end)
                or exists (select 1 from msgs m where m.conversation_id = s.id)
              )
          ),
          'closed', (select count(*) from resolution r where r.assigned_user_id = t.user_id),
          'outboundMessages', (
            select count(*) from msgs m
            join scope s on s.id = m.conversation_id
            where s.assigned_user_id = t.user_id
              and m.direction = 'outbound' and not m.is_automated
          ),
          'p50FirstResponseSec', (
            select round(percentile_cont(0.5) within group (order by a.seconds)::numeric, 1)
            from answered a where a.assigned_user_id = t.user_id
          ),
          'withinSlaPct', (
            select round(100.0 * count(*) filter (where a.seconds <= v_sla_sec) / nullif(count(*), 0), 1)
            from answered a where a.assigned_user_id = t.user_id
          ),
          'p50ResolutionSec', (
            select round(percentile_cont(0.5) within group (order by r.seconds)::numeric, 1)
            from resolution r where r.assigned_user_id = t.user_id
          ),
          'surveysAnswered', (
            select count(*) from surveys sv
            where sv.agent_user_id = t.user_id and sv.status = 'answered'
          ),
          'averageScore', (
            select round(avg(sv.score)::numeric, 2) from surveys sv
            where sv.agent_user_id = t.user_id and sv.status = 'answered'
          )
        ) as row_data
        from team t
      ) rows
    ),
    'sla', jsonb_build_object(
      'byChannel', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'label', x.channel, 'count', x.n, 'p50Sec', x.p50, 'p90Sec', x.p90, 'withinSlaPct', x.within
        ) order by x.n desc), '[]'::jsonb)
        from (
          select a.channel, count(*) as n,
            round(percentile_cont(0.5) within group (order by a.seconds)::numeric, 1) as p50,
            round(percentile_cont(0.9) within group (order by a.seconds)::numeric, 1) as p90,
            round(100.0 * count(*) filter (where a.seconds <= v_sla_sec) / nullif(count(*), 0), 1) as within
          from answered a group by a.channel
        ) x
      ),
      'byDepartment', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'label', x.name, 'count', x.n, 'p50Sec', x.p50, 'p90Sec', x.p90, 'withinSlaPct', x.within
        ) order by x.n desc), '[]'::jsonb)
        from (
          select coalesce(d.name, 'Sem departamento') as name, count(*) as n,
            round(percentile_cont(0.5) within group (order by a.seconds)::numeric, 1) as p50,
            round(percentile_cont(0.9) within group (order by a.seconds)::numeric, 1) as p90,
            round(100.0 * count(*) filter (where a.seconds <= v_sla_sec) / nullif(count(*), 0), 1) as within
          from answered a left join public.departments d on d.id = a.department_id
          group by 1
        ) x
      ),
      -- Quanto o cliente esperou pela 1ª resposta humana
      'buckets', (
        select jsonb_agg(jsonb_build_object('label', b.label, 'count', (
          select count(*) from answered a
          where a.seconds >= b.min_sec and (b.max_sec is null or a.seconds < b.max_sec)
        )) order by b.ord)
        from (values
          (1, 'Até 1 min', 0, 60),
          (2, '1 a 5 min', 60, 300),
          (3, '5 a 15 min', 300, 900),
          (4, '15 a 60 min', 900, 3600),
          (5, '1 a 4 h', 3600, 14400),
          (6, 'Mais de 4 h', 14400, null)
        ) as b(ord, label, min_sec, max_sec)
      ),
      -- Mensagens recebidas por dia da semana (1 = segunda) e hora
      'heatmap', (
        select coalesce(jsonb_agg(jsonb_build_object('weekday', h.wd, 'hour', h.hr, 'messages', h.n)), '[]'::jsonb)
        from (
          select
            extract(isodow from (m.created_at at time zone v_tz))::int as wd,
            extract(hour from (m.created_at at time zone v_tz))::int as hr,
            count(*)::int as n
          from msgs m
          where m.direction = 'inbound'
          group by 1, 2
        ) h
      ),
      -- Conversas que mais demoraram (ou ainda não tiveram) a 1ª resposta
      'slowest', (
        select coalesce(jsonb_agg(row_data order by ord), '[]'::jsonb)
        from (
          select
            row_number() over (order by fr.seconds desc nulls first, fr.first_inbound_at) as ord,
            jsonb_build_object(
              'conversationId', fr.conversation_id,
              'contact', coalesce(nullif(btrim(ct.name), ''), ct.phone, 'Contato sem nome'),
              'channel', fr.channel,
              'department', coalesce(d.name, 'Sem departamento'),
              'assignedTo', coalesce(nullif(btrim(cu.name), ''), 'Não atribuído'),
              'firstInboundAt', fr.first_inbound_at,
              'seconds', fr.seconds
            ) as row_data
          from first_response fr
          left join public.contacts ct on ct.id = fr.contact_id
          left join public.departments d on d.id = fr.department_id
          left join public.clinic_users cu
            on cu.user_id = fr.assigned_user_id and cu.clinic_id = p_clinic_id
          where fr.seconds is null or fr.seconds > v_sla_sec
          order by fr.seconds desc nulls first, fr.first_inbound_at
          limit 20
        ) x
      )
    ),
    'satisfaction', jsonb_build_object(
      'distribution', (
        select jsonb_agg(jsonb_build_object('score', g, 'count', (
          select count(*) from surveys sv where sv.status = 'answered' and sv.score = g
        )) order by g)
        from generate_series(1, 5) g
      ),
      'byStatus', (
        select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
        from (select status, count(*) as n from surveys group by status) x
      ),
      'byDepartment', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'label', x.name, 'answered', x.n, 'averageScore', x.avg_score
        ) order by x.avg_score desc nulls last, x.n desc), '[]'::jsonb)
        from (
          select coalesce(d.name, 'Sem departamento') as name, count(*) as n,
            round(avg(sv.score)::numeric, 2) as avg_score
          from surveys sv left join public.departments d on d.id = sv.department_id
          where sv.status = 'answered'
          group by 1
        ) x
      ),
      -- Notas 1 e 2, as mais recentes primeiro, para investigar
      'lowScores', (
        select coalesce(jsonb_agg(row_data order by at desc), '[]'::jsonb)
        from (
          select sv.answered_at as at, jsonb_build_object(
            'answeredAt', sv.answered_at,
            'score', sv.score,
            'comment', nullif(btrim(sv.raw_answer), ''),
            'contact', coalesce(nullif(btrim(ct.name), ''), ct.phone, 'Contato sem nome'),
            'agent', coalesce(nullif(btrim(cu.name), ''), 'Não atribuído'),
            'department', coalesce(d.name, 'Sem departamento')
          ) as row_data
          from surveys sv
          left join public.contacts ct on ct.id = sv.contact_id
          left join public.departments d on d.id = sv.department_id
          left join public.clinic_users cu
            on cu.user_id = sv.agent_user_id and cu.clinic_id = p_clinic_id
          where sv.status = 'answered' and sv.score <= 2
          order by sv.answered_at desc
          limit 30
        ) x
      )
    )
  )
  into v_result;

  -- Série diária: conversas novas e finalizadas por dia (no fuso de quem vê)
  v_result := v_result || jsonb_build_object('daily', (
    with days as (
      select g::date as day
      from generate_series(
        (p_start at time zone v_tz)::date,
        ((p_end - interval '1 second') at time zone v_tz)::date,
        interval '1 day'
      ) g
    ),
    created as (
      select (c.created_at at time zone v_tz)::date as day, count(*) as n
      from public.conversations c
      where c.clinic_id = p_clinic_id
        and c.created_at >= p_start and c.created_at < p_end
        and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
        and (p_department_id is null or c.department_id = p_department_id)
        and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      group by 1
    ),
    closed as (
      select (c.closed_at at time zone v_tz)::date as day, count(*) as n
      from public.conversations c
      where c.clinic_id = p_clinic_id
        and c.closed_at >= p_start and c.closed_at < p_end
        and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
        and (p_department_id is null or c.department_id = p_department_id)
        and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'day', d.day,
      'leads', coalesce(cr.n, 0),
      'closed', coalesce(cl.n, 0)
    ) order by d.day), '[]'::jsonb)
    from days d
    left join created cr on cr.day = d.day
    left join closed cl on cl.day = d.day
  ));

  return v_result;
end;
$$;

revoke execute on function public.operational_report(uuid, timestamptz, timestamptz, text[], uuid, uuid, text) from public, anon;
grant execute on function public.operational_report(uuid, timestamptz, timestamptz, text[], uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Histórico de exportações (código de verificação)
-- -----------------------------------------------------------------------------
create table if not exists public.report_exports (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  generated_by uuid references auth.users (id) on delete set null,
  generated_by_name text,
  report_type text not null
    check (report_type in ('full', 'summary', 'team', 'sla', 'satisfaction')),
  format text not null check (format in ('pdf', 'csv')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  filters jsonb not null default '{}'::jsonb,
  -- SHA-256 dos números do relatório no momento da exportação
  data_hash text not null check (data_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index if not exists report_exports_clinic_created_idx
  on public.report_exports (clinic_id, created_at desc);

alter table public.report_exports enable row level security;
revoke all on table public.report_exports from anon, authenticated;

create or replace function public.register_report_export(
  p_clinic_id uuid,
  p_report_type text,
  p_format text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_filters jsonb,
  p_data_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_code text;
  v_name text;
  v_row public.report_exports;
begin
  if auth.uid() is null or not public.is_clinic_admin_of(p_clinic_id) then
    raise exception 'Não autorizado';
  end if;

  if not public.clinic_has_feature(p_clinic_id, 'analytics') then
    raise exception 'Recurso fora do plano';
  end if;

  select coalesce(nullif(btrim(cu.name), ''), cu.email, 'Administrador')
    into v_name
  from public.clinic_users cu
  where cu.clinic_id = p_clinic_id and cu.user_id = auth.uid();

  -- UNX-XXXX-XXXX (sem 0/O e 1/I para não confundir ao digitar)
  loop
    select 'UNX-' || string_agg(
             case when i = 5 then '-' else
               substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::int, 1)
             end, '' order by i)
      into v_code
    from generate_series(1, 9) i;

    exit when not exists (select 1 from public.report_exports where code = v_code);
  end loop;

  insert into public.report_exports (
    code, clinic_id, generated_by, generated_by_name, report_type, format,
    period_start, period_end, filters, data_hash
  ) values (
    v_code, p_clinic_id, auth.uid(), v_name, p_report_type, p_format,
    p_period_start, p_period_end, coalesce(p_filters, '{}'::jsonb), lower(p_data_hash)
  )
  returning * into v_row;

  return jsonb_build_object(
    'code', v_row.code,
    'createdAt', v_row.created_at,
    'generatedByName', v_row.generated_by_name
  );
end;
$$;

create or replace function public.list_report_exports(
  p_clinic_id uuid,
  p_limit integer default 20
)
returns setof public.report_exports
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_clinic_admin_of(p_clinic_id) then
    raise exception 'Não autorizado';
  end if;

  return query
  select * from public.report_exports re
  where re.clinic_id = p_clinic_id
  order by re.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

create or replace function public.verify_report_export(
  p_clinic_id uuid,
  p_code text
)
returns setof public.report_exports
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_clinic_admin_of(p_clinic_id) then
    raise exception 'Não autorizado';
  end if;

  return query
  select * from public.report_exports re
  where re.clinic_id = p_clinic_id
    and re.code = upper(btrim(p_code));
end;
$$;

revoke execute on function public.register_report_export(uuid, text, text, timestamptz, timestamptz, jsonb, text) from public, anon;
revoke execute on function public.list_report_exports(uuid, integer) from public, anon;
revoke execute on function public.verify_report_export(uuid, text) from public, anon;
grant execute on function public.register_report_export(uuid, text, text, timestamptz, timestamptz, jsonb, text) to authenticated;
grant execute on function public.list_report_exports(uuid, integer) to authenticated;
grant execute on function public.verify_report_export(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Painel: situação agora + números de hoje
-- -----------------------------------------------------------------------------
create or replace function public.operational_now(
  p_clinic_id uuid,
  p_channels text[] default null,
  p_department_id uuid default null,
  p_timezone text default 'America/Sao_Paulo',
  -- Sinal de vida mais recente que isso = online (o app manda a cada minuto)
  p_online_window_seconds integer default 150
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
  v_now timestamptz := now();
  v_today_start timestamptz;
  v_online_since timestamptz;
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_clinic_admin_of(p_clinic_id) then
    raise exception 'Não autorizado';
  end if;

  if not public.clinic_has_feature(p_clinic_id, 'analytics') then
    raise exception 'Recurso fora do plano';
  end if;

  select tz.name into v_tz from pg_timezone_names tz where tz.name = p_timezone;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select s.sla_first_response_after_minutes * 60
    into v_sla_sec
  from public.conversation_automation_settings s
  where s.clinic_id = p_clinic_id
    and s.sla_first_response_enabled = true
    and s.sla_first_response_after_minutes is not null;
  v_sla_sec := coalesce(v_sla_sec, 120);

  -- Meia-noite de hoje no fuso de quem está olhando
  v_today_start := ((v_now at time zone v_tz)::date)::timestamp at time zone v_tz;
  v_online_since := v_now - make_interval(secs => greatest(30, least(coalesce(p_online_window_seconds, 150), 900)));

  with active as materialized (
    select
      c.id,
      c.status::text as status,
      c.assigned_user_id,
      c.in_bot_flow,
      c.first_unanswered_inbound_at,
      lm.direction::text as last_direction,
      lm.created_at as last_at,
      -- mesma regra do inbox_backlog: violação referente à espera atual
      (
        c.sla_breached_at is not null
        and c.first_unanswered_inbound_at is not null
        and c.sla_breached_at >= c.first_unanswered_inbound_at
      ) as breached
    from public.conversations c
    cross join lateral (
      select m.direction, m.created_at
      from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc
      limit 1
    ) lm
    where c.clinic_id = p_clinic_id
      and c.status in ('open', 'pending')
      and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
      and (p_department_id is null or c.department_id = p_department_id)
  ),
  waiting as (
    select * from active where last_direction = 'inbound'
  ),
  team as (
    select
      cu.user_id,
      coalesce(nullif(btrim(cu.name), ''), cu.email, 'Sem nome') as name,
      cu.role,
      up.last_seen_at
    from public.clinic_users cu
    left join public.user_presence up on up.user_id = cu.user_id
    where cu.clinic_id = p_clinic_id
  ),
  inbound_today as (
    select extract(hour from (m.created_at at time zone v_tz))::int as hour, count(*)::int as n
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where c.clinic_id = p_clinic_id
      and m.direction = 'inbound'
      and m.created_at >= v_today_start
      and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
      and (p_department_id is null or c.department_id = p_department_id)
    group by 1
  )
  select jsonb_build_object(
    'generatedAt', v_now,
    'todayStart', v_today_start,
    'slaThresholdSec', v_sla_sec,
    'now', jsonb_build_object(
      'active', (select count(*) from active),
      'open', (select count(*) from active where status = 'open'),
      'pending', (select count(*) from active where status = 'pending' and not in_bot_flow),
      'inBot', (select count(*) from active where in_bot_flow),
      'unassigned', (select count(*) from active where assigned_user_id is null and not in_bot_flow),
      'waiting', (select count(*) from waiting),
      'slaBreached', (select count(*) from waiting where breached),
      'oldestWaitingAt', (select min(last_at) from waiting),
      'teamTotal', (select count(*) from team),
      'teamOnline', (select count(*) from team where last_seen_at >= v_online_since)
    ),
    -- Mesmo cálculo dos relatórios: hoje até agora e ontem até este mesmo horário
    'today', public.report_period_kpis(p_clinic_id, v_today_start, v_now, p_channels, p_department_id, null, v_sla_sec),
    'yesterdaySoFar', public.report_period_kpis(
      p_clinic_id, v_today_start - interval '1 day', v_now - interval '1 day', p_channels, p_department_id, null, v_sla_sec
    ),
    'inboundByHourToday', (
      select jsonb_agg(coalesce(i.n, 0) order by g.hour)
      from generate_series(0, 23) as g(hour)
      left join inbound_today i on i.hour = g.hour
    ),
    'team', (
      select coalesce(jsonb_agg(row_data order by (row_data->>'online')::boolean desc, (row_data->>'waiting')::int desc, row_data->>'name'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'userId', t.user_id,
          'name', t.name,
          'role', t.role,
          'lastSeenAt', t.last_seen_at,
          'online', coalesce(t.last_seen_at >= v_online_since, false),
          'active', (select count(*) from active a where a.assigned_user_id = t.user_id),
          'waiting', (select count(*) from waiting w where w.assigned_user_id = t.user_id),
          'slaBreached', (select count(*) from waiting w where w.assigned_user_id = t.user_id and w.breached),
          'oldestWaitingAt', (select min(w.last_at) from waiting w where w.assigned_user_id = t.user_id),
          'closedToday', (
            select count(*) from public.conversations c
            where c.clinic_id = p_clinic_id
              and c.assigned_user_id = t.user_id
              and c.closed_at >= v_today_start
              and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
              and (p_department_id is null or c.department_id = p_department_id)
          )
        ) as row_data
        from team t
      ) rows
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.operational_now(uuid, text[], uuid, text, integer) from public, anon;
grant execute on function public.operational_now(uuid, text[], uuid, text, integer) to authenticated;

commit;
