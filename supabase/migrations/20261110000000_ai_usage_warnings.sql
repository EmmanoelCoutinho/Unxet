-- =============================================================================
-- Assistente com IA: avisos de limite do mês
--
-- Quando a empresa chega a 80% das respostas da IA do mês e quando elas
-- acabam, o bot-engine manda uma notificação para quem cuida da IA
-- (administradores e cargos com a permissão ai.manage). Cada aviso sai uma
-- vez por mês: as marcas abaixo guardam que ele já foi enviado.
--
-- Se a Unxet aumentar o limite no meio do mês, as marcas que deixaram de
-- valer são limpas, e o aviso pode sair de novo quando o novo limite chegar.
--
-- Ordem de deploy: aplique ANTES de publicar o bot-engine.
-- =============================================================================

begin;

alter table public.clinic_ai_usage
  add column if not exists warned_80_at timestamptz,
  add column if not exists exhausted_at timestamptz;

-- Fração do limite que gera o primeiro aviso (mesma do frontend)
create or replace function public.clinic_ai_warning_threshold(p_limit integer)
returns integer
language sql
immutable
as $$
  select greatest(1, ceil(p_limit * 0.8))::integer;
$$;

-- Depois de gastar uma resposta: diz qual aviso enviar agora, se algum.
-- 'exhausted' (acabou), 'warn_80' (chegou a 80%) ou null. Marca o aviso
-- como enviado na mesma hora, então duas execuções juntas não avisam em dobro.
create or replace function public.clinic_ai_usage_warning(p_clinic_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_month date := public.clinic_ai_month();
  v_threshold integer;
  v_hit boolean;
begin
  select s.ai_replies_addon into v_limit
  from public.clinic_subscriptions s
  where s.clinic_id = p_clinic_id;

  if v_limit is null then
    return null;
  end if;
  v_threshold := public.clinic_ai_warning_threshold(v_limit);

  -- Limite aumentado: marcas antigas deixam de valer
  update public.clinic_ai_usage u
     set exhausted_at = case when u.replies < v_limit then null else u.exhausted_at end,
         warned_80_at = case when u.replies < v_threshold then null else u.warned_80_at end
   where u.clinic_id = p_clinic_id
     and u.month = v_month
     and ((u.exhausted_at is not null and u.replies < v_limit)
       or (u.warned_80_at is not null and u.replies < v_threshold));

  update public.clinic_ai_usage u
     set exhausted_at = now(),
         -- Esgotou de uma vez: o aviso de 80% não sai depois
         warned_80_at = coalesce(u.warned_80_at, now())
   where u.clinic_id = p_clinic_id
     and u.month = v_month
     and u.replies >= v_limit
     and u.exhausted_at is null
  returning true into v_hit;
  if v_hit then
    return 'exhausted';
  end if;

  update public.clinic_ai_usage u
     set warned_80_at = now()
   where u.clinic_id = p_clinic_id
     and u.month = v_month
     and u.replies >= v_threshold
     and u.warned_80_at is null
  returning true into v_hit;
  if v_hit then
    return 'warn_80';
  end if;

  return null;
end;
$$;

-- Quem recebe o aviso: administradores e cargos com a permissão
create or replace function public.clinic_users_with_permission(
  p_clinic_id uuid,
  p_permission text
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select cu.user_id
  from public.clinic_users cu
  where cu.clinic_id = p_clinic_id
    and public.clinic_member_has_permission(cu.role, cu.role_id, p_permission);
$$;

revoke execute on function public.clinic_ai_usage_warning(uuid) from public, anon, authenticated;
revoke execute on function public.clinic_users_with_permission(uuid, text) from public, anon, authenticated;
grant execute on function public.clinic_ai_usage_warning(uuid) to service_role;
grant execute on function public.clinic_users_with_permission(uuid, text) to service_role;
grant execute on function public.clinic_ai_warning_threshold(integer) to authenticated, service_role;

commit;
