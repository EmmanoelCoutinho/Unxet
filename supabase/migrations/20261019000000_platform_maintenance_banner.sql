-- =============================================================================
-- Painel administrativo da Unxet: aviso de manutenção
--
-- platform_settings guarda as configurações globais da plataforma em uma
-- linha só (id = true). Por enquanto, o aviso de manutenção: quando ligado, o
-- app das empresas mostra uma faixa logo abaixo da barra superior.
--
-- Qualquer pessoa logada lê (a faixa aparece para todas as empresas); só
-- administradores da plataforma (platform_admins) alteram, pela aba
-- "Manutenção" do painel. A tabela entra no Realtime para a faixa aparecer e
-- sumir sem recarregar a página.
--
-- Ordem de deploy: aplique ANTES de publicar o frontend desta entrega.
-- =============================================================================

begin;

create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  maintenance_enabled boolean not null default false,
  maintenance_message text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.platform_settings (id) values (true)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

revoke all on table public.platform_settings from anon, authenticated;
grant select on table public.platform_settings to authenticated;
grant update (maintenance_enabled, maintenance_message)
  on table public.platform_settings to authenticated;

drop policy if exists platform_settings_select on public.platform_settings;
create policy platform_settings_select
  on public.platform_settings
  for select
  to authenticated
  using (true);

drop policy if exists platform_settings_update_admin on public.platform_settings;
create policy platform_settings_update_admin
  on public.platform_settings
  for update
  to authenticated
  using (
    exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
  );

-- Quem e quando: preenchidos pelo banco, não pelo navegador
create or replace function public.platform_settings_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.maintenance_message := nullif(btrim(new.maintenance_message), '');
  return new;
end;
$$;

drop trigger if exists platform_settings_touch on public.platform_settings;
create trigger platform_settings_touch
  before update on public.platform_settings
  for each row execute function public.platform_settings_touch();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'platform_settings'
     ) then
    alter publication supabase_realtime add table public.platform_settings;
  end if;
end;
$$;

commit;
