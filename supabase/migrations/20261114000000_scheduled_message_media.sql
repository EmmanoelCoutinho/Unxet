-- =============================================================================
-- Anexo nas mensagens agendadas
--
-- "Agendar mensagem" (Carteira de clientes e cartão do Funil) passa a aceitar
-- um arquivo: foto, vídeo, áudio ou documento. O arquivo sobe para a pasta da
-- empresa no bucket whatsapp-media (<empresa>/scheduled/...) ou vem do Banco
-- de arquivos. Com anexo, o texto vira legenda e pode ficar vazio.
--
-- recurring_messages guarda o anexo da regra; materialize_recurring_messages
-- copia para cada envio (scheduled_messages), e o scheduled-messages-dispatch
-- manda pela Evolution (sendMedia / sendWhatsAppAudio).
--
-- Campanhas continuam só com texto (ou modelo da Meta): a tela delas não
-- manda anexo.
--
-- Ordem de deploy: aplique ANTES da edge function scheduled-messages-dispatch
-- e do front.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Colunas e regras
-- -----------------------------------------------------------------------------
alter table public.scheduled_messages
  add column if not exists media_url text,
  add column if not exists media_mime_type text,
  add column if not exists media_filename text,
  add column if not exists media_kind text;

alter table public.recurring_messages
  add column if not exists media_url text,
  add column if not exists media_mime_type text,
  add column if not exists media_filename text,
  add column if not exists media_kind text;

-- O texto deixa de ser obrigatório quando há anexo: troca a regra antiga
-- (1 a 4000 caracteres) por "até 4000, e texto ou anexo"
do $$
declare
  v_table text;
  v_constraint text;
begin
  foreach v_table in array array['scheduled_messages', 'recurring_messages'] loop
    for v_constraint in
      select con.conname
        from pg_constraint con
       where con.conrelid = ('public.' || v_table)::regclass
         and con.contype = 'c'
         and pg_get_constraintdef(con.oid) ilike '%char_length(btrim(message))%'
    loop
      execute format('alter table public.%I drop constraint %I', v_table, v_constraint);
    end loop;
  end loop;
end;
$$;

alter table public.scheduled_messages
  drop constraint if exists scheduled_messages_message_or_media,
  add constraint scheduled_messages_message_or_media check (
    char_length(message) <= 4000
    and (char_length(btrim(message)) > 0 or media_url is not null)
  ),
  drop constraint if exists scheduled_messages_media_valid,
  add constraint scheduled_messages_media_valid check (
    media_url is null
    or (
      media_kind in ('image', 'audio', 'video', 'document')
      -- Só arquivos da pasta da própria empresa
      and media_url like '%/storage/v1/object/public/whatsapp-media/' || clinic_id::text || '/%'
      and (media_filename is null or char_length(media_filename) <= 200)
    )
  );

alter table public.recurring_messages
  drop constraint if exists recurring_messages_message_or_media,
  add constraint recurring_messages_message_or_media check (
    char_length(message) <= 4000
    and (char_length(btrim(message)) > 0 or media_url is not null)
  ),
  drop constraint if exists recurring_messages_media_valid,
  add constraint recurring_messages_media_valid check (
    media_url is null
    or (
      media_kind in ('image', 'audio', 'video', 'document')
      and media_url like '%/storage/v1/object/public/whatsapp-media/' || clinic_id::text || '/%'
      and (media_filename is null or char_length(media_filename) <= 200)
    )
  );

-- Normaliza o anexo vindo da tela; levanta erro com mensagem amigável
create or replace function public.scheduled_media_check(
  p_clinic_id uuid,
  p_media_url text,
  p_media_kind text,
  p_media_filename text
)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_media_url is null then
    return;
  end if;
  if p_media_kind is null or p_media_kind not in ('image', 'audio', 'video', 'document') then
    raise exception 'Tipo de arquivo não aceito.';
  end if;
  if p_media_url not like '%/storage/v1/object/public/whatsapp-media/' || p_clinic_id::text || '/%' then
    raise exception 'Arquivo não encontrado.';
  end if;
  if p_media_filename is not null and char_length(p_media_filename) > 200 then
    raise exception 'O nome do arquivo pode ter no máximo 200 caracteres.';
  end if;
end;
$$;

revoke execute on function public.scheduled_media_check(uuid, text, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Mensagem agendada para um cliente (Carteira): parâmetros do anexo
-- -----------------------------------------------------------------------------
drop function if exists public.recurring_message_save(uuid, uuid, text, text, smallint[], smallint, time, date, date, integer, boolean, uuid, text);

create or replace function public.recurring_message_save(
  p_id uuid,
  p_contact_id uuid,
  p_message text,
  p_frequency text,
  p_weekdays smallint[],
  p_month_day smallint,
  p_send_time time,
  p_starts_on date,
  p_ends_on date,
  p_max_runs integer,
  p_send_now boolean,
  p_channel_connection_id uuid,
  p_timezone text,
  p_media_url text default null,
  p_media_mime_type text default null,
  p_media_filename text default null,
  p_media_kind text default null
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
  v_tz text := coalesce(nullif(btrim(p_timezone), ''), 'America/Sao_Paulo');
  v_send_now boolean := p_frequency = 'once' and coalesce(p_send_now, false);
  v_starts_on date := p_starts_on;
  v_send_time time := p_send_time;
  v_weekdays smallint[];
  v_next timestamptz;
  v_current public.recurring_messages%rowtype;
  v_id uuid;
  v_media_url text := nullif(btrim(coalesce(p_media_url, '')), '');
  v_media_filename text := nullif(btrim(coalesce(p_media_filename, '')), '');
  v_media_mime text := nullif(btrim(coalesce(p_media_mime_type, '')), '');
  v_media_kind text := nullif(btrim(coalesce(p_media_kind, '')), '');
begin
  if v_user_id is null then
    raise exception 'Não autorizado';
  end if;

  select cu.clinic_id, cu.role into v_clinic_id, v_role
    from public.clinic_users cu where cu.user_id = v_user_id limit 1;
  if v_clinic_id is null then
    raise exception 'Não autorizado';
  end if;

  -- Fuso inválido: usa o de Brasília
  begin
    perform now() at time zone v_tz;
  exception when others then
    v_tz := 'America/Sao_Paulo';
  end;

  if not exists (
    select 1 from public.contacts c
    where c.id = p_contact_id
      and c.clinic_id = v_clinic_id
      and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') ~ '^\d{10,15}$'
  ) then
    raise exception 'Cliente sem telefone de WhatsApp válido.';
  end if;

  perform public.scheduled_media_check(v_clinic_id, v_media_url, v_media_kind, v_media_filename);

  if char_length(v_message) = 0 and v_media_url is null then
    raise exception 'Escreva a mensagem ou anexe um arquivo.';
  end if;
  if char_length(v_message) > 4000 then
    raise exception 'A mensagem pode ter no máximo 4000 caracteres.';
  end if;

  if p_frequency not in ('once', 'daily', 'weekly', 'monthly') then
    raise exception 'Escolha quando repetir.';
  end if;
  if p_send_time is null or p_starts_on is null then
    raise exception 'Informe a data e o horário.';
  end if;

  if p_frequency = 'weekly' then
    select array_agg(distinct d order by d) into v_weekdays
      from unnest(coalesce(p_weekdays, '{}'::smallint[])) as d
     where d between 0 and 6;
    if v_weekdays is null then
      raise exception 'Escolha pelo menos um dia da semana.';
    end if;
  end if;
  if p_frequency = 'monthly' and (p_month_day is null or p_month_day not between 1 and 31) then
    raise exception 'Escolha o dia do mês.';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'A data final precisa ser depois do início.';
  end if;
  if p_max_runs is not null and p_max_runs not between 1 and 1000 then
    raise exception 'O número de envios deve ser de 1 a 1000.';
  end if;
  if not v_send_now and p_starts_on > current_date + 366 then
    raise exception 'O primeiro envio pode ser em no máximo 1 ano.';
  end if;

  if p_channel_connection_id is not null and not exists (
    select 1 from public.channel_connections cc
    where cc.id = p_channel_connection_id
      and cc.clinic_id = v_clinic_id
      and cc.provider = 'evolution'
      and cc.channel = 'whatsapp'
      and cc.archived_at is null
  ) then
    raise exception 'Número de WhatsApp não encontrado.';
  end if;

  if v_send_now then
    -- "Enviar agora": a data e a hora guardadas são as de agora (é o que a
    -- tela mostra depois)
    v_next := now();
    v_starts_on := (now() at time zone v_tz)::date;
    v_send_time := date_trunc('minute', (now() at time zone v_tz))::time;
  else
    v_next := public.recurring_next_run(
      p_frequency, v_weekdays, p_month_day, p_send_time, v_tz, p_starts_on, p_ends_on, now()
    );
    if v_next is null then
      raise exception 'Com essas datas não sobra nenhum envio no futuro.';
    end if;
  end if;

  if p_id is null then
    insert into public.recurring_messages (
      clinic_id, contact_id, created_by, message, channel_connection_id, frequency,
      weekdays, month_day, send_time, timezone, starts_on, ends_on, max_runs, next_run_at,
      media_url, media_mime_type, media_filename, media_kind
    )
    values (
      v_clinic_id, p_contact_id, v_user_id, v_message, p_channel_connection_id, p_frequency,
      v_weekdays, case when p_frequency = 'monthly' then p_month_day end, v_send_time, v_tz,
      v_starts_on, case when p_frequency = 'once' then null else p_ends_on end,
      case when p_frequency = 'once' then null else p_max_runs end, v_next,
      v_media_url, case when v_media_url is not null then v_media_mime end,
      case when v_media_url is not null then v_media_filename end,
      case when v_media_url is not null then v_media_kind end
    )
    returning id into v_id;
  else
    select * into v_current from public.recurring_messages where id = p_id for update;
    if not found
       or v_current.clinic_id <> v_clinic_id
       or not (v_role = 'admin' or v_current.created_by = v_user_id) then
      raise exception 'Mensagem agendada não encontrada.';
    end if;

    update public.recurring_messages
       set contact_id = p_contact_id,
           message = v_message,
           channel_connection_id = p_channel_connection_id,
           frequency = p_frequency,
           weekdays = v_weekdays,
           month_day = case when p_frequency = 'monthly' then p_month_day end,
           send_time = v_send_time,
           timezone = v_tz,
           starts_on = v_starts_on,
           ends_on = case when p_frequency = 'once' then null else p_ends_on end,
           max_runs = case when p_frequency = 'once' then null else p_max_runs end,
           media_url = v_media_url,
           media_mime_type = case when v_media_url is not null then v_media_mime end,
           media_filename = case when v_media_url is not null then v_media_filename end,
           media_kind = case when v_media_url is not null then v_media_kind end,
           -- Editar recomeça a contagem de envios
           run_count = 0,
           next_run_at = v_next,
           status = 'active',
           last_error = null,
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.recurring_message_save(uuid, uuid, text, text, smallint[], smallint, time, date, date, integer, boolean, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.recurring_message_save(uuid, uuid, text, text, smallint[], smallint, time, date, date, integer, boolean, uuid, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Gerador: leva o anexo da regra para cada envio
-- -----------------------------------------------------------------------------
create or replace function public.materialize_recurring_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurring_messages%rowtype;
  v_contact record;
  v_sm uuid;
  v_next timestamptz;
  v_done boolean;
  v_count integer := 0;
begin
  for r in
    select * from public.recurring_messages
     where status = 'active' and next_run_at <= now()
     order by next_run_at
     limit 200
     for update skip locked
  loop
    begin
      select c.name, regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') as phone
        into v_contact
        from public.contacts c where c.id = r.contact_id;
      if v_contact.phone is null or v_contact.phone !~ '^\d{10,15}$' then
        raise exception 'Cliente sem telefone de WhatsApp válido.';
      end if;

      insert into public.scheduled_messages (
        clinic_id, created_by, name, message, scheduled_at, channel_connection_id,
        recurring_message_id, reply_window_days,
        media_url, media_mime_type, media_filename, media_kind
      )
      values (
        r.clinic_id, r.created_by,
        left('Mensagem para ' || coalesce(nullif(btrim(v_contact.name), ''), v_contact.phone), 120),
        r.message, r.next_run_at, r.channel_connection_id, r.id, 7,
        r.media_url, r.media_mime_type, r.media_filename, r.media_kind
      )
      returning id into v_sm;

      insert into public.scheduled_message_recipients (scheduled_message_id, position, contact_id, name, phone)
      values (v_sm, 1, r.contact_id, v_contact.name, v_contact.phone);

      -- Próximo a partir de agora: se o sistema ficou parado, não manda os
      -- atrasados todos de uma vez
      v_next := public.recurring_next_run(
        r.frequency, r.weekdays, r.month_day, r.send_time, r.timezone,
        r.starts_on, r.ends_on, greatest(now(), r.next_run_at)
      );
      v_done := r.frequency = 'once'
        or v_next is null
        or (r.max_runs is not null and r.run_count + 1 >= r.max_runs);

      update public.recurring_messages
         set run_count = run_count + 1,
             last_run_at = now(),
             last_error = null,
             next_run_at = case when v_done then null else v_next end,
             status = case when v_done then 'finished' else 'active' end,
             updated_at = now()
       where id = r.id;

      v_count := v_count + 1;
    exception when others then
      -- Ex.: plano sem o recurso, cliente sem telefone: pausa e mostra o motivo
      update public.recurring_messages
         set status = 'paused', last_error = left(sqlerrm, 300), updated_at = now()
       where id = r.id;
    end;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.materialize_recurring_messages() from public, anon, authenticated;
grant execute on function public.materialize_recurring_messages() to service_role;

-- -----------------------------------------------------------------------------
-- 4. Mensagem agendada no cartão do Funil: parâmetros do anexo
-- -----------------------------------------------------------------------------
drop function if exists public.deal_schedule_message(uuid, text, timestamptz, boolean, uuid);

create or replace function public.deal_schedule_message(
  p_deal_id uuid,
  p_message text,
  p_scheduled_at timestamptz,
  p_send_now boolean,
  p_channel_connection_id uuid,
  p_media_url text default null,
  p_media_mime_type text default null,
  p_media_filename text default null,
  p_media_kind text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_id uuid;
  v_message text := btrim(coalesce(p_message, ''));
  v_media_url text := nullif(btrim(coalesce(p_media_url, '')), '');
  v_media_filename text := nullif(btrim(coalesce(p_media_filename, '')), '');
begin
  select * into v_deal from public.deals where id = p_deal_id;
  if not found or not public.can_access_deal_row(v_deal.clinic_id, v_deal.owner_user_id) then
    raise exception 'Negociação não encontrada.';
  end if;

  perform public.scheduled_media_check(v_deal.clinic_id, v_media_url, p_media_kind, v_media_filename);

  if char_length(v_message) = 0 and v_media_url is null then
    raise exception 'Escreva a mensagem ou anexe um arquivo.';
  end if;

  -- scheduled_message_save exige texto (é a mesma função das campanhas): só
  -- com anexo, passa o nome do arquivo e apaga logo depois
  v_id := public.scheduled_message_save(
    null,
    coalesce(nullif(v_message, ''), v_media_filename, 'Arquivo'),
    p_scheduled_at,
    jsonb_build_array(jsonb_build_object('contact_id', v_deal.contact_id)),
    p_channel_connection_id,
    v_deal.title,
    coalesce(p_send_now, false),
    null,
    7
  );

  update public.scheduled_messages
     set deal_id = p_deal_id,
         message = v_message,
         media_url = v_media_url,
         media_mime_type = case when v_media_url is not null then nullif(btrim(coalesce(p_media_mime_type, '')), '') end,
         media_filename = case when v_media_url is not null then v_media_filename end,
         media_kind = case when v_media_url is not null then p_media_kind end
   where id = v_id;

  insert into public.deal_events (deal_id, clinic_id, user_id, type, note, payload)
  values (p_deal_id, v_deal.clinic_id, auth.uid(), 'message_scheduled',
    coalesce(nullif(v_message, ''), '📎 ' || coalesce(v_media_filename, 'Arquivo')),
    jsonb_build_object(
      'scheduled_message_id', v_id,
      'scheduled_at', (select scheduled_at from public.scheduled_messages where id = v_id),
      'media_filename', v_media_filename
    ));

  return v_id;
end;
$$;

revoke execute on function public.deal_schedule_message(uuid, text, timestamptz, boolean, uuid, text, text, text, text) from public, anon;
grant execute on function public.deal_schedule_message(uuid, text, timestamptz, boolean, uuid, text, text, text, text) to authenticated;

commit;
