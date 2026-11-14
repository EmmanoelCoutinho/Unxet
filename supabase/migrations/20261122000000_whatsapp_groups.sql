-- Grupos do WhatsApp (QR Code / Evolution), v1.
--
-- O grupo não é um contato: ele tem tabela própria e a conversa aponta para
-- ele (group_id) com contact_id nulo. Quem escreve no grupo continua sendo um
-- contato comum, ligado ao grupo pela tabela contact_groups. O vínculo só é
-- criado quando a pessoa manda mensagem e o número dela é conhecido (em
-- grupos o WhatsApp costuma esconder o telefone atrás de um LID).
--
-- Cada número de QR Code escolhe se recebe grupos (desligado por padrão).
-- Gravação de grupos e vínculos só pelas edge functions (service role).

-- -----------------------------------------------------------------------------
-- 1. Opção por número
-- -----------------------------------------------------------------------------
alter table public.channel_connections
  add column if not exists groups_enabled boolean not null default false;

grant select (groups_enabled) on public.channel_connections to authenticated;
grant update (groups_enabled) on public.channel_connections to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Grupos
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  channel_connection_id uuid not null references public.channel_connections (id) on delete cascade,
  jid text not null,
  name text,
  image_url text,
  info_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_groups_jid_check check (jid like '%@g.us'),
  constraint whatsapp_groups_connection_jid_key unique (channel_connection_id, jid)
);

create index if not exists whatsapp_groups_clinic_idx
  on public.whatsapp_groups (clinic_id);

alter table public.whatsapp_groups enable row level security;
revoke all on public.whatsapp_groups from anon, authenticated;
grant select on public.whatsapp_groups to authenticated;

drop policy if exists whatsapp_groups_select on public.whatsapp_groups;
create policy whatsapp_groups_select on public.whatsapp_groups
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

-- -----------------------------------------------------------------------------
-- 3. Quem participa de cada grupo (só quem já escreveu nele)
-- -----------------------------------------------------------------------------
create table if not exists public.contact_groups (
  contact_id uuid not null references public.contacts (id) on delete cascade,
  group_id uuid not null references public.whatsapp_groups (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (contact_id, group_id)
);

create index if not exists contact_groups_group_idx
  on public.contact_groups (group_id);

alter table public.contact_groups enable row level security;
revoke all on public.contact_groups from anon, authenticated;
grant select on public.contact_groups to authenticated;

drop policy if exists contact_groups_select on public.contact_groups;
create policy contact_groups_select on public.contact_groups
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

-- -----------------------------------------------------------------------------
-- 4. Conversa de grupo
-- -----------------------------------------------------------------------------
alter table public.conversations
  add column if not exists group_id uuid references public.whatsapp_groups (id) on delete set null;

create index if not exists conversations_group_idx
  on public.conversations (group_id)
  where group_id is not null;

-- Uma conversa ativa por grupo (o índice por contato não cobre contact_id nulo)
create unique index if not exists conversations_one_active_per_group
  on public.conversations (clinic_id, group_id, channel_connection_id)
  where status in ('open', 'pending')
    and group_id is not null;

-- -----------------------------------------------------------------------------
-- 5. Quem do grupo mandou a mensagem
-- -----------------------------------------------------------------------------
alter table public.messages
  add column if not exists sender_contact_id uuid references public.contacts (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Tempo real: nome e foto do grupo atualizam na tela
-- -----------------------------------------------------------------------------
alter table public.whatsapp_groups replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'whatsapp_groups'
    ) then
    alter publication supabase_realtime add table public.whatsapp_groups;
  end if;
end $$;
