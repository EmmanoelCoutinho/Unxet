-- =============================================================================
-- Conversa conduzida pelo bot fica fora da fila dos atendentes
--
-- Antes, a conversa aparecia em "Pendentes" (com contagem de não lidas e
-- notificação) assim que o cliente mandava a primeira mensagem, mesmo com o
-- bot ainda atendendo. Agora conversations.in_bot_flow marca esse período:
--   - true quando o bot inicia o atendimento;
--   - false quando o bot passa para uma pessoa (handoff / transferência),
--     desiste por opções inválidas, falha, ou quando o cliente escreve e o bot
--     não vai responder (fluxo já encerrado).
-- Quem grava a coluna são as edge functions (bot-engine, shared-in-config,
-- accept-conversation, transfer-conversation).
--
-- O prazo do SLA de primeira resposta passa a contar do momento em que a
-- conversa entra na fila, e não da primeira mensagem enviada ao bot.
--
-- Ordem de deploy: aplique ANTES de publicar as edge functions e o frontend
-- desta entrega (os dois leem/gravam a coluna nova).
-- =============================================================================

begin;

alter table public.conversations
  add column if not exists in_bot_flow boolean not null default false;

comment on column public.conversations.in_bot_flow is
  'true enquanto o bot conduz a conversa; nesse período ela não aparece na fila dos atendentes';

-- Conversas que estão com o bot neste momento
update public.conversations c
   set in_bot_flow = true
 where c.status = 'pending'
   and c.assigned_user_id is null
   and c.in_bot_flow = false
   and exists (
     select 1
     from public.conversation_bot_sessions bs
     where bs.conversation_id = c.id
       and bs.status = 'active'
   );

-- -----------------------------------------------------------------------------
-- SLA da primeira resposta: ignora conversas que estão com o bot
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
      and c.in_bot_flow = false
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

commit;
