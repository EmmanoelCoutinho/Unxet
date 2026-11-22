-- Votos das enquetes do WhatsApp (QR Code).
--
-- A enquete já chegava como texto. Agora a conversa mostra a enquete com as
-- opções e quantos votaram em cada uma. O evolution-in decifra cada voto
-- (pollUpdateMessage) e grava aqui, por JID de quem votou:
--   { "<jid>": { "options": ["Sim"], "at": "...", "name": "...", "fromMe": false } }
-- Lista de opções vazia = a pessoa tirou o voto.

begin;

alter table public.messages
  add column if not exists poll_votes jsonb;

comment on column public.messages.poll_votes is
  'Votos da enquete do WhatsApp, por JID de quem votou (options, at, name, fromMe).';

commit;
