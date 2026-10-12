-- =============================================================================
-- Painel administrativo da Unxet: administradores da plataforma e onboarding
--
-- 1. platform_admins: quem da Unxet pode entrar no painel (/admin). Não tem
--    relação com clinic_users: um administrador da plataforma não pertence a
--    nenhuma empresa e não enxerga dados de clientes pelo app.
--    Não existe tela para cadastrar o primeiro: crie o usuário em
--    Authentication → Users e rode
--      insert into public.platform_admins (user_id, name)
--      select id, 'Nome' from auth.users where email = 'pessoa@unxet.com.br';
--
-- 2. platform_onboard_clinic: cria a empresa, o departamento padrão
--    "Recepção" e vincula o primeiro usuário (admin da empresa, já na
--    Recepção) em uma transação só. Chamada apenas pela edge function
--    admin-onboard-clinic, depois de criar a conta no Auth.
--
-- Ordem de deploy: aplique ANTES de publicar a edge function
-- admin-onboard-clinic e o frontend desta entrega.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Administradores da plataforma
-- -----------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- Cada um só confirma o próprio acesso; a lista é gerida direto no banco
revoke all on table public.platform_admins from anon, authenticated;
grant select on table public.platform_admins to authenticated;

drop policy if exists platform_admins_select_own on public.platform_admins;
create policy platform_admins_select_own
  on public.platform_admins
  for select
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 2. Onboarding de uma empresa
-- -----------------------------------------------------------------------------
create or replace function public.platform_onboard_clinic(
  p_clinic_name text,
  p_user_id uuid,
  p_user_name text,
  p_user_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_department_id uuid;
begin
  if coalesce(btrim(p_clinic_name), '') = '' then
    raise exception 'Informe o nome da empresa';
  end if;

  insert into public.clinics (name)
  values (btrim(p_clinic_name))
  returning id into v_clinic_id;

  -- O webhook só aceita mensagens se houver um departamento padrão ATIVO
  insert into public.departments (clinic_id, name, slug, is_default, is_active)
  values (v_clinic_id, 'Recepção', 'recepcao', true, true)
  returning id into v_department_id;

  insert into public.clinic_users (
    clinic_id, user_id, role, name, department_id, email, invited_at
  )
  values (
    v_clinic_id,
    p_user_id,
    'admin',
    nullif(btrim(p_user_name), ''),
    v_department_id,
    lower(btrim(p_user_email)),
    now()
  );

  insert into public.department_members (department_id, clinic_user_id)
  values (v_department_id, p_user_id);

  return jsonb_build_object(
    'clinic_id', v_clinic_id,
    'department_id', v_department_id
  );
end;
$$;

revoke execute on function public.platform_onboard_clinic(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.platform_onboard_clinic(text, uuid, text, text)
  to service_role;

commit;
