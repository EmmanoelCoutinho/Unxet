-- =============================================================================
-- Chat interno: arquivos, imagens, áudios e figurinhas
--
-- Os arquivos ficam no bucket privado whatsapp-media, na pasta da conversa:
--   <clinic_id>/internal-chat/<thread_id>/<arquivo>
-- e as figurinhas reaproveitam as da empresa (<clinic_id>/stickers/<hash>).
-- O upload já é liberado pela policy whatsapp_media_insert_own_clinic (pasta
-- da própria empresa). A leitura é por link assinado da edge function
-- media-urls, que passa a liberar o arquivo de uma mensagem interna que o
-- usuário pode ver (RLS de internal_chat_messages).
--
-- O caminho é conferido aqui: sem isso, alguém poderia gravar numa mensagem
-- interna o caminho de um arquivo de cliente de outro departamento e receber
-- o link pela media-urls.
--
-- A mensagem passa a poder ter só o anexo (texto vazio).
--
-- Ordem de deploy: aplique esta migration, publique a edge function
-- media-urls e depois o frontend.
-- =============================================================================

begin;

alter table public.internal_chat_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_kind text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size bigint;

alter table public.internal_chat_messages
  drop constraint if exists internal_chat_messages_body_check;

alter table public.internal_chat_messages
  drop constraint if exists internal_chat_messages_content_check;
alter table public.internal_chat_messages
  add constraint internal_chat_messages_content_check check (
    char_length(body) <= 4000
    and (char_length(body) >= 1 or attachment_path is not null)
  );

alter table public.internal_chat_messages
  drop constraint if exists internal_chat_messages_attachment_check;
alter table public.internal_chat_messages
  add constraint internal_chat_messages_attachment_check check (
    (attachment_path is null and attachment_kind is null)
    or (
      attachment_path is not null
      and attachment_kind in ('image', 'audio', 'file', 'sticker')
      and char_length(attachment_path) <= 512
      and (attachment_name is null or char_length(attachment_name) <= 255)
      and (attachment_mime is null or char_length(attachment_mime) <= 255)
      and (attachment_size is null or attachment_size >= 0)
    )
  );

-- media-urls procura o caminho pedido entre as mensagens visíveis
create index if not exists internal_chat_messages_attachment_path_idx
  on public.internal_chat_messages using hash (attachment_path)
  where attachment_path is not null;

-- -----------------------------------------------------------------------------
-- Clínica, horário, texto e caminho do anexo conferidos no servidor
-- -----------------------------------------------------------------------------
create or replace function public.internal_chat_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_file text;
begin
  select t.clinic_id into v_clinic_id
  from public.internal_chat_threads t
  where t.id = new.thread_id;

  if v_clinic_id is null then
    raise exception 'thread not found';
  end if;

  new.clinic_id := v_clinic_id;
  new.created_at := clock_timestamp();
  new.push_notified_at := null;
  new.body := btrim(coalesce(new.body, ''));

  if new.attachment_path is not null then
    -- Só o nome do arquivo, sem subpastas nem caminhos relativos
    v_file := '[A-Za-z0-9][A-Za-z0-9._-]*';
    if new.attachment_kind = 'sticker' then
      if new.attachment_path !~ ('^' || v_clinic_id::text || '/stickers/' || v_file || '$') then
        raise exception 'invalid attachment path';
      end if;
    elsif new.attachment_path !~ (
      '^' || v_clinic_id::text || '/internal-chat/' || new.thread_id::text || '/' || v_file || '$'
    ) then
      raise exception 'invalid attachment path';
    end if;
    new.attachment_name := nullif(btrim(coalesce(new.attachment_name, '')), '');
  else
    new.attachment_kind := null;
    new.attachment_name := null;
    new.attachment_mime := null;
    new.attachment_size := null;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Prévia da última mensagem: anexo sem texto aparece pelo tipo
-- -----------------------------------------------------------------------------
create or replace function public.internal_chat_list_threads()
returns table (
  thread_id uuid,
  kind text,
  other_user_id uuid,
  last_message_at timestamptz,
  last_message_body text,
  last_message_sender_id uuid,
  unread_count integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
  v_clinic_id uuid := public.current_clinic_id();
begin
  if v_me is null or v_clinic_id is null then
    return;
  end if;

  insert into public.internal_chat_threads (clinic_id, kind)
  values (v_clinic_id, 'general')
  on conflict (clinic_id) where kind = 'general' do nothing;

  return query
  select
    t.id,
    t.kind,
    case
      when t.kind = 'direct' and t.user_a = v_me then t.user_b
      when t.kind = 'direct' then t.user_a
    end,
    t.last_message_at,
    left(
      coalesce(
        nullif(lm.body, ''),
        case lm.attachment_kind
          when 'image' then '📷 Imagem'
          when 'audio' then '🎤 Áudio'
          when 'sticker' then '🖼️ Figurinha'
          when 'file' then '📎 ' || coalesce(lm.attachment_name, 'Arquivo')
        end
      ),
      140
    ),
    lm.sender_id,
    (
      select count(*)::int
      from public.internal_chat_messages m
      where m.thread_id = t.id
        and m.sender_id is distinct from v_me
        and m.created_at > coalesce(r.last_read_at, 'epoch'::timestamptz)
    )
  from public.internal_chat_threads t
  left join public.internal_chat_reads r
    on r.thread_id = t.id
   and r.user_id = v_me
  left join lateral (
    select m.body, m.sender_id, m.attachment_kind, m.attachment_name
    from public.internal_chat_messages m
    where m.thread_id = t.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  where t.clinic_id = v_clinic_id
    and (t.kind = 'general' or v_me in (t.user_a, t.user_b));
end;
$$;

revoke execute on function public.internal_chat_list_threads() from public, anon;
grant execute on function public.internal_chat_list_threads() to authenticated;

commit;
