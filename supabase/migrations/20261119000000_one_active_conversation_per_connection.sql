-- Uma conversa ativa (na fila ou em atendimento) por cliente em cada número da empresa.
--
-- O índice conversations_one_active_per_number usa whatsapp_number_id, que só
-- existe no WhatsApp oficial. No QR Code (Evolution) ele é nulo, e nulos não
-- colidem: duas mensagens do mesmo cliente processadas no mesmo instante criavam
-- duas conversas na fila (o shared-in-config já trata o 23505, mas nada o gerava).

-- 1. Junta as duplicadas que já existem: fica a mais antiga, as outras
--    passam as mensagens para ela e são encerradas.
with ranked as (
  select
    id,
    first_value(id) over (
      partition by clinic_id, contact_id, channel, channel_connection_id
      order by created_at, id
    ) as keeper_id,
    row_number() over (
      partition by clinic_id, contact_id, channel, channel_connection_id
      order by created_at, id
    ) as rn
  from public.conversations
  where channel = 'whatsapp'
    and channel_connection_id is not null
    and status in ('open', 'pending')
),
dupes as (
  select id, keeper_id from ranked where rn > 1
),
moved as (
  update public.messages m
  set conversation_id = d.keeper_id
  from dupes d
  where m.conversation_id = d.id
  returning d.keeper_id
)
update public.conversations c
set status = 'closed',
    closed_at = now(),
    status_changed_at = now()
from dupes d
where c.id = d.id;

-- A que ficou passa a refletir a última mensagem que recebeu das outras
update public.conversations c
set last_message_at = greatest(c.last_message_at, sub.max_at)
from (
  select conversation_id, max(created_at) as max_at
  from public.messages
  group by conversation_id
) sub
where sub.conversation_id = c.id
  and c.status in ('open', 'pending')
  and c.channel = 'whatsapp'
  and sub.max_at > coalesce(c.last_message_at, '-infinity'::timestamptz);

-- 2. Barra a duplicata no banco, para qualquer tipo de conexão
create unique index if not exists conversations_one_active_per_connection
  on public.conversations (clinic_id, contact_id, channel, channel_connection_id)
  where status in ('open', 'pending')
    and channel = 'whatsapp'
    and channel_connection_id is not null;
