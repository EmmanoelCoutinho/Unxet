-- =============================================================================
-- Modelos de mensagem da Meta nas Campanhas (WhatsApp oficial)
--
-- Pelo WhatsApp oficial, a empresa só pode puxar conversa com um modelo
-- aprovado pela Meta. A empresa cria o modelo dentro de Campanhas, a Unxet
-- envia para a Meta (edge function whatsapp-templates), o status volta pelo
-- webhook (meta-webhook) ou pela sincronização da tela, e só um modelo
-- aprovado pode ser usado numa campanha pelo número oficial.
--
--   message_templates            já existia (esquema antigo, nunca usado de
--                                verdade): ganha o vínculo com o número
--                                oficial e passa a ser só leitura para o app
--   scheduled_messages.template_id  modelo usado pela campanha
--   scheduled_message_save       nova versão (10 parâmetros) aceita o número
--                                oficial e exige um modelo aprovado
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Modelos
-- -----------------------------------------------------------------------------
alter table public.message_templates
  add column if not exists channel_connection_id uuid
    references public.channel_connections (id) on delete set null;

create index if not exists message_templates_clinic_idx
  on public.message_templates (clinic_id, created_at desc);

-- O status que chega da Meta procura o modelo pelo id dela
create index if not exists message_templates_meta_id_idx
  on public.message_templates (meta_template_id)
  where meta_template_id is not null;

-- Só a edge function (service role) cria, altera e apaga: ela fala com a Meta
-- antes. O app só lê os modelos da própria empresa.
revoke all on public.message_templates from anon, authenticated;
grant select on public.message_templates to authenticated;

alter table public.message_templates enable row level security;

drop policy if exists "clinic users can manage templates" on public.message_templates;
drop policy if exists message_templates_select on public.message_templates;
create policy message_templates_select on public.message_templates
  for select to authenticated
  using (
    clinic_id in (
      select cu.clinic_id from public.clinic_users cu where cu.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 2. Campanha com modelo
-- -----------------------------------------------------------------------------
alter table public.scheduled_messages
  add column if not exists template_id uuid
    references public.message_templates (id) on delete set null;

create index if not exists scheduled_messages_template_idx
  on public.scheduled_messages (template_id)
  where template_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Salvar campanha: número oficial + modelo aprovado
--
-- Pelo número oficial o texto da campanha é o corpo do modelo (o que a Meta
-- aprovou), não o que veio da tela. Pelo QR Code nada muda.
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
  p_reply_window_days integer,
  p_template_id uuid
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
  v_provider text;
  v_template public.message_templates%rowtype;
  v_template_id uuid;
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

  if p_channel_connection_id is not null then
    select cc.provider
      into v_provider
      from public.channel_connections cc
     where cc.id = p_channel_connection_id
       and cc.clinic_id = v_clinic_id
       and cc.provider in ('evolution', 'meta')
       and cc.channel = 'whatsapp'
       and cc.archived_at is null;

    if v_provider is null then
      raise exception 'Número de WhatsApp não encontrado.';
    end if;
  end if;

  if v_provider = 'meta' then
    if p_template_id is null then
      raise exception 'Escolha um modelo aprovado pela Meta.';
    end if;

    select *
      into v_template
      from public.message_templates t
     where t.id = p_template_id
       and t.clinic_id = v_clinic_id;

    if not found then
      raise exception 'Modelo não encontrado.';
    end if;
    if v_template.status <> 'approved' then
      raise exception 'O modelo "%" ainda não foi aprovado pela Meta.', v_template.name;
    end if;
    if v_template.channel_connection_id is not null
       and v_template.channel_connection_id <> p_channel_connection_id then
      raise exception 'Este modelo é de outro número de WhatsApp.';
    end if;

    v_template_id := v_template.id;
    v_message := btrim(v_template.body);
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
      conversion_tag_id, reply_window_days, template_id
    )
    values (
      v_clinic_id, v_user_id, v_name, v_message, v_scheduled_at, p_channel_connection_id,
      p_conversion_tag_id, v_window, v_template_id
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
           template_id = v_template_id,
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

revoke execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb, uuid, text, boolean, uuid, integer, uuid) from public, anon;
grant execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb, uuid, text, boolean, uuid, integer, uuid) to authenticated;

-- Versão de 9 parâmetros (frontend publicado antes desta entrega): mesma
-- regra, mantendo o modelo de uma campanha que já tinha
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
  v_template_id uuid;
begin
  if p_id is not null then
    select sm.template_id into v_template_id from public.scheduled_messages sm where sm.id = p_id;
  end if;

  return public.scheduled_message_save(
    p_id,
    p_message,
    p_scheduled_at,
    p_recipients,
    p_channel_connection_id,
    p_name,
    p_send_now,
    p_conversion_tag_id,
    p_reply_window_days,
    v_template_id
  );
end;
$$;

revoke execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb, uuid, text, boolean, uuid, integer) from public, anon;
grant execute on function public.scheduled_message_save(uuid, text, timestamptz, jsonb, uuid, text, boolean, uuid, integer) to authenticated;

commit;
