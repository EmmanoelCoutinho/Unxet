-- =============================================================================
-- Notificações do sistema (sino do topo)
--
-- Cada pessoa tem a própria lista de avisos. O sistema grava (service role:
-- bot-engine, jobs); a pessoa só lê e marca como lido. Cada aviso pode ter um
-- endereço: clicar no sino leva para a tela certa (ex.: limite da IA ->
-- /inbox/ai-assistant).
--
-- "Sistema atualizado" não passa por aqui: vem da lista de versões do próprio
-- app (src/modules/changelog/releases.ts).
--
-- Ordem de deploy: aplique ANTES de publicar o bot-engine e o frontend.
-- =============================================================================

begin;

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 60),
  title text not null check (char_length(title) between 1 and 200),
  body text check (body is null or char_length(body) <= 1000),
  -- Caminho dentro do app (sempre começa com "/")
  url text check (url is null or url ~ '^/[^/]'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists user_notifications_user_idx
  on public.user_notifications (user_id, created_at desc);

alter table public.user_notifications enable row level security;

revoke all on public.user_notifications from anon, authenticated;
grant select on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;
grant delete on public.user_notifications to authenticated;

drop policy if exists user_notifications_select on public.user_notifications;
create policy user_notifications_select on public.user_notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_notifications_update on public.user_notifications;
create policy user_notifications_update on public.user_notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_notifications_delete on public.user_notifications;
create policy user_notifications_delete on public.user_notifications
  for delete to authenticated
  using (user_id = auth.uid());

-- Avisa todo mundo da empresa que tem a permissão (admin sempre). Devolve
-- quem recebeu, para o mesmo aviso sair por push.
create or replace function public.notify_clinic_permission(
  p_clinic_id uuid,
  p_permission text,
  p_kind text,
  p_title text,
  p_body text,
  p_url text
)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  insert into public.user_notifications (user_id, clinic_id, kind, title, body, url)
  select u.user_id, p_clinic_id, p_kind, p_title, p_body, p_url
  from public.clinic_users_with_permission(p_clinic_id, p_permission) as u(user_id)
  returning user_id;
$$;

revoke execute on function public.notify_clinic_permission(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.notify_clinic_permission(uuid, text, text, text, text, text)
  to service_role;

-- Sino em tempo real
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_notifications'
  ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end;
$$;

commit;
