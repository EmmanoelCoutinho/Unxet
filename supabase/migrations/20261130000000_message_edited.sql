-- Mensagem editada no WhatsApp.
--
-- O evolution-in já trocava o texto quando o cliente editava a mensagem, mas
-- sem marca nenhuma: o atendente não sabia que o texto tinha mudado. Agora a
-- conversa mostra "Editada" e o texto de antes.
--
-- edit_unreadable: o WhatsApp avisou da edição, mas o texto novo não pôde ser
-- lido (edição criptografada sem o LID do cliente). A conversa avisa que a
-- mensagem foi editada e que o texto novo está no WhatsApp do celular.

begin;

alter table public.messages
  add column if not exists edited_at timestamptz,
  add column if not exists original_text text,
  add column if not exists edit_unreadable boolean not null default false;

comment on column public.messages.edited_at is
  'Última vez que a mensagem foi editada no WhatsApp.';
comment on column public.messages.original_text is
  'Texto (ou legenda) antes da primeira edição.';
comment on column public.messages.edit_unreadable is
  'A edição chegou, mas o texto novo não pôde ser lido (fica o texto anterior).';

commit;
