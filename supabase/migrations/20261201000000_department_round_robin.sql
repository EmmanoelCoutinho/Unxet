-- =============================================================================
-- Distribuição das conversas por rodízio, escolhida por departamento
--
-- 1. departments.distribution_mode:
--    - 'queue' (padrão): como sempre foi. A conversa entra em "Pendentes" e
--      alguém do setor aceita.
--    - 'round_robin': a conversa que chega ao setor vai direto para um
--      atendente, já aberta, em ordem circular (A, B, C, A, B, C...).
--      Só entram na vez atendentes do setor que não são administradores e
--      estão com o app aberto (sinal de vida em user_presence nos últimos
--      150 s, a mesma janela do Painel). Se ninguém estiver online, a
--      conversa fica em "Pendentes", como no modo fila.
--
-- 2. conversations.distribution_pending: marca a conversa que acabou de
--    chegar ao setor e ainda espera a vez do rodízio. Quem marca é o gatilho
--    abaixo, em três situações: conversa nova pendente, conversa encerrada
--    que reabriu, e conversa pendente sem responsável que mudou de setor
--    (transferência pela equipe, pelo bot ou pela IA). Conversa que VOLTA
--    para a fila (automação "Voltar para fila de espera", atendente que
--    devolve, atendente apagado) não é marcada: fica em "Pendentes".
--
-- 3. distribute_conversation(): faz a distribuição. As functions chamam
--    depois que o bot decidiu se vai atender (enquanto o bot conduz, ninguém
--    recebe a conversa; ela é distribuída quando o bot passa para uma pessoa).
--    A vez de cada setor fica em department_distribution_state, travada
--    durante a escolha: duas conversas chegando juntas vão para pessoas
--    diferentes.
--
-- Grupos de WhatsApp ficam fora do rodízio.
--
-- Ordem de deploy: aplique ANTES de publicar as functions (meta-in,
-- shared-in-config, bot-engine, transfer-conversation) e o frontend.
-- Sem as functions novas, nada muda: a marca fica sem uso e a conversa
-- segue para "Pendentes".
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Modo de distribuição do setor
-- -----------------------------------------------------------------------------
alter table public.departments
  add column if not exists distribution_mode text not null default 'queue';

alter table public.departments
  drop constraint if exists departments_distribution_mode_check;
alter table public.departments
  add constraint departments_distribution_mode_check
  check (distribution_mode in ('queue', 'round_robin'));

comment on column public.departments.distribution_mode is
  'queue: conversas novas ficam em Pendentes. round_robin: vão direto para um atendente online do setor, em ordem circular.';

-- -----------------------------------------------------------------------------
-- 2. Conversa aguardando a vez do rodízio
-- -----------------------------------------------------------------------------
alter table public.conversations
  add column if not exists distribution_pending boolean not null default false;

comment on column public.conversations.distribution_pending is
  'Chegou a um setor com rodízio e ainda não foi distribuída (ver distribute_conversation).';

create or replace function public.conversations_mark_distribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Aberta, encerrada ou com responsável: nada a distribuir
  if new.status <> 'pending' or new.assigned_user_id is not null then
    new.distribution_pending := false;
    return new;
  end if;

  -- Chegou ao setor agora: nova, reaberta ou transferida de setor
  if tg_op = 'INSERT'
     or old.status = 'closed'
     or new.department_id is distinct from old.department_id then
    new.distribution_pending := new.group_id is null
      and exists (
        select 1
        from public.departments d
        where d.id = new.department_id
          and d.is_active
          and d.distribution_mode = 'round_robin'
      );
  end if;

  return new;
end;
$$;

revoke execute on function public.conversations_mark_distribution() from public, anon, authenticated;

drop trigger if exists trg_conversations_mark_distribution_ins on public.conversations;
create trigger trg_conversations_mark_distribution_ins
  before insert on public.conversations
  for each row execute function public.conversations_mark_distribution();

drop trigger if exists trg_conversations_mark_distribution_upd on public.conversations;
create trigger trg_conversations_mark_distribution_upd
  before update on public.conversations
  for each row
  when (
    old.status is distinct from new.status
    or old.department_id is distinct from new.department_id
    or old.assigned_user_id is distinct from new.assigned_user_id
  )
  execute function public.conversations_mark_distribution();

-- -----------------------------------------------------------------------------
-- 3. De quem é a vez em cada setor
-- -----------------------------------------------------------------------------
create table if not exists public.department_distribution_state (
  department_id uuid primary key references public.departments (id) on delete cascade,
  last_user_id uuid,
  last_assigned_at timestamptz
);

alter table public.department_distribution_state enable row level security;
revoke all on table public.department_distribution_state from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Distribuição
-- -----------------------------------------------------------------------------
-- Retorna o atendente escolhido, ou null quando não distribuiu (sem marca,
-- bot atendendo, setor sem rodízio ou ninguém online).
create or replace function public.distribute_conversation(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.conversations;
  v_department public.departments;
  v_last_user_id uuid;
  v_user_id uuid;
  v_user_name text;
begin
  select c.* into v_conv
  from public.conversations c
  where c.id = p_conversation_id
  for update;

  if v_conv.id is null or not v_conv.distribution_pending then
    return null;
  end if;

  -- O bot ainda conduz a conversa: distribui quando ele passar para uma pessoa
  if v_conv.in_bot_flow
     or exists (
       select 1
       from public.conversation_bot_sessions bs
       where bs.conversation_id = v_conv.id
         and bs.status = 'active'
     ) then
    return null;
  end if;

  select d.* into v_department
  from public.departments d
  where d.id = v_conv.department_id;

  -- O setor deixou de usar o rodízio: segue a fila normal
  if v_department.id is null
     or not v_department.is_active
     or v_department.distribution_mode <> 'round_robin' then
    update public.conversations
       set distribution_pending = false
     where id = v_conv.id;
    return null;
  end if;

  -- Trava a vez do setor: conversas que chegam juntas esperam aqui
  insert into public.department_distribution_state (department_id)
  values (v_department.id)
  on conflict (department_id) do nothing;

  select s.last_user_id into v_last_user_id
  from public.department_distribution_state s
  where s.department_id = v_department.id
  for update;

  -- Ordem circular fixa (pelo id do usuário): o próximo depois de quem
  -- recebeu por último; no fim da lista, volta para o primeiro. Quem está
  -- offline é pulado e retoma o mesmo lugar quando volta.
  with candidates as (
    select cu.user_id, cu.name
    from public.clinic_users cu
    join public.user_presence up
      on up.user_id = cu.user_id
     and up.last_seen_at >= now() - interval '150 seconds'
    where cu.clinic_id = v_conv.clinic_id
      and cu.role <> 'admin'
      and (
        cu.department_id = v_department.id
        or exists (
          select 1
          from public.department_members dm
          where dm.department_id = v_department.id
            and dm.clinic_user_id = cu.user_id
        )
      )
  )
  select c.user_id, c.name into v_user_id, v_user_name
  from candidates c
  order by (v_last_user_id is not null and c.user_id > v_last_user_id) desc, c.user_id
  limit 1;

  if v_user_id is null then
    -- Ninguém online: fica em "Pendentes" para quem chegar aceitar
    update public.conversations
       set distribution_pending = false
     where id = v_conv.id;

    insert into public.conversation_events (conversation_id, event_type, performed_by, metadata)
    values (
      v_conv.id,
      'auto_assign_skipped',
      null,
      jsonb_build_object(
        'reason', 'no_attendant_online',
        'department_id', v_department.id,
        'department_name', v_department.name
      )
    );
    return null;
  end if;

  update public.conversations
     set status = 'open',
         assigned_user_id = v_user_id,
         in_bot_flow = false,
         closed_at = null,
         distribution_pending = false,
         status_changed_at = now(),
         updated_at = now()
   where id = v_conv.id;

  update public.department_distribution_state
     set last_user_id = v_user_id,
         last_assigned_at = now()
   where department_id = v_department.id;

  insert into public.conversation_events (conversation_id, event_type, performed_by, metadata)
  values (
    v_conv.id,
    'auto_assigned',
    null,
    jsonb_build_object(
      'assigned_user_id', v_user_id,
      'assigned_user_name', v_user_name,
      'department_id', v_department.id,
      'department_name', v_department.name
    )
  );

  return v_user_id;
end;
$$;

revoke execute on function public.distribute_conversation(uuid) from public, anon, authenticated;
grant execute on function public.distribute_conversation(uuid) to service_role;

commit;
