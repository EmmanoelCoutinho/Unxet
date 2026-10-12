-- =============================================================================
-- Painel administrativo da Unxet: números da plataforma
--
-- platform_metrics devolve, em uma chamada, os totais de todas as empresas e o
-- recorte dos últimos N dias: empresas, pessoas, contatos, conversas, mensagens
-- (por tipo de mídia), canais conectados, bot, tempo de 1ª resposta,
-- satisfação, mensagens por dia e um resumo por empresa.
--
-- Só administradores da plataforma (platform_admins) podem chamar: a função é
-- security definer e enxerga todas as empresas.
--
-- Ordem de deploy: aplique ANTES de publicar o frontend desta entrega.
-- =============================================================================

begin;

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
      avg(s.score) filter (where s.status = 'answered') as avg_score
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

revoke execute on function public.platform_metrics(integer, text) from public, anon;
grant execute on function public.platform_metrics(integer, text) to authenticated;

commit;
