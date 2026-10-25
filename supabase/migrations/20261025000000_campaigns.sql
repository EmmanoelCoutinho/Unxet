-- =============================================================================
-- Campanhas: mensagens programadas com nome, envio imediato e resultado
--
-- "Mensagens programadas" vira "Campanhas" (mesmas tabelas). Cada campanha
-- passa a medir o próprio resultado, destinatário por destinatário:
--
--   enviada      já existia (status = 'sent')
--   entregue     delivered_at, copiado da mensagem quando o WhatsApp confirma
--   lida         read_at, idem
--   respondeu    replied_at: o cliente escreveu na conversa dentro do prazo
--                de acompanhamento (reply_window_days, padrão 7 dias)
--   aderiu       converted_at: o atendente clicou "Aderiu" na conversa, ou
--                colocou nela a etiqueta de conversão escolhida na campanha
--
-- Quando o mesmo cliente recebe mais de uma campanha, a resposta e a adesão
-- contam para a mais recente que ainda está no prazo.
--
-- Outras mudanças:
--   - limite de destinatários sobe de 100 para 300 por campanha
--   - "enviar agora" (p_send_now) além do horário agendado
--   - view scheduled_message_summaries: a lista mostra os números sem baixar
--     todos os destinatários de todas as campanhas
--   - campaign_audience: clientes da carteira por etiqueta (ou todos)
--
-- Ordem de deploy: aplique ANTES de publicar a edge function
-- scheduled-messages-dispatch (que passa a gravar message_id) e o frontend.
-- O frontend antigo continua funcionando com esta migration: a função de
-- salvar com 5 parâmetros é mantida enquanto o novo não sai.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Colunas novas
-- -----------------------------------------------------------------------------
alter table public.scheduled_messages
  add column if not exists name text
    check (name is null or char_length(btrim(name)) between 1 and 120),
  add column if not exists conversion_tag_id uuid
    references public.tags (id) on delete set null,
  add column if not exists reply_window_days integer not null default 7
    check (reply_window_days between 1 and 30);

alter table public.scheduled_message_recipients
  add column if not exists message_id uuid
    references public.messages (id) on delete set null,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists replied_at timestamptz,
  add column if not exists converted_at timestamptz,
  add column if not exists converted_by uuid
    references auth.users (id) on delete set null,
  add column if not exists converted_via text
    check (converted_via is null or converted_via in ('button', 'tag')),
  add column if not exists conversion_value numeric(12, 2)
    check (conversion_value is null or conversion_value >= 0);

-- Tipo da falha, para saber quem pode receber de novo:
--   retryable   a mensagem não saiu (WhatsApp desconectado, empresa pausada,
--               recusa do WhatsApp): tentar de novo é seguro
--   permanent   número sem WhatsApp ou não identificado: não adianta
--   uncertain   não deu para confirmar (sem resposta a tempo, rodada
--               interrompida): pode ter chegado, reenviar mandaria em dobro
-- Os textos vêm do scheduled-messages-dispatch e do
-- claim_scheduled_message_recipients; texto novo de falha cai em "retryable".
alter table public.scheduled_message_recipients
  add column if not exists failure_kind text generated always as (
    case
      when status <> 'failed' then null
      when error like 'Este número não tem WhatsApp%'
        or error like 'Não foi possível identificar o número%' then 'permanent'
      when error like '%Confira a conversa antes de enviar de novo%' then 'uncertain'
      else 'retryable'
    end
  ) stored;

create index if not exists scheduled_message_recipients_conversation_idx
  on public.scheduled_message_recipients (conversation_id, sent_at desc)
  where conversation_id is not null and status = 'sent';

create index if not exists scheduled_message_recipients_message_id_idx
  on public.scheduled_message_recipients (message_id)
  where message_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Envios antigos: liga à mensagem gravada e calcula entregue/lida/respondeu
-- -----------------------------------------------------------------------------
update public.scheduled_message_recipients r
   set message_id = m.id,
       delivered_at = m.delivered_at,
       read_at = m.read_at
  from public.messages m
 where r.status = 'sent'
   and r.message_id is null
   and r.conversation_id is not null
   and m.conversation_id = r.conversation_id
   and m.direction = 'outbound'
   and m.payload ->> 'scheduled_message_id' = r.scheduled_message_id::text;

update public.scheduled_message_recipients r
   set replied_at = (
     select min(m.created_at)
     from public.messages m
     where m.conversation_id = r.conversation_id
       and m.direction = 'inbound'
       and m.created_at > r.sent_at
       and m.created_at <= r.sent_at + interval '7 days'
   )
 where r.status = 'sent'
   and r.replied_at is null
   and r.conversation_id is not null
   and r.sent_at is not null;

-- -----------------------------------------------------------------------------
-- 3. Campanha mais recente de uma conversa, ainda no prazo de acompanhamento
-- -----------------------------------------------------------------------------
create or replace function public.campaign_recipient_for_conversation(
  p_conversation_id uuid,
  p_at timestamptz default now()
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
  from public.scheduled_message_recipients r
  join public.scheduled_messages sm on sm.id = r.scheduled_message_id
  where r.conversation_id = p_conversation_id
    and r.status = 'sent'
    and r.sent_at is not null
    and r.sent_at <= p_at
    and r.sent_at > p_at - make_interval(days => sm.reply_window_days)
  order by r.sent_at desc
  limit 1;
$$;

revoke execute on function public.campaign_recipient_for_conversation(uuid, timestamptz)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Gatilhos de acompanhamento
--
-- Rodam junto da gravação de mensagens e etiquetas: um erro aqui não pode
-- impedir a mensagem do cliente de entrar, então todos engolem a exceção.
-- -----------------------------------------------------------------------------

-- 4a. Respondeu: primeira mensagem do cliente depois do envio
create or replace function public.track_campaign_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz := coalesce(new.created_at, now());
  v_recipient_id uuid;
begin
  if new.conversation_id is null then
    return null;
  end if;

  v_recipient_id := public.campaign_recipient_for_conversation(new.conversation_id, v_at);
  if v_recipient_id is not null then
    update public.scheduled_message_recipients
       set replied_at = v_at
     where id = v_recipient_id
       and replied_at is null;
  end if;

  return null;
exception when others then
  raise warning '[track_campaign_reply] %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists messages_track_campaign_reply on public.messages;
create trigger messages_track_campaign_reply
  after insert on public.messages
  for each row
  when (new.direction = 'inbound')
  execute function public.track_campaign_reply();

-- 4b. Entregue / lida: o webhook atualiza a mensagem, a campanha copia
create or replace function public.track_campaign_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.scheduled_message_recipients
     set delivered_at = coalesce(delivered_at, new.delivered_at),
         read_at = coalesce(read_at, new.read_at)
   where message_id = new.id;

  return null;
exception when others then
  raise warning '[track_campaign_delivery] %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists messages_track_campaign_delivery on public.messages;
create trigger messages_track_campaign_delivery
  after update of delivered_at, read_at on public.messages
  for each row
  when (
    new.direction = 'outbound'
    and (
      old.delivered_at is distinct from new.delivered_at
      or old.read_at is distinct from new.read_at
    )
  )
  execute function public.track_campaign_delivery();

-- O "entregue" pode chegar antes de o disparador gravar o message_id no
-- destinatário: ao ligar, já copia o que a mensagem tiver
create or replace function public.copy_campaign_delivery_on_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select coalesce(new.delivered_at, m.delivered_at),
         coalesce(new.read_at, m.read_at)
    into new.delivered_at, new.read_at
    from public.messages m
   where m.id = new.message_id;

  return new;
exception when others then
  raise warning '[copy_campaign_delivery_on_link] %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists scheduled_recipients_copy_delivery on public.scheduled_message_recipients;
create trigger scheduled_recipients_copy_delivery
  before update of message_id on public.scheduled_message_recipients
  for each row
  when (new.message_id is not null and old.message_id is distinct from new.message_id)
  execute function public.copy_campaign_delivery_on_link();

-- 4c. Aderiu pela etiqueta de conversão (e desfaz se a etiqueta sair)
create or replace function public.track_campaign_conversion_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient_id uuid;
begin
  if tg_op = 'INSERT' then
    v_recipient_id := public.campaign_recipient_for_conversation(new.conversation_id);
    if v_recipient_id is not null then
      update public.scheduled_message_recipients r
         set converted_at = now(),
             converted_via = 'tag',
             converted_by = auth.uid()
        from public.scheduled_messages sm
       where r.id = v_recipient_id
         and sm.id = r.scheduled_message_id
         and sm.conversion_tag_id = new.tag_id
         and r.converted_at is null;
    end if;
    return null;
  end if;

  -- DELETE: só desfaz o que a própria etiqueta marcou
  update public.scheduled_message_recipients r
     set converted_at = null,
         converted_via = null,
         converted_by = null,
         conversion_value = null
    from public.scheduled_messages sm
   where r.conversation_id = old.conversation_id
     and r.converted_via = 'tag'
     and sm.id = r.scheduled_message_id
     and sm.conversion_tag_id = old.tag_id;
  return null;
exception when others then
  raise warning '[track_campaign_conversion_tag] %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists conversation_tags_track_campaign on public.conversation_tags;
create trigger conversation_tags_track_campaign
  after insert or delete on public.conversation_tags
  for each row
  execute function public.track_campaign_conversion_tag();

revoke execute on function public.track_campaign_reply() from public, anon, authenticated;
revoke execute on function public.track_campaign_delivery() from public, anon, authenticated;
revoke execute on function public.copy_campaign_delivery_on_link() from public, anon, authenticated;
revoke execute on function public.track_campaign_conversion_tag() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Salvar: nome, enviar agora, etiqueta de conversão, prazo, até 300
--
-- A versão de 5 parâmetros continua existindo para o frontend antigo
-- (mesma regra, sem os campos novos) até o novo ser publicado.
-- -----------------------------------------------------------------------------
create or replace function public.scheduled_message_save(
  p_id uuid,
  p_message text,
  p_scheduled_at timestamptz,
  p_recipients jsonb,
  p_channel_connection_id uuid,
  p_name text,
  p_send_now boolean,
  p_conversion_tag_id uuid,
  p_reply_window_days integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_message text := btrim(coalesce(p_message, ''));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_scheduled_at timestamptz;
  v_window integer := coalesce(p_reply_window_days, 7);
  v_current public.scheduled_messages%rowtype;
  v_id uuid;
  v_count integer;
  v_invalid text;
begin
  if v_user_id is null then
    raise exception 'Não autorizado';
  end if;

  select cu.clinic_id, cu.role
    into v_clinic_id, v_role
    from public.clinic_users cu
   where cu.user_id = v_user_id
   limit 1;

  if v_clinic_id is null then
    raise exception 'Não autorizado';
  end if;

  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'O nome da campanha pode ter no máximo 120 caracteres.';
  end if;

  if char_length(v_message) = 0 then
    raise exception 'Escreva a mensagem.';
  end if;
  if char_length(v_message) > 4000 then
    raise exception 'A mensagem pode ter no máximo 4000 caracteres.';
  end if;

  if coalesce(p_send_now, false) then
    v_scheduled_at := now();
  else
    v_scheduled_at := p_scheduled_at;
    if v_scheduled_at is null or v_scheduled_at <= now() then
      raise exception 'Escolha uma data e hora no futuro.';
    end if;
    if v_scheduled_at > now() + interval '1 year' then
      raise exception 'A campanha pode ser agendada para no máximo 1 ano à frente.';
    end if;
  end if;

  if v_window < 1 or v_window > 30 then
    raise exception 'O prazo de acompanhamento deve ser de 1 a 30 dias.';
  end if;

  if p_channel_connection_id is not null and not exists (
    select 1
    from public.channel_connections cc
    where cc.id = p_channel_connection_id
      and cc.clinic_id = v_clinic_id
      and cc.provider = 'evolution'
      and cc.channel = 'whatsapp'
      and cc.archived_at is null
  ) then
    raise exception 'Número de WhatsApp não encontrado.';
  end if;

  if p_conversion_tag_id is not null and not exists (
    select 1
    from public.tags t
    where t.id = p_conversion_tag_id
      and t.clinic_id = v_clinic_id
  ) then
    raise exception 'Etiqueta de conversão não encontrada.';
  end if;

  if p_recipients is null
     or jsonb_typeof(p_recipients) <> 'array'
     or jsonb_array_length(p_recipients) = 0 then
    raise exception 'Adicione pelo menos um destinatário.';
  end if;
  -- Folga para números repetidos, que viram um destinatário só
  if jsonb_array_length(p_recipients) > 600 then
    raise exception 'Cada campanha aceita no máximo 300 destinatários.';
  end if;

  -- Cliente da carteira precisa ser da mesma empresa
  if exists (
    select 1
    from jsonb_array_elements(p_recipients) as r
    where nullif(r ->> 'contact_id', '') is not null
      and not exists (
        select 1
        from public.contacts c
        where c.id = (r ->> 'contact_id')::uuid
          and c.clinic_id = v_clinic_id
      )
  ) then
    raise exception 'Um dos clientes selecionados não foi encontrado na carteira.';
  end if;

  if p_id is null then
    insert into public.scheduled_messages (
      clinic_id, created_by, name, message, scheduled_at, channel_connection_id,
      conversion_tag_id, reply_window_days
    )
    values (
      v_clinic_id, v_user_id, v_name, v_message, v_scheduled_at, p_channel_connection_id,
      p_conversion_tag_id, v_window
    )
    returning id into v_id;
  else
    select *
      into v_current
      from public.scheduled_messages sm
     where sm.id = p_id
       for update;

    if not found
       or v_current.clinic_id <> v_clinic_id
       or not (v_role = 'admin' or v_current.created_by = v_user_id) then
      raise exception 'Campanha não encontrada.';
    end if;

    if v_current.status <> 'scheduled' then
      raise exception 'Esta campanha já começou a ser enviada e não pode mais ser editada.';
    end if;

    update public.scheduled_messages
       set name = v_name,
           message = v_message,
           scheduled_at = v_scheduled_at,
           channel_connection_id = p_channel_connection_id,
           conversion_tag_id = p_conversion_tag_id,
           reply_window_days = v_window,
           updated_at = now()
     where id = p_id;

    delete from public.scheduled_message_recipients where scheduled_message_id = p_id;
    v_id := p_id;
  end if;

  -- Um destinatário por número: escolher o cliente e digitar o mesmo telefone
  -- não gera dois envios
  insert into public.scheduled_message_recipients (
    scheduled_message_id, position, contact_id, name, phone
  )
  select distinct on (resolved.phone)
    v_id,
    resolved.position,
    resolved.contact_id,
    resolved.name,
    resolved.phone
  from (
    select
      t.ord::integer as position,
      coalesce(picked.id, by_phone.id) as contact_id,
      coalesce(
        nullif(btrim(picked.name), ''),
        nullif(btrim(by_phone.name), ''),
        nullif(btrim(t.r ->> 'name'), '')
      ) as name,
      case
        when picked.id is not null
          then regexp_replace(coalesce(picked.phone, ''), '\D', '', 'g')
        else regexp_replace(coalesce(t.r ->> 'phone', ''), '\D', '', 'g')
      end as phone
    from jsonb_array_elements(p_recipients) with ordinality as t(r, ord)
    left join public.contacts picked
      on picked.id = nullif(t.r ->> 'contact_id', '')::uuid
     and picked.clinic_id = v_clinic_id
    -- Número digitado que já é de um cliente: vincula ao cadastro
    left join public.contacts by_phone
      on picked.id is null
     and by_phone.clinic_id = v_clinic_id
     and by_phone.phone = regexp_replace(coalesce(t.r ->> 'phone', ''), '\D', '', 'g')
  ) as resolved
  order by resolved.phone, resolved.position;

  select count(*), min(coalesce(r.name, r.phone)) filter (where r.phone !~ '^\d{10,15}$')
    into v_count, v_invalid
    from public.scheduled_message_recipients r
   where r.scheduled_message_id = v_id;

  if v_invalid is not null then
    raise exception 'Telefone inválido para "%". Use DDD e número, só com dígitos.', v_invalid;
  end if;
  if v_count > 300 then
    raise exception 'Cada campanha aceita no máximo 300 destinatários.';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb, uuid, text, boolean, uuid, integer) from public, anon;
grant execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb, uuid, text, boolean, uuid, integer) to authenticated;

-- Versão antiga (frontend publicado antes desta entrega): mantém nome,
-- etiqueta e prazo de uma campanha que já existia
create or replace function public.scheduled_message_save(
  p_id uuid,
  p_message text,
  p_scheduled_at timestamptz,
  p_recipients jsonb,
  p_channel_connection_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.scheduled_messages%rowtype;
begin
  if p_id is not null then
    select * into v_current from public.scheduled_messages where id = p_id;
  end if;

  return public.scheduled_message_save(
    p_id,
    p_message,
    p_scheduled_at,
    p_recipients,
    p_channel_connection_id,
    v_current.name,
    false,
    v_current.conversion_tag_id,
    coalesce(v_current.reply_window_days, 7)
  );
end;
$$;

revoke execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb, uuid) from public, anon;
grant execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Lista: resumo de cada campanha (RLS das tabelas vale: security_invoker)
-- -----------------------------------------------------------------------------
create or replace view public.scheduled_message_summaries
with (security_invoker = true)
as
select
  sm.id,
  sm.clinic_id,
  sm.created_by,
  sm.name,
  sm.message,
  sm.scheduled_at,
  sm.status,
  sm.started_at,
  sm.finished_at,
  sm.created_at,
  sm.updated_at,
  sm.channel_connection_id,
  sm.conversion_tag_id,
  sm.reply_window_days,
  coalesce(s.total, 0)::integer as total_count,
  coalesce(s.sent, 0)::integer as sent_count,
  coalesce(s.failed, 0)::integer as failed_count,
  coalesce(s.waiting, 0)::integer as waiting_count,
  coalesce(s.cancelled, 0)::integer as cancelled_count,
  coalesce(s.delivered, 0)::integer as delivered_count,
  coalesce(s.read, 0)::integer as read_count,
  coalesce(s.replied, 0)::integer as replied_count,
  coalesce(s.converted, 0)::integer as converted_count,
  coalesce(s.revenue, 0)::numeric(14, 2) as conversion_revenue,
  coalesce(s.preview_names, '{}'::text[]) as preview_names
from public.scheduled_messages sm
left join lateral (
  select
    count(*) as total,
    count(*) filter (where r.status = 'sent') as sent,
    count(*) filter (where r.status = 'failed') as failed,
    count(*) filter (where r.status in ('pending', 'sending')) as waiting,
    count(*) filter (where r.status = 'cancelled') as cancelled,
    count(*) filter (where r.status = 'sent' and (r.delivered_at is not null or r.read_at is not null)) as delivered,
    count(*) filter (where r.status = 'sent' and r.read_at is not null) as read,
    count(*) filter (where r.replied_at is not null) as replied,
    count(*) filter (where r.converted_at is not null) as converted,
    sum(r.conversion_value) filter (where r.converted_at is not null) as revenue,
    (array_agg(coalesce(nullif(btrim(r.name), ''), r.phone) order by r.position))[1:2] as preview_names
  from public.scheduled_message_recipients r
  where r.scheduled_message_id = sm.id
) s on true;

revoke all on public.scheduled_message_summaries from anon, authenticated;
grant select on public.scheduled_message_summaries to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Público: clientes da carteira por etiqueta (sem etiqueta = todos)
--
-- A etiqueta fica na conversa; o cliente entra se alguma conversa dele tem
-- uma das etiquetas. Só números de telefone de verdade (10 a 13 dígitos).
-- -----------------------------------------------------------------------------
create or replace function public.campaign_audience(p_tag_ids uuid[] default null)
returns table (id uuid, name text, phone text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  select cu.clinic_id
    into v_clinic_id
    from public.clinic_users cu
   where cu.user_id = auth.uid()
   limit 1;

  if v_clinic_id is null then
    raise exception 'Não autorizado';
  end if;

  return query
  select c.id, c.name, regexp_replace(c.phone, '\D', '', 'g') as phone
  from public.contacts c
  where c.clinic_id = v_clinic_id
    and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') ~ '^\d{10,13}$'
    and (
      coalesce(cardinality(p_tag_ids), 0) = 0
      or exists (
        select 1
        from public.conversations conv
        join public.conversation_tags ct on ct.conversation_id = conv.id
        where conv.contact_id = c.id
          and conv.clinic_id = v_clinic_id
          and ct.tag_id = any (p_tag_ids)
      )
    )
  order by lower(coalesce(nullif(btrim(c.name), ''), c.phone))
  limit 2000;
end;
$$;

revoke execute on function public.campaign_audience(uuid[]) from public, anon;
grant execute on function public.campaign_audience(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Conversa: de qual campanha veio e marcar adesão
--
-- Quem atende a conversa (mesmo sem ter criado a campanha) vê a faixa e marca.
-- -----------------------------------------------------------------------------
create or replace function public.campaign_for_conversation(p_conversation_id uuid)
returns table (
  recipient_id uuid,
  campaign_id uuid,
  campaign_name text,
  campaign_message text,
  sent_at timestamptz,
  replied_at timestamptz,
  converted_at timestamptz,
  converted_via text,
  conversion_value numeric,
  conversion_tag_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_recipient_id uuid;
begin
  if not public.can_access_conversation_id(p_conversation_id) then
    return;
  end if;

  v_recipient_id := public.campaign_recipient_for_conversation(p_conversation_id);
  if v_recipient_id is null then
    return;
  end if;

  return query
  select r.id, sm.id, sm.name, sm.message, r.sent_at, r.replied_at,
         r.converted_at, r.converted_via, r.conversion_value, sm.conversion_tag_id
  from public.scheduled_message_recipients r
  join public.scheduled_messages sm on sm.id = r.scheduled_message_id
  where r.id = v_recipient_id;
end;
$$;

create or replace function public.campaign_set_conversion(
  p_recipient_id uuid,
  p_converted boolean,
  p_value numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
begin
  select r.conversation_id
    into v_conversation_id
    from public.scheduled_message_recipients r
   where r.id = p_recipient_id
     and r.status = 'sent';

  if v_conversation_id is null
     or not public.can_access_conversation_id(v_conversation_id)
     or public.campaign_recipient_for_conversation(v_conversation_id) is distinct from p_recipient_id then
    raise exception 'Campanha não encontrada para esta conversa.';
  end if;

  if p_value is not null and (p_value < 0 or p_value > 9999999999) then
    raise exception 'Valor inválido.';
  end if;

  if p_converted then
    update public.scheduled_message_recipients
       set converted_at = coalesce(converted_at, now()),
           converted_via = coalesce(converted_via, 'button'),
           converted_by = coalesce(converted_by, auth.uid()),
           conversion_value = round(p_value, 2)
     where id = p_recipient_id;
  else
    update public.scheduled_message_recipients
       set converted_at = null,
           converted_via = null,
           converted_by = null,
           conversion_value = null
     where id = p_recipient_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Tentar de novo: quem não recebeu volta para a fila
--
-- Entram as falhas em que a mensagem com certeza não saiu (failure_kind =
-- 'retryable') e os envios cancelados. Ficam de fora os números sem WhatsApp
-- e as falhas incertas (a pessoa confere a conversa antes). O ritmo seguro do
-- disparador vale igual.
-- -----------------------------------------------------------------------------
create or replace function public.campaign_retry(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.scheduled_messages%rowtype;
  v_count integer;
begin
  select *
    into v_current
    from public.scheduled_messages sm
   where sm.id = p_id
     for update;

  if not found
     or not public.can_access_scheduled_message(v_current.clinic_id, v_current.created_by) then
    raise exception 'Campanha não encontrada.';
  end if;

  if v_current.status in ('scheduled', 'processing') then
    raise exception 'A campanha ainda está enviando. Aguarde terminar para tentar de novo.';
  end if;

  update public.scheduled_message_recipients
     set status = 'pending',
         error = null,
         claimed_at = null
   where scheduled_message_id = p_id
     and (
       status = 'cancelled'
       or (status = 'failed' and failure_kind = 'retryable')
     );
  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception 'Não há envios para tentar de novo.';
  end if;

  -- Volta direto para "enviando": o disparador pega na próxima rodada
  update public.scheduled_messages
     set status = 'processing',
         finished_at = null,
         updated_at = now()
   where id = p_id;

  return v_count;
end;
$$;

revoke execute on function public.campaign_retry(uuid) from public, anon;
grant execute on function public.campaign_retry(uuid) to authenticated;

revoke execute on function public.campaign_for_conversation(uuid) from public, anon;
revoke execute on function public.campaign_set_conversion(uuid, boolean, numeric) from public, anon;
grant execute on function public.campaign_for_conversation(uuid) to authenticated;
grant execute on function public.campaign_set_conversion(uuid, boolean, numeric) to authenticated;

commit;
