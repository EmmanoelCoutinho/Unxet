-- =============================================================================
-- Pesquisa de satisfação: escala da nota escolhida pela empresa
--
-- Antes a nota era sempre de 1 a 5. Agora cada empresa escolhe a nota mínima
-- (0 a 9) e a máxima (até 10) em Automações. O padrão continua 1 a 5.
--
-- Cada pesquisa guarda a escala em que foi enviada (scale_min / scale_max).
-- Os relatórios convertem todas as notas para a escala atual da empresa, então
-- trocar a escala não distorce a média de avaliações antigas.
--   - "Satisfeitos" (CSAT): nota no quarto de cima da escala (4 e 5 em 1 a 5;
--     8 a 10 em 1 a 10 ou 0 a 10).
--   - "Notas baixas": quarto de baixo (1 e 2 em 1 a 5; 1 a 3 em 1 a 10).
--
-- Ordem de deploy: aplique ANTES de publicar as edge functions e o frontend.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Configuração da escala
-- -----------------------------------------------------------------------------
alter table public.conversation_automation_settings
  add column if not exists satisfaction_survey_scale_min smallint not null default 1,
  add column if not exists satisfaction_survey_scale_max smallint not null default 5;

alter table public.conversation_automation_settings
  drop constraint if exists conversation_automation_settings_survey_scale_check;
alter table public.conversation_automation_settings
  add constraint conversation_automation_settings_survey_scale_check
  check (
    satisfaction_survey_scale_min >= 0
    and satisfaction_survey_scale_max <= 10
    and satisfaction_survey_scale_min < satisfaction_survey_scale_max
  );

-- -----------------------------------------------------------------------------
-- 2. Escala de cada pesquisa
-- -----------------------------------------------------------------------------
alter table public.satisfaction_surveys
  add column if not exists scale_min smallint not null default 1,
  add column if not exists scale_max smallint not null default 5;

alter table public.satisfaction_surveys
  drop constraint if exists satisfaction_surveys_score_check;
alter table public.satisfaction_surveys
  drop constraint if exists satisfaction_surveys_scale_check;
alter table public.satisfaction_surveys
  add constraint satisfaction_surveys_scale_check
  check (
    scale_min >= 0 and scale_max <= 10 and scale_min < scale_max
    and (score is null or score between scale_min and scale_max)
  );

-- Posição da nota na escala: 0 = nota mínima, 1 = nota máxima
create or replace function public.survey_score_ratio(p_score numeric, p_min numeric, p_max numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_score is null or p_max is null or p_min is null or p_max <= p_min then null
    else (p_score - p_min) / (p_max - p_min)
  end;
$$;

-- Nota convertida para outra escala (ex.: 4 de 1 a 5 -> 7,75 de 1 a 10)
create or replace function public.survey_score_in_scale(
  p_score numeric, p_min numeric, p_max numeric, p_to_min numeric, p_to_max numeric
)
returns numeric
language sql
immutable
as $$
  select p_to_min + public.survey_score_ratio(p_score, p_min, p_max) * (p_to_max - p_to_min);
$$;

grant execute on function public.survey_score_ratio(numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.survey_score_in_scale(numeric, numeric, numeric, numeric, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Relatórios: notas convertidas para a escala atual
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
  scale as (
    select
      coalesce(cs.satisfaction_survey_scale_min, 1)::numeric as smin,
      coalesce(cs.satisfaction_survey_scale_max, 5)::numeric as smax
    from (select 1) one
    left join public.conversation_automation_settings cs on cs.clinic_id = p_clinic_id
  ),
  surveys as (
    select
      ss.status,
      public.survey_score_in_scale(ss.score, ss.scale_min, ss.scale_max, sc.smin, sc.smax) as score,
      public.survey_score_ratio(ss.score, ss.scale_min, ss.scale_max) as ratio
    from public.satisfaction_surveys ss
    cross join scale sc
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
      select round(100.0 * count(*) filter (where ratio >= 0.75) / nullif(count(*), 0), 1)
      from surveys where status = 'answered'
    )
  );
$$;


CREATE OR REPLACE FUNCTION public.operational_report(p_clinic_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_channels text[] DEFAULT NULL::text[], p_department_id uuid DEFAULT NULL::uuid, p_assigned_user_id uuid DEFAULT NULL::uuid, p_timezone text DEFAULT 'America/Sao_Paulo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text;
  v_sla_sec integer;
  v_prev_start timestamptz;
  v_result jsonb;
  v_scale_min numeric;
  v_scale_max numeric;
begin
  if auth.uid() is null or not public.has_clinic_permission(p_clinic_id, 'reports.view') then
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

  select s.satisfaction_survey_scale_min, s.satisfaction_survey_scale_max
    into v_scale_min, v_scale_max
  from public.conversation_automation_settings s
  where s.clinic_id = p_clinic_id;
  v_scale_min := coalesce(v_scale_min, 1);
  v_scale_max := coalesce(v_scale_max, 5);

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
    select
      ss.*,
      -- nota na escala atual da empresa (avaliações antigas podem ter outra)
      public.survey_score_in_scale(ss.score, ss.scale_min, ss.scale_max, v_scale_min, v_scale_max) as nscore,
      public.survey_score_ratio(ss.score, ss.scale_min, ss.scale_max) as ratio
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
            select round(avg(sv.nscore)::numeric, 2) from surveys sv
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
      'scaleMin', v_scale_min,
      'scaleMax', v_scale_max,
      -- notas no quarto de baixo da escala (mesmo critério da lista lowScores)
      'lowCount', (
        select count(*) from surveys sv where sv.status = 'answered' and sv.ratio <= 0.25
      ),
      'distribution', (
        select jsonb_agg(jsonb_build_object('score', g, 'count', (
          select count(*) from surveys sv where sv.status = 'answered' and round(sv.nscore) = g
        )) order by g)
        from generate_series(v_scale_min::int, v_scale_max::int) g
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
            round(avg(sv.nscore)::numeric, 2) as avg_score
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
            'scaleMin', sv.scale_min,
            'scaleMax', sv.scale_max,
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
          where sv.status = 'answered' and sv.ratio <= 0.25
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
$function$;

-- -----------------------------------------------------------------------------
-- 4. Métricas da plataforma (admin): média sempre de 1 a 5
-- -----------------------------------------------------------------------------
create or replace function public.platform_metrics(
  p_days integer default 30,
  p_timezone text default 'America/Sao_Paulo'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_tz text;
  v_today date;
  v_start timestamptz;
  v_result jsonb;
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.platform_admins pa where pa.user_id = auth.uid()
     ) then
    raise exception 'Não autorizado' using errcode = '42501';
  end if;

  -- Fuso do navegador; cai no padrão se vier algo desconhecido
  select tz.name into v_tz from pg_timezone_names tz where tz.name = p_timezone;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  -- Últimos N dias corridos, contando hoje
  v_today := (now() at time zone v_tz)::date;
  v_start := (v_today - (v_days - 1))::timestamp at time zone v_tz;

  with
  -- Uma passada pelas mensagens, agrupada por empresa
  msg as materialized (
    select
      c.clinic_id,
      count(*) as total,
      count(*) filter (where m.created_at >= v_start) as period,
      count(*) filter (where m.created_at >= v_start and m.direction = 'inbound') as period_inbound,
      count(*) filter (where m.created_at >= v_start and m.direction = 'outbound') as period_outbound,
      count(*) filter (where m.created_at >= v_start and m.is_automated) as period_automated,
      count(*) filter (where m.type = 'image') as images,
      count(*) filter (where m.type = 'image' and m.created_at >= v_start) as period_images,
      count(*) filter (where m.type = 'audio') as audios,
      count(*) filter (where m.type = 'audio' and m.created_at >= v_start) as period_audios,
      count(*) filter (where m.type = 'video') as videos,
      count(*) filter (where m.type = 'video' and m.created_at >= v_start) as period_videos,
      count(*) filter (where m.type = 'document') as documents,
      count(*) filter (where m.type = 'document' and m.created_at >= v_start) as period_documents,
      count(*) filter (where m.type = 'sticker') as stickers,
      count(*) filter (where m.type = 'sticker' and m.created_at >= v_start) as period_stickers,
      count(*) filter (where btrim(coalesce(m.transcript_text, '')) <> '') as transcribed,
      count(*) filter (
        where btrim(coalesce(m.transcript_text, '')) <> '' and m.created_at >= v_start
      ) as period_transcribed,
      max(m.created_at) as last_message_at
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where c.clinic_id is not null
    group by c.clinic_id
  ),
  conv as materialized (
    select
      c.clinic_id,
      count(*) as total,
      count(*) filter (where c.created_at >= v_start) as period,
      count(*) filter (where c.status = 'open') as open,
      count(*) filter (where c.status = 'pending') as pending,
      count(*) filter (where c.status = 'closed') as closed
    from public.conversations c
    where c.clinic_id is not null
    group by c.clinic_id
  ),
  people as materialized (
    select
      cu.clinic_id,
      count(*) as total,
      count(*) filter (where cu.role = 'admin') as admins,
      count(*) filter (where cu.role = 'agent') as agents,
      count(*) filter (where u.last_sign_in_at >= v_start) as active
    from public.clinic_users cu
    join auth.users u on u.id = cu.user_id
    group by cu.clinic_id
  ),
  contact as materialized (
    select
      ct.clinic_id,
      count(*) as total,
      count(*) filter (where ct.created_at >= v_start) as period
    from public.contacts ct
    where ct.clinic_id is not null
    group by ct.clinic_id
  ),
  channel as materialized (
    select
      cc.clinic_id,
      count(*) as connected,
      count(*) filter (where cc.provider = 'evolution') as connected_qr,
      count(*) filter (where cc.provider = 'meta') as connected_official
    from public.channel_connections cc
    where cc.status = 'connected'
    group by cc.clinic_id
  ),
  -- 1ª resposta humana depois da 1ª mensagem do cliente (bot não conta)
  first_response as materialized (
    select extract(epoch from (fo.at - fi.at))::numeric as seconds
    from public.conversations c
    cross join lateral (
      select min(m.created_at) as at
      from public.messages m
      where m.conversation_id = c.id
        and m.direction = 'inbound'
    ) fi
    cross join lateral (
      select min(m.created_at) as at
      from public.messages m
      where m.conversation_id = c.id
        and m.direction = 'outbound'
        and m.is_automated = false
        and m.created_at >= fi.at
    ) fo
    where c.created_at >= v_start
      and fi.at is not null
      and fo.at is not null
  ),
  bot_sessions as materialized (
    select
      count(*) as period,
      -- o bot levou a conversa até o fim do fluxo, sem precisar de atendente
      count(*) filter (where s.ended_reason = 'flow_end') as resolved,
      count(*) filter (where s.ended_reason in ('handoff', 'human_reply')) as handed_off
    from public.conversation_bot_sessions s
    where s.started_at >= v_start
  ),
  survey as materialized (
    select
      count(*) as sent,
      count(*) filter (where s.status = 'answered') as answered,
      -- notas convertidas para 1 a 5 (cada empresa pode usar outra escala)
      avg(public.survey_score_in_scale(s.score, s.scale_min, s.scale_max, 1, 5))
        filter (where s.status = 'answered') as avg_score
    from public.satisfaction_surveys s
    where s.sent_at >= v_start
  ),
  daily as materialized (
    select
      d.day::date as day,
      coalesce(x.inbound, 0) as inbound,
      coalesce(x.outbound, 0) as outbound
    from generate_series(v_today - (v_days - 1), v_today, interval '1 day') as d(day)
    left join (
      select
        (m.created_at at time zone v_tz)::date as day,
        count(*) filter (where m.direction = 'inbound') as inbound,
        count(*) filter (where m.direction = 'outbound') as outbound
      from public.messages m
      where m.created_at >= v_start
      group by 1
    ) x on x.day = d.day::date
  ),
  by_channel as materialized (
    select c.channel::text as channel, count(*) as conversations
    from public.conversations c
    where c.created_at >= v_start
    group by c.channel
  ),
  per_clinic as materialized (
    select
      cl.id,
      cl.name,
      cl.created_at,
      coalesce(p.total, 0) as people,
      coalesce(p.active, 0) as active_people,
      coalesce(ch.connected, 0) as channels,
      coalesce(ct.total, 0) as contacts,
      coalesce(cv.total, 0) as conversations,
      coalesce(cv.period, 0) as period_conversations,
      coalesce(mg.total, 0) as messages,
      coalesce(mg.period, 0) as period_messages,
      mg.last_message_at
    from public.clinics cl
    left join people p on p.clinic_id = cl.id
    left join channel ch on ch.clinic_id = cl.id
    left join contact ct on ct.clinic_id = cl.id
    left join conv cv on cv.clinic_id = cl.id
    left join msg mg on mg.clinic_id = cl.id
  )
  select jsonb_build_object(
    'days', v_days,
    'start', v_start,
    'generated_at', now(),
    'clinics', jsonb_build_object(
      'total', (select count(*) from per_clinic),
      'new', (select count(*) from per_clinic where created_at >= v_start),
      -- empresa "ativa" = trocou ao menos uma mensagem no período
      'active', (select count(*) from per_clinic where period_messages > 0)
    ),
    'people', (
      select jsonb_build_object(
        'total', coalesce(sum(total), 0),
        'admins', coalesce(sum(admins), 0),
        'agents', coalesce(sum(agents), 0),
        'active', coalesce(sum(active), 0)
      ) from people
    ),
    'contacts', (
      select jsonb_build_object(
        'total', coalesce(sum(total), 0),
        'new', coalesce(sum(period), 0)
      ) from contact
    ),
    'conversations', (
      select jsonb_build_object(
        'total', coalesce(sum(total), 0),
        'period', coalesce(sum(period), 0),
        'open', coalesce(sum(open), 0),
        'pending', coalesce(sum(pending), 0),
        'closed', coalesce(sum(closed), 0)
      ) from conv
    ),
    'conversations_by_channel', coalesce(
      (select jsonb_agg(jsonb_build_object('channel', channel, 'conversations', conversations)
                        order by conversations desc) from by_channel),
      '[]'::jsonb
    ),
    'messages', (
      select jsonb_build_object(
        'total', coalesce(sum(total), 0),
        'period', coalesce(sum(period), 0),
        'period_inbound', coalesce(sum(period_inbound), 0),
        'period_outbound', coalesce(sum(period_outbound), 0),
        'period_automated', coalesce(sum(period_automated), 0)
      ) from msg
    ),
    'media', (
      select jsonb_build_object(
        'images', jsonb_build_object('total', coalesce(sum(images), 0), 'period', coalesce(sum(period_images), 0)),
        'audios', jsonb_build_object('total', coalesce(sum(audios), 0), 'period', coalesce(sum(period_audios), 0)),
        'videos', jsonb_build_object('total', coalesce(sum(videos), 0), 'period', coalesce(sum(period_videos), 0)),
        'documents', jsonb_build_object('total', coalesce(sum(documents), 0), 'period', coalesce(sum(period_documents), 0)),
        'stickers', jsonb_build_object('total', coalesce(sum(stickers), 0), 'period', coalesce(sum(period_stickers), 0)),
        'transcribed', jsonb_build_object('total', coalesce(sum(transcribed), 0), 'period', coalesce(sum(period_transcribed), 0))
      ) from msg
    ),
    'channels', (
      select jsonb_build_object(
        'connected', coalesce(sum(connected), 0),
        'connected_qr', coalesce(sum(connected_qr), 0),
        'connected_official', coalesce(sum(connected_official), 0)
      ) from channel
    ),
    'bots', jsonb_build_object(
      'active', (
        select count(*) from public.bots b
        where b.status = 'active' and b.published and not b.is_deleted
      ),
      'sessions', (select period from bot_sessions),
      'resolved', (select resolved from bot_sessions),
      'handed_off', (select handed_off from bot_sessions)
    ),
    'first_response', (
      select jsonb_build_object(
        'conversations', count(*),
        'avg_seconds', round(avg(seconds)),
        'median_seconds', round((percentile_cont(0.5) within group (order by seconds))::numeric)
      ) from first_response
    ),
    'satisfaction', (
      select jsonb_build_object(
        'sent', sent,
        'answered', answered,
        'avg_score', round(avg_score, 2)
      ) from survey
    ),
    'daily', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'day', to_char(day, 'YYYY-MM-DD'), 'inbound', inbound, 'outbound', outbound
              ) order by day) from daily),
      '[]'::jsonb
    ),
    'per_clinic', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id', id,
                'name', name,
                'created_at', created_at,
                'people', people,
                'active_people', active_people,
                'channels', channels,
                'contacts', contacts,
                'conversations', conversations,
                'period_conversations', period_conversations,
                'messages', messages,
                'period_messages', period_messages,
                'last_message_at', last_message_at
              ) order by period_messages desc, name) from per_clinic),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

commit;
