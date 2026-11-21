-- Mensagem enviada que o WhatsApp não entregou.
--
-- A Evolution (status ERROR em messages.update) e a Meta (status "failed")
-- avisam quando uma mensagem aceita no envio não chega ao cliente. Antes o
-- Unxet ignorava o aviso e a mensagem ficava com um tique para sempre: a
-- equipe achava que tinha enviado. Caso conhecido: Evolution 2.3.7 depois de
-- ler o QR Code de novo (envios para o número falham sem erro na hora).
--
-- failed_at só vale enquanto a mensagem não foi entregue: se a confirmação
-- de entrega chegar depois, delivered_at prevalece.

begin;

alter table public.messages
  add column if not exists failed_at timestamptz,
  add column if not exists failure_reason text;

comment on column public.messages.failed_at is
  'Quando o provedor avisou que a mensagem enviada não foi entregue (Evolution ERROR / Meta failed).';
comment on column public.messages.failure_reason is
  'Motivo informado pelo provedor, quando houver (ex.: erro da Meta).';

commit;
