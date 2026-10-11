-- =============================================================================
-- Departamento padrão atômico e "voltar para a fila" de verdade
--
-- 1. set_default_department: a tela trocava o departamento padrão em duas
--    chamadas (tira o padrão de todos, depois marca o novo). Se a segunda
--    falhasse, a clínica ficava SEM departamento padrão e toda mensagem nova
--    de cliente era recusada pelo webhook. Agora a troca acontece em uma
--    transação só.
--
-- 2. job_conversation_return_to_pending ("Voltar para fila de espera"):
--    - só devolve a conversa quando o cliente está de fato esperando (a
--      última mensagem do cliente é mais recente que a última resposta).
--      Antes bastava passar o tempo desde a última mensagem do cliente,
--      mesmo que o atendente já tivesse respondido;
--    - tira o responsável. Antes a conversa ficava "pendente" mas presa ao
--      mesmo atendente: pela regra de acesso só ele e os admins a viam, então
--      ninguém do setor conseguia assumir.
--
-- Ordem de deploy: aplique ANTES de publicar o frontend desta entrega (a tela
-- de departamentos passa a chamar set_default_department).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Troca do departamento padrão em uma transação
-- -----------------------------------------------------------------------------
create or replace function public.set_default_department(p_department_id uuid)
returns public.departments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department public.departments;
begin
  select d.* into v_department
  from public.departments d
  where d.id = p_department_id;

  if v_department.id is null
     or not exists (
       select 1
       from public.clinic_users cu
       where cu.user_id = auth.uid()
         and cu.clinic_id = v_department.clinic_id
         and cu.role = 'admin'
     ) then
    raise exception 'Você não tem permissão para esta ação' using errcode = '42501';
  end if;

  -- O webhook só aceita mensagens se houver um departamento padrão ATIVO
  if not v_department.is_active then
    raise exception 'Ative o departamento antes de defini-lo como padrão';
  end if;

  -- Duas instruções por causa do índice único "um padrão por clínica"
  update public.departments
     set is_default = false
   where clinic_id = v_department.clinic_id
     and is_default = true
     and id <> p_department_id;

  update public.departments
     set is_default = true
   where id = p_department_id
  returning * into v_department;

  return v_department;
end;
$$;

revoke execute on function public.set_default_department(uuid) from public, anon;
grant execute on function public.set_default_department(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Voltar para a fila de espera
-- -----------------------------------------------------------------------------
create or replace function public.job_conversation_return_to_pending()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with eligible as (
    select
      c.id,
      c.clinic_id,
      s.return_to_pending_after_minutes
    from public.conversations c
    join public.conversation_automation_settings s
      on s.clinic_id = c.clinic_id
    where c.status = 'open'
      and s.return_to_pending_enabled = true
      and c.last_inbound_at is not null
      -- o cliente está esperando: nenhuma resposta depois da última mensagem dele
      and (c.last_outbound_at is null or c.last_outbound_at < c.last_inbound_at)
      and now() >= c.last_inbound_at
        + (s.return_to_pending_after_minutes * interval '1 minute')
  ),
  updated as (
    update public.conversations c
    set
      status = 'pending',
      assigned_user_id = null,
      status_changed_at = now(),
      pending_returned_at = now(),
      updated_at = now()
    from eligible e
    where c.id = e.id
      and c.status = 'open'
    returning c.id, c.clinic_id
  ),
  inserted_events as (
    insert into public.conversation_events (
      conversation_id,
      event_type,
      performed_by,
      metadata,
      created_at
    )
    select
      u.id,
      'returned_to_pending_automatically',
      null,
      jsonb_build_object(
        'reason', 'return_to_pending_timeout',
        'source', 'system',
        'automation', 'return_to_pending'
      ),
      now()
    from updated u
    returning conversation_id
  )
  select count(*)
  into v_count
  from updated;

  return v_count;
end;
$$;

revoke execute on function public.job_conversation_return_to_pending() from public, anon, authenticated;

commit;
