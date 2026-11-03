-- Anotações da Carteira de clientes.
--
-- A tabela vinha da 20260620000100_create_contacts_wallet, que nunca chegou a
-- rodar no develop nem na produção (a produção veio de um dump sem ela). O app
-- já usa contact_notes, então as anotações davam erro. Tudo aqui é idempotente.

create table if not exists public.contact_notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  note text not null check (length(btrim(note)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists contact_notes_contact_created_idx
  on public.contact_notes (contact_id, created_at desc);

alter table public.contact_notes enable row level security;

revoke all on table public.contact_notes from anon, authenticated;
grant select, insert, delete on table public.contact_notes to authenticated;

drop policy if exists "Clinic members can read contact notes" on public.contact_notes;
create policy "Clinic members can read contact notes"
  on public.contact_notes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.contacts c
      join public.clinic_users cu on cu.clinic_id = c.clinic_id
      where c.id = contact_notes.contact_id
        and cu.user_id = auth.uid()
    )
  );

drop policy if exists "Clinic members can insert contact notes" on public.contact_notes;
create policy "Clinic members can insert contact notes"
  on public.contact_notes
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.contacts c
      join public.clinic_users cu on cu.clinic_id = c.clinic_id
      where c.id = contact_notes.contact_id
        and cu.user_id = auth.uid()
    )
  );

drop policy if exists "Clinic members can delete contact notes" on public.contact_notes;
create policy "Clinic members can delete contact notes"
  on public.contact_notes
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.contacts c
      join public.clinic_users cu on cu.clinic_id = c.clinic_id
      where c.id = contact_notes.contact_id
        and cu.user_id = auth.uid()
    )
  );
