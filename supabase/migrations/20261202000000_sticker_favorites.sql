-- Figurinhas favoritas de cada atendente (como no WhatsApp).
--
-- Os arquivos continuam guardados uma vez por empresa em
-- whatsapp-media/<empresa>/stickers/<hash>.webp (ver _shared/stickerStore.ts):
-- as mensagens apontam para eles, então nada é apagado do Storage. Esta tabela
-- só diz quais aparecem na modal de figurinhas de cada pessoa. Remover da
-- modal apaga a linha, não o arquivo.

create table if not exists public.sticker_favorites (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now(),
  constraint sticker_favorites_path_check
    check (path ~ '^[0-9a-f-]{36}/stickers/[0-9a-f]{64}\.(webp|png)$'),
  constraint sticker_favorites_path_clinic_check
    check (split_part(path, '/', 1) = clinic_id::text),
  constraint sticker_favorites_unique unique (user_id, clinic_id, path)
);

create index if not exists sticker_favorites_user_clinic_idx
  on public.sticker_favorites (user_id, clinic_id, created_at desc);

alter table public.sticker_favorites enable row level security;

revoke all on public.sticker_favorites from anon;
grant select, insert, delete on public.sticker_favorites to authenticated;

drop policy if exists sticker_favorites_select on public.sticker_favorites;
create policy sticker_favorites_select on public.sticker_favorites
  for select to authenticated
  using (user_id = auth.uid() and public.is_clinic_member(clinic_id));

drop policy if exists sticker_favorites_insert on public.sticker_favorites;
create policy sticker_favorites_insert on public.sticker_favorites
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_clinic_member(clinic_id));

drop policy if exists sticker_favorites_delete on public.sticker_favorites;
create policy sticker_favorites_delete on public.sticker_favorites
  for delete to authenticated
  using (user_id = auth.uid());
