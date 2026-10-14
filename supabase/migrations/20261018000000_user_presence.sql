-- =============================================================================
-- Painel administrativo da Unxet: quem está online agora
--
-- 1. user_presence: último sinal de vida de cada usuário do app das empresas.
--    O app chama touch_presence() ao abrir e a cada minuto enquanto estiver
--    aberto. Ninguém lê ou escreve a tabela direto: só pelas funções abaixo.
--
-- 2. platform_online_users: para o painel (/admin), conta quem deu sinal nos
--    últimos N segundos, no total e por empresa, e lista as pessoas.
--    Só administradores da plataforma (platform_admins) podem chamar.
--
-- Ordem de deploy: aplique ANTES de publicar o frontend desta entrega.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Sinal de vida
-- -----------------------------------------------------------------------------
create table if not exists public.user_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create index if not exists user_presence_last_seen_idx
  on public.user_presence (last_seen_at desc);

alter table public.user_presence enable row level security;
revoke all on table public.user_presence from anon, authenticated;

create or replace function public.touch_presence()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.user_presence (user_id, last_seen_at)
  select auth.uid(), now()
  where auth.uid() is not null
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;
$$;

revoke execute on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Online agora (painel da plataforma)
-- -----------------------------------------------------------------------------
create or replace function public.platform_online_users(
  p_window_seconds integer default 120
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz :=
    now() - make_interval(secs => least(greatest(coalesce(p_window_seconds, 120), 30), 3600));
  v_result jsonb;
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.platform_admins pa where pa.user_id = auth.uid()
     ) then
    raise exception 'Não autorizado' using errcode = '42501';
  end if;

  with
  -- Só quem pertence a alguma empresa (admins da plataforma não contam)
  online as materialized (
    select
      up.user_id,
      up.last_seen_at,
      cu.clinic_id,
      cu.name,
      cu.role,
      cl.name as clinic_name
    from public.user_presence up
    join public.clinic_users cu on cu.user_id = up.user_id
    join public.clinics cl on cl.id = cu.clinic_id
    where up.last_seen_at >= v_since
  ),
  per_clinic as (
    select clinic_id, clinic_name, count(distinct user_id) as online
    from online
    group by clinic_id, clinic_name
  )
  select jsonb_build_object(
    'generated_at', now(),
    'since', v_since,
    'total', (select count(distinct user_id) from online),
    'admins', (select count(distinct user_id) from online where role = 'admin'),
    'agents', (select count(distinct user_id) from online where role = 'agent'),
    'clinics', (select count(*) from per_clinic),
    'per_clinic', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id', clinic_id, 'name', clinic_name, 'online', online
              ) order by online desc, clinic_name) from per_clinic),
      '[]'::jsonb
    ),
    'users', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'user_id', user_id,
                'name', name,
                'role', role,
                'clinic_id', clinic_id,
                'clinic_name', clinic_name,
                'last_seen_at', last_seen_at
              ) order by clinic_name, name) from online),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.platform_online_users(integer) from public, anon;
grant execute on function public.platform_online_users(integer) to authenticated;

commit;
