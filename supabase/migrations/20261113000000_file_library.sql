-- =============================================================================
-- Banco de arquivos
--
-- 1. Biblioteca da empresa (file_library): arquivos que a empresa sobe pela
--    tela Banco de arquivos ou salva a partir de uma conversa. Todos da empresa
--    veem e enviam; adicionar, editar e apagar exige a permissão nova
--    file_library.manage (administrador sempre tem).
--    O arquivo fica no bucket whatsapp-media, na pasta da empresa
--    (<empresa>/library/...). Apagar da biblioteca não apaga o arquivo do
--    Storage: ele pode já ter sido enviado em conversas.
--
-- 2. Arquivos das conversas (list_conversation_files): tudo o que foi enviado
--    e recebido. Roda com o acesso de quem chama (RLS de mensagens), então cada
--    pessoa só vê arquivos das conversas que já consegue abrir.
--
-- Ordem de deploy: aplique ANTES das edge functions (media-urls) e do front.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Permissão nova no catálogo (mesma lista de src/modules/roles/permissions.ts)
-- -----------------------------------------------------------------------------
create or replace function public.clinic_permission_catalog()
returns text[]
language sql
immutable
as $$
  select array[
    'conversations.all',
    'dashboard.view',
    'quick_messages.manage',
    'tags.manage',
    'file_library.manage',
    'contacts.view',
    'leads.all',
    'campaigns.all',
    'meta_templates.create',
    'bots.manage',
    'ai.manage',
    'reports.view'
  ]::text[];
$$;

-- -----------------------------------------------------------------------------
-- 2. Biblioteca
-- -----------------------------------------------------------------------------
create table if not exists public.file_library (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  description text,
  folder text,
  -- Caminho no bucket whatsapp-media e a URL no formato público (a mesma
  -- referência que messages.media_url guarda)
  storage_path text not null,
  url text not null,
  mime_type text,
  kind text not null,
  file_size bigint,
  source_message_id uuid references public.messages(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint file_library_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint file_library_description_length check (description is null or char_length(description) <= 500),
  constraint file_library_folder_length check (folder is null or char_length(btrim(folder)) between 1 and 60),
  constraint file_library_kind_valid check (kind in ('image', 'audio', 'video', 'document')),
  -- Só arquivos da própria empresa
  constraint file_library_path_in_clinic check (storage_path like clinic_id::text || '/%')
);

create unique index if not exists file_library_clinic_url_uk
  on public.file_library (clinic_id, url);

create index if not exists file_library_clinic_created_idx
  on public.file_library (clinic_id, created_at desc);

-- media-urls procura a URL para liberar o link assinado
create index if not exists file_library_url_idx
  on public.file_library using hash (url);

alter table public.file_library enable row level security;

revoke all on public.file_library from anon, authenticated;
grant select, insert, update, delete on public.file_library to authenticated;

drop policy if exists file_library_select on public.file_library;
create policy file_library_select on public.file_library
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists file_library_insert on public.file_library;
create policy file_library_insert on public.file_library
  for insert to authenticated
  with check (public.has_clinic_permission(clinic_id, 'file_library.manage'));

drop policy if exists file_library_update on public.file_library;
create policy file_library_update on public.file_library
  for update to authenticated
  using (public.has_clinic_permission(clinic_id, 'file_library.manage'))
  with check (public.has_clinic_permission(clinic_id, 'file_library.manage'));

drop policy if exists file_library_delete on public.file_library;
create policy file_library_delete on public.file_library
  for delete to authenticated
  using (public.has_clinic_permission(clinic_id, 'file_library.manage'));

create or replace function public.file_library_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.folder := nullif(btrim(coalesce(new.folder, '')), '');
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := now();
  else
    -- Arquivo, empresa e origem não mudam depois de salvos
    if new.clinic_id is distinct from old.clinic_id
       or new.storage_path is distinct from old.storage_path
       or new.url is distinct from old.url then
      raise exception 'O arquivo não pode ser trocado; adicione um novo.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source_message_id := old.source_message_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_file_library_before_write on public.file_library;
create trigger trg_file_library_before_write
  before insert or update on public.file_library
  for each row execute function public.file_library_before_write();

-- -----------------------------------------------------------------------------
-- 3. Arquivos das conversas
-- -----------------------------------------------------------------------------
create index if not exists messages_files_created_idx
  on public.messages (created_at desc, id desc)
  where deleted_at is null
    and type in ('image', 'audio', 'video', 'document')
    and coalesce(media_url, image_url) is not null;

create or replace function public.list_conversation_files(
  p_kind text default null,
  p_direction text default null,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  conversation_id uuid,
  contact_id uuid,
  contact_name text,
  contact_phone text,
  direction text,
  kind text,
  url text,
  mime_type text,
  filename text,
  file_size integer,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.id,
    m.conversation_id,
    ct.id,
    ct.name,
    ct.phone,
    m.direction::text,
    m.type::text,
    coalesce(m.media_url, m.image_url),
    m.media_mime_type,
    m.filename,
    m.file_size,
    m.created_at
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  left join public.contacts ct on ct.id = c.contact_id
  where c.clinic_id = public.current_clinic_id()
    and m.deleted_at is null
    and m.type in ('image', 'audio', 'video', 'document')
    and coalesce(m.media_url, m.image_url) is not null
    and (p_kind is null or m.type::text = p_kind)
    and (p_direction is null or m.direction::text = p_direction)
    and (p_from is null or m.created_at >= p_from)
    and (p_to is null or m.created_at < p_to)
    and (
      p_search is null or btrim(p_search) = ''
      or m.filename ilike '%' || btrim(p_search) || '%'
      or ct.name ilike '%' || btrim(p_search) || '%'
      or ct.phone ilike '%' || btrim(p_search) || '%'
    )
    and (
      p_before_created_at is null
      or (m.created_at, m.id) < (p_before_created_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    )
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke execute on function public.list_conversation_files(text, text, text, timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_conversation_files(text, text, text, timestamptz, timestamptz, timestamptz, uuid, integer) to authenticated;

commit;
