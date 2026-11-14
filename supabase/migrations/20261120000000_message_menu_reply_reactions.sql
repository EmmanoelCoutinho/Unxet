-- =============================================================================
-- Menu da mensagem (setinha do balão): Responder, Reagir e Apagar
--
-- 1. Responder citando: a mensagem guarda qual mensagem respondeu
--    (reply_to_message_id) e um resumo dela (reply_preview), para mostrar a
--    citação mesmo quando a original não está carregada na tela.
-- 2. Reações: uma do cliente e uma da empresa por mensagem, como no WhatsApp.
-- 3. Permissão nova messages.delete: apagar mensagens enviadas. Administrador
--    sempre tem; Atendente sem cargo não tem (antes podia apagar as próprias).
--
-- Ordem de deploy: aplique ANTES das edge functions e do frontend.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Catálogo de permissões (igual a src/modules/roles/permissions.ts)
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
    'contacts.block',
    'messages.delete',
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
-- 2. Resposta citada
-- -----------------------------------------------------------------------------
alter table public.messages
  add column if not exists reply_to_message_id uuid
    references public.messages(id) on delete set null,
  -- { "author": "cliente" | "atendente", "type": "...", "text": "..." }
  add column if not exists reply_preview jsonb;

create index if not exists messages_reply_to_idx
  on public.messages (reply_to_message_id)
  where reply_to_message_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Reações (um emoji por lado; null = sem reação)
-- -----------------------------------------------------------------------------
alter table public.messages
  add column if not exists client_reaction text,
  add column if not exists agent_reaction text,
  add column if not exists agent_reaction_by uuid references auth.users(id) on delete set null;

alter table public.messages
  drop constraint if exists messages_client_reaction_length,
  add constraint messages_client_reaction_length
    check (client_reaction is null or char_length(client_reaction) <= 32),
  drop constraint if exists messages_agent_reaction_length,
  add constraint messages_agent_reaction_length
    check (agent_reaction is null or char_length(agent_reaction) <= 32);

commit;
