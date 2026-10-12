-- =============================================================================
-- Automações de conversa agendadas e indicador de SLA estourado
--
-- 1. As três automações da tela "Automações do chat" (SLA da primeira
--    resposta, voltar para fila de espera e fechamento automático) dependem
--    de funções job_conversation_* que não tinham agendamento no repositório.
--    Sem o agendamento, ligar a opção na tela não produz efeito algum.
--
-- 2. job_conversation_sla_first_response:
--    - só avalia conversas abertas ou pendentes (uma conversa encerrada não
--      "estoura" depois);
--    - não marca enquanto o cliente ainda está sendo atendido pelo bot: o
--      prazo é para a primeira resposta de uma pessoa.
--
-- 3. inbox_backlog passa a dizer quais conversas aguardando resposta já
--    passaram do prazo de SLA (o painel e a lista exibem "SLA estourado").
--
-- ATENÇÃO — primeira execução: se alguma clínica já está com "Fechamento
-- automático" ou "Voltar para fila de espera" ligados, o primeiro ciclo aplica
-- a regra a todas as conversas que já passaram do prazo configurado, de uma
-- vez. Confira antes com a consulta indicada na descrição do PR.
--
-- Ordem de deploy: aplique ANTES de publicar o frontend desta entrega.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. SLA da primeira resposta
-- -----------------------------------------------------------------------------
create or replace function public.job_conversation_sla_first_response()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with eligible as (
    select c.id
    from public.conversations c
    join public.conversation_automation_settings s
      on s.clinic_id = c.clinic_id
    where s.sla_first_response_enabled = true
      and s.sla_first_response_after_minutes is not null
      and c.status in ('open', 'pending')
      and c.first_unanswered_inbound_at is not null
      and c.sla_breached_at is null
      and now() >= c.first_unanswered_inbound_at
        + (s.sla_first_response_after_minutes * interval '1 minute')
      -- ainda no atendimento automático: o prazo é para a resposta humana
      and not exists (
        select 1
        from public.conversation_bot_sessions bs
        where bs.conversation_id = c.id
          and bs.status = 'active'
      )
  ),
  updated as (
    update public.conversations c
    set
      sla_breached_at = now(),
      updated_at = now()
    from eligible e
    where c.id = e.id
      and c.sla_breached_at is null
    returning c.id
  )
  insert into public.conversation_events (
    conversation_id,
    event_type,
    performed_by,
    metadata,
    created_at
  )
  select
    u.id,
    'sla_first_response_breached',
    null,
    jsonb_build_object('reason', 'sla_first_response_timeout'),
    now()
  from updated u;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.job_conversation_sla_first_response() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Backlog com indicação de SLA estourado
-- -----------------------------------------------------------------------------
-- O tipo de retorno muda (colunas novas), então a função é recriada
drop function if exists public.inbox_backlog(uuid, text[], uuid, uuid, integer);

create function public.inbox_backlog(
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
  total_count bigint,
  sla_breached boolean,
  sla_breached_count bigint
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
  with waiting as (
    select
      c.id,
      coalesce(nullif(btrim(ct.name), ''), ct.phone, 'Contato sem nome') as contact_label,
      c.channel::text as channel_label,
      coalesce(d.name, 'Sem departamento') as department_label,
      coalesce(nullif(btrim(cu.name), ''), 'Não atribuído') as assignee_label,
      lm.created_at as last_at,
      case when lm.deleted_at is not null then null else lm.text end as last_text,
      -- mesma regra da tela: violação referente à espera atual
      (
        c.sla_breached_at is not null
        and c.first_unanswered_inbound_at is not null
        and c.sla_breached_at >= c.first_unanswered_inbound_at
      ) as breached
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
  )
  select
    w.id,
    w.contact_label,
    w.channel_label,
    w.department_label,
    w.assignee_label,
    w.last_at,
    w.last_text,
    count(*) over (),
    w.breached,
    count(*) filter (where w.breached) over ()
  from waiting w
  -- quem espera há mais tempo primeiro
  order by w.last_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
end;
$$;

revoke execute on function public.inbox_backlog(uuid, text[], uuid, uuid, integer) from public, anon;
grant execute on function public.inbox_backlog(uuid, text[], uuid, uuid, integer) to authenticated;

commit;

-- -----------------------------------------------------------------------------
-- 3. Agendamento (a cada minuto; reagendar com o mesmo nome substitui o job)
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule(
  'conversation-sla-first-response',
  '* * * * *',
  $$select public.job_conversation_sla_first_response();$$
);

select cron.schedule(
  'conversation-return-to-pending',
  '* * * * *',
  $$select public.job_conversation_return_to_pending();$$
);

select cron.schedule(
  'conversation-auto-close',
  '*/5 * * * *',
  $$select public.job_conversation_auto_close();$$
);
