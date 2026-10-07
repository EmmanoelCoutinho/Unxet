-- =============================================================================
-- Exclusão lógica de mensagens ("apagar mensagem")
--
-- A mensagem não é removida do banco (auditoria); a edge function
-- delete-message marca deleted_at/deleted_by e, quando o provedor permite
-- (Evolution / WhatsApp via QR Code), apaga também no WhatsApp do cliente.
-- =============================================================================

alter table public.messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists deleted_for_everyone boolean not null default false;
