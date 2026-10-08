-- =============================================================================
-- Bucket de mídia privado (whatsapp-media)
--
-- Antes:
--  - bucket público: qualquer pessoa com o link abria áudios, imagens e
--    documentos dos pacientes;
--  - policy "Public can read": permitia LISTAR o bucket inteiro com a chave
--    pública (expondo ID da clínica e telefone de cada paciente nos caminhos);
--  - policy "Public can upload": qualquer pessoa, sem login, enviava arquivos.
--
-- Depois:
--  - bucket privado; leitura apenas por links assinados emitidos pela edge
--    function media-urls (que respeita o RLS de mensagens/contatos) ou pelas
--    funções de envio (link temporário para Meta/Evolution);
--  - upload só por usuários logados, na pasta da própria clínica
--    (<clinic_id>/...); as edge functions usam a service role.
--
-- APLICAR POR ÚLTIMO: depois de publicar as edge functions (media-urls e
-- funções de envio) e o front que usa links assinados.
-- =============================================================================

begin;

drop policy if exists "Public can read whatsapp-media" on storage.objects;
drop policy if exists "Public can upload to whatsapp-media" on storage.objects;

drop policy if exists "whatsapp_media_insert_own_clinic" on storage.objects;
create policy "whatsapp_media_insert_own_clinic"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = public.current_clinic_id()::text
  );

update storage.buckets
   set public = false,
       -- limite de documentos do WhatsApp
       file_size_limit = 100 * 1024 * 1024
 where id = 'whatsapp-media';

-- media-urls verifica o acesso procurando a URL em messages/contacts
-- (hash: sem limite de tamanho do valor, ao contrário do btree)
create index if not exists messages_media_url_idx
  on public.messages using hash (media_url)
  where media_url is not null;

create index if not exists messages_image_url_idx
  on public.messages using hash (image_url)
  where image_url is not null;

create index if not exists contacts_image_url_idx
  on public.contacts using hash (image_url)
  where image_url is not null;

commit;
