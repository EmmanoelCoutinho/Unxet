-- =============================================================================
-- Etiquetas por clínica e escrita de conversas somente pelas edge functions
--
-- Problemas corrigidos:
--  1. tags.name era único entre TODAS as clínicas: a clínica B não conseguia
--     criar "Urgente" se a clínica A já tivesse uma etiqueta com esse nome.
--  2. As policies "tags_select_authenticated" / "tags_insert_authenticated"
--     liberavam leitura e criação de etiquetas para qualquer usuário logado,
--     de qualquer clínica (inclusive criar etiqueta dentro de outra clínica).
--  3. Qualquer atendente alterava conversas direto pela API REST: fechava sem
--     evento nem pesquisa, se atribuía sem registro e movia a conversa para um
--     setor de outra clínica. O app só altera conversas pelas edge functions
--     (accept / transfer / close-conversation), que usam service role.
--  4. O atendente trocava o próprio clinic_users.department_id e passava a
--     enxergar a fila de outro setor.
--  5. mark_conversation_read aceitava qualquer p_user_id e qualquer conversa.
--
-- Ordem de deploy: pode ser aplicada antes ou depois do frontend e das edge
-- functions desta entrega.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Etiquetas: nome único por clínica
-- -----------------------------------------------------------------------------
alter table public.tags drop constraint if exists tags_name_key;

-- O nome já era único globalmente, então não há duplicatas por clínica.
create unique index if not exists tags_clinic_name_uk
  on public.tags (clinic_id, name);

-- NOT VALID: vale para etiquetas novas/alteradas sem barrar registros antigos
alter table public.tags drop constraint if exists tags_name_length_check;
alter table public.tags
  add constraint tags_name_length_check
  check (length(btrim(name)) between 1 and 60) not valid;

alter table public.tags drop constraint if exists tags_color_format_check;
alter table public.tags
  add constraint tags_color_format_check
  check (color is null or color ~ '^#[0-9A-Fa-f]{6}$') not valid;

-- -----------------------------------------------------------------------------
-- 2. Etiquetas: leitura e criação só para membros da clínica
-- -----------------------------------------------------------------------------
-- Continuam valendo "tags_select_clinic_members" e "tags_insert_clinic_members".
drop policy if exists "tags_select_authenticated" on public.tags;
drop policy if exists "tags_insert_authenticated" on public.tags;

-- -----------------------------------------------------------------------------
-- 3. Conversas: sem UPDATE direto pelo cliente
-- -----------------------------------------------------------------------------
drop policy if exists "conversations_update_assign_or_own" on public.conversations;

-- -----------------------------------------------------------------------------
-- 4. clinic_users: o próprio usuário não troca de setor
-- -----------------------------------------------------------------------------
create or replace function public.prevent_clinic_user_privilege_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  -- service role / jobs internos não têm auth.uid()
  if auth.uid() is null then
    return new;
  end if;

  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'clinic_id não pode ser alterado';
  end if;

  if new.role is distinct from old.role
     or new.department_id is distinct from old.department_id then
    select exists (
      select 1
      from public.clinic_users cu
      where cu.user_id = auth.uid()
        and cu.clinic_id = old.clinic_id
        and cu.role = 'admin'
    ) into v_is_admin;

    if not v_is_admin then
      if new.role is distinct from old.role then
        raise exception 'Apenas administradores podem alterar o papel';
      end if;
      raise exception 'Apenas administradores podem alterar o setor';
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. mark_conversation_read: só para si mesmo e em conversa que pode acessar
-- -----------------------------------------------------------------------------
create or replace function public.mark_conversation_read(
  p_conversation_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception 'Não autorizado';
  end if;

  if not public.can_access_conversation_id(p_conversation_id) then
    return;
  end if;

  select clinic_id into v_clinic_id
  from public.conversations
  where id = p_conversation_id;

  insert into public.conversation_reads (conversation_id, user_id, clinic_id, last_read_at, updated_at)
  values (p_conversation_id, p_user_id, v_clinic_id, now(), now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = excluded.last_read_at,
                updated_at = now();
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  select public.mark_conversation_read(p_conversation_id, auth.uid());
$$;

revoke execute on function public.mark_conversation_read(uuid, uuid) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid, uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

commit;
