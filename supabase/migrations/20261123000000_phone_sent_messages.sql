-- Mensagens enviadas pelo celular (WhatsApp via QR Code / Evolution).
--
-- Quem responde direto no celular da empresa (ou no WhatsApp Web) não aparecia
-- no Unxet: a conversa ficava com buracos. Com a opção ligada, o evolution-in
-- grava essas mensagens na conversa do cliente como enviadas ("Pelo celular").
--
-- Cada número de QR Code escolhe (desligado por padrão).

alter table public.channel_connections
  add column if not exists phone_messages_enabled boolean not null default false;

grant select (phone_messages_enabled) on public.channel_connections to authenticated;
grant update (phone_messages_enabled) on public.channel_connections to authenticated;
