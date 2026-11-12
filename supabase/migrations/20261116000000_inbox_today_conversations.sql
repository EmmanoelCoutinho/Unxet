-- =============================================================================
-- Painel: lista "Atendimentos de hoje"
--
-- Conversas com movimento desde a meia-noite (no fuso de quem abre o Painel):
-- chegou ou saiu mensagem, a conversa foi criada ou foi finalizada hoje.
-- Mesmas regras de acesso da fila (inbox_backlog): só o que a pessoa já pode
-- abrir. A mais recente aparece primeiro.
--
-- Só leitura; o front antigo não usa a função.
-- =============================================================================

begin;

create or replace function public.inbox_today_conversations(
  p_clinic_id uuid,
  p_channels text[] default null,
  p_department_id uuid default null,
  p_timezone text default 'America/Sao_Paulo',
  p_limit integer default 500
)
returns table (
  conversation_id uuid,
  contact text,
  channel text,
  department text,
  assigned_to text,
  status text,
  in_bot_flow boolean,
  last_activity_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_day_start timestamptz;
begin
  if auth.uid() is null or not public.is_clinic_member(p_clinic_id) then
    raise exception 'Não autorizado';
  end if;

  select tz.name into v_tz from pg_timezone_names tz where tz.name = p_timezone;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_day_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  return query
  with today as (
    select
      c.id,
      coalesce(nullif(btrim(ct.name), ''), ct.phone, 'Contato sem nome') as contact_label,
      c.channel::text as channel_label,
      coalesce(d.name, 'Sem departamento') as department_label,
      coalesce(nullif(btrim(cu.name), ''), 'Não atribuído') as assignee_label,
      c.status::text as status_label,
      coalesce(c.in_bot_flow, false) as bot,
      greatest(
        coalesce(c.last_message_at, c.created_at),
        coalesce(c.closed_at, c.created_at),
        c.created_at
      ) as activity_at
    from public.conversations c
    left join public.contacts ct on ct.id = c.contact_id
    left join public.departments d on d.id = c.department_id
    left join public.clinic_users cu
      on cu.user_id = c.assigned_user_id
     and cu.clinic_id = c.clinic_id
    where c.clinic_id = p_clinic_id
      and (
        c.last_message_at >= v_day_start
        or c.created_at >= v_day_start
        or c.closed_at >= v_day_start
      )
      and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
      and (p_department_id is null or c.department_id = p_department_id)
      and public.can_access_conversation(c.clinic_id, c.department_id, c.assigned_user_id)
  )
  select
    t.id,
    t.contact_label,
    t.channel_label,
    t.department_label,
    t.assignee_label,
    t.status_label,
    t.bot,
    t.activity_at,
    count(*) over ()
  from today t
  order by t.activity_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
end;
$$;

revoke execute on function public.inbox_today_conversations(uuid, text[], uuid, text, integer) from public, anon;
grant execute on function public.inbox_today_conversations(uuid, text[], uuid, text, integer) to authenticated;

commit;
