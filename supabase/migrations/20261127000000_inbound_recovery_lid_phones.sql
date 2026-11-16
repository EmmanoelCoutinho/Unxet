-- =============================================================================
-- Recuperação de mensagens: telefone dos contatos que vieram só com o @lid
--
-- Mensagens do histórico do pareamento podem chegar sem o telefone, só com o
-- @lid, e sem telefone não há como importar. Quem já escreveu para o número
-- antes tem o @lid gravado no payload das mensagens recebidas
-- (data.key.remoteJid) e a conversa liga ao contato com o telefone.
-- Usado pelo evolution-connection-sync (_shared/inboundRecovery.ts).
-- =============================================================================

create or replace function public.inbound_recovery_lid_phones(
  p_connection_id uuid,
  p_lids text[]
)
returns table (lid text, phone text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (m.payload->'data'->'key'->>'remoteJid')
         m.payload->'data'->'key'->>'remoteJid' as lid,
         ct.phone
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  join public.messages m on m.conversation_id = c.id
  where c.channel_connection_id = p_connection_id
    and m.direction = 'inbound'
    and m.payload->'data'->'key'->>'remoteJid' = any (p_lids)
    and ct.phone ~ '^\d{10,15}$'
  order by m.payload->'data'->'key'->>'remoteJid', m.created_at desc;
$$;

revoke execute on function public.inbound_recovery_lid_phones(uuid, text[]) from public, anon, authenticated;
grant execute on function public.inbound_recovery_lid_phones(uuid, text[]) to service_role;
