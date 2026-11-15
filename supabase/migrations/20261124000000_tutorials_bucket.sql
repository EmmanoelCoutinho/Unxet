-- =============================================================================
-- Bucket público dos vídeos da tela Tutoriais (tutorials)
--
-- Os vídeos saíram do repositório (public/tutorials, ~54 MB) e passaram a
-- ficar no Storage. Só têm dados de demonstração (Empresa Teste), então o
-- bucket é público: o front monta o link /storage/v1/object/public/tutorials/<id>.mp4.
--
-- Sem policy de SELECT em storage.objects: o link público funciona, mas
-- ninguém lista o bucket com a chave pública. Upload só pela service role
-- (scripts/tutorials/upload.mjs).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tutorials', 'tutorials', true, 50 * 1024 * 1024, array['video/mp4'])
on conflict (id) do update
   set public = excluded.public,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;
