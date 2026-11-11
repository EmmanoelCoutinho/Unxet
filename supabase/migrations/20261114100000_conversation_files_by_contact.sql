-- =============================================================================
-- Arquivos de um cliente, dentro da conversa
--
-- list_conversation_files ganha p_contact_id: a conversa abre um painel com
-- todos os arquivos trocados com aquele cliente (em qualquer conversa dele que
-- a pessoa consiga abrir; a função continua com o acesso de quem chama).
--
-- O parâmetro novo tem valor padrão: a tela Banco de arquivos e o + da
-- conversa continuam chamando como antes.
-- =============================================================================

begin;

drop function if exists public.list_conversation_files(text, text, text, timestamptz, timestamptz, timestamptz, uuid, integer);

create or replace function public.list_conversation_files(
  p_kind text default null,
  p_direction text default null,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50,
  p_contact_id uuid default null
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
    and (p_contact_id is null or c.contact_id = p_contact_id)
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

revoke execute on function public.list_conversation_files(text, text, text, timestamptz, timestamptz, timestamptz, uuid, integer, uuid) from public, anon;
grant execute on function public.list_conversation_files(text, text, text, timestamptz, timestamptz, timestamptz, uuid, integer, uuid) to authenticated;

commit;
