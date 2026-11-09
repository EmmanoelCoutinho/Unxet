-- =============================================================================
-- Mais de um atendente na mesma conversa + nome do atendente na mensagem
--
-- 1. conversation_participants: o responsável (ou quem atende todos os
--    setores) adiciona outros atendentes à conversa. Eles veem a conversa,
--    recebem os avisos e respondem junto com o responsável, mesmo sendo de
--    outro setor. A conversa continua tendo um único responsável
--    (assigned_user_id): só ele (ou um admin) transfere e finaliza.
--    Gravação só pelo service role (edge function conversation-participants).
--    Ao transferir, voltar para a fila ou finalizar, a lista é limpa (trigger).
--
-- 2. messages.sender_user_id / sender_name: quem enviou cada mensagem pelo
--    app. O texto guardado continua sem o nome; o cliente recebe
--    "*Nome:*\nmensagem" e a tela mostra o nome acima do balão.
--
-- 3. conversation_automation_settings.sign_agent_messages: liga/desliga o
--    nome do atendente nas mensagens (ligado por padrão).
--
-- Ordem de deploy: aplique ANTES de publicar as edge functions e o frontend.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Participantes
-- -----------------------------------------------------------------------------
create table if not exists public.conversation_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id, clinic_id);

alter table public.conversation_participants replica identity full;
alter table public.conversation_participants enable row level security;

revoke all on public.conversation_participants from anon, authenticated;
grant select on public.conversation_participants to authenticated;

-- A pessoa é participante desta conversa? (security definer: não passa pelo
-- RLS de conversations, evitando recursão nas políticas)
create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_participants p
    where p.conversation_id = p_conversation_id
      and p.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_conversation_participant(uuid) from public, anon;
grant execute on function public.is_conversation_participant(uuid) to authenticated;

-- Vê a lista quem enxerga a conversa
drop policy if exists conversation_participants_select on public.conversation_participants;
create policy conversation_participants_select on public.conversation_participants
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.can_access_conversation_id(conversation_id)
  );

-- Participante enxerga a conversa (soma-se à política por setor/responsável)
drop policy if exists conversations_select_as_participant on public.conversations;
create policy conversations_select_as_participant on public.conversations
  for select to authenticated
  using (public.is_conversation_participant(id));

-- Mensagens, eventos, leituras etc. usam estas duas funções: incluem o
-- participante (corpo igual ao da migration 20261109000000_custom_roles,
-- mais o teste de participante)
create or replace function public.can_access_conversation_id(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_access_conversation(c.clinic_id, c.department_id, c.assigned_user_id)
    from public.conversations c
    where c.id = p_conversation_id
  ), false)
  or public.is_conversation_participant(p_conversation_id);
$$;

revoke execute on function public.can_access_conversation_id(uuid) from public, anon;
grant execute on function public.can_access_conversation_id(uuid) to authenticated;

create or replace function public.user_can_access_conversation(target_conversation_id uuid)
 returns boolean
 language sql
 stable
as $function$
  select exists (
    select 1
    from public.conversations c
    where c.id = target_conversation_id
      and c.clinic_id = public.current_clinic_id()
      and (
        exists (
          select 1
          from public.clinic_users cu
          where cu.user_id = auth.uid()
            and cu.clinic_id = c.clinic_id
            and public.clinic_member_has_permission(cu.role, cu.role_id, 'conversations.all')
        )
        or c.assigned_user_id = auth.uid()
        or public.is_conversation_participant(c.id)
        or (
          c.assigned_user_id is null
          and exists (
            select 1
            from public.department_members dm
            where dm.department_id = c.department_id
              and dm.clinic_user_id = auth.uid()
          )
        )
      )
  );
$function$;

-- Transferiu (outro setor ou outro responsável), voltou para a fila ou foi
-- finalizada (pelo atendente ou pelas automações): a lista é limpa. Fica no
-- banco para valer em todos os caminhos (edge functions, jobs e bot).
create or replace function public.clear_conversation_participants_on_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.status = 'closed' and old.status is distinct from 'closed')
     or new.department_id is distinct from old.department_id
     or new.assigned_user_id is distinct from old.assigned_user_id then
    delete from public.conversation_participants where conversation_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists conversations_clear_participants on public.conversations;
create trigger conversations_clear_participants
  after update of status, department_id, assigned_user_id on public.conversations
  for each row
  execute function public.clear_conversation_participants_on_change();

-- -----------------------------------------------------------------------------
-- 2. Quem enviou a mensagem
-- -----------------------------------------------------------------------------
alter table public.messages
  add column if not exists sender_user_id uuid references auth.users(id) on delete set null,
  add column if not exists sender_name text;

-- -----------------------------------------------------------------------------
-- 3. Nome do atendente nas mensagens (ligado por padrão)
-- -----------------------------------------------------------------------------
alter table public.conversation_automation_settings
  add column if not exists sign_agent_messages boolean not null default true;

-- -----------------------------------------------------------------------------
-- Tempo real: a lista de participantes atualiza sozinha
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_participants'
  ) then
    alter publication supabase_realtime add table public.conversation_participants;
  end if;
end $$;

commit;
