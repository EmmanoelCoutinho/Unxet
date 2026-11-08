-- =============================================================================
-- Cargos personalizados com permissões
--
-- Administrador e Atendente continuam como cargos padrão (clinic_users.role).
-- A empresa pode criar cargos novos (clinic_roles) marcando permissões de uma
-- lista fixa da Unxet. Quem tem cargo personalizado fica com role = 'agent' e
-- role_id apontando para o cargo; apagar o cargo devolve a pessoa para
-- Atendente. Não existe permissão avulsa por pessoa.
--
-- Catálogo (o que um cargo pode ganhar além do Atendente):
--   conversations.all      ver e atender conversas de todos os departamentos
--   dashboard.view         Painel
--   quick_messages.manage  criar e editar mensagens rápidas
--   tags.manage            criar e editar etiquetas
--   contacts.view          Carteira de clientes (só tela; o banco já libera)
--   leads.all              negócios de toda a equipe no funil
--   campaigns.all          campanhas de toda a equipe
--   meta_templates.create  criar modelos da Meta (Atendente já tem)
--   bots.manage            bots
--   ai.manage              Assistente com IA
--   reports.view           Relatórios e exportações
--
-- Continua só do administrador: atendentes, cargos, departamentos,
-- configurações e integrações.
--
-- Administrador e Atendente sem cargo mantêm exatamente o acesso de antes.
--
-- Ordem de deploy: aplique ANTES das edge functions e do frontend.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Catálogo e cargos
-- -----------------------------------------------------------------------------
create or replace function public.clinic_permission_catalog()
returns text[]
language sql
immutable
as $$
  select array[
    'conversations.all',
    'dashboard.view',
    'quick_messages.manage',
    'tags.manage',
    'contacts.view',
    'leads.all',
    'campaigns.all',
    'meta_templates.create',
    'bots.manage',
    'ai.manage',
    'reports.view'
  ]::text[];
$$;

-- O que o Atendente (sem cargo personalizado) já pode hoje
create or replace function public.clinic_agent_default_permissions()
returns text[]
language sql
immutable
as $$
  select array['meta_templates.create']::text[];
$$;

create table if not exists public.clinic_roles (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_roles_name_length check (char_length(btrim(name)) between 1 and 40),
  -- Nomes dos cargos padrão ficam reservados
  constraint clinic_roles_name_reserved
    check (lower(btrim(name)) not in ('administrador', 'admin', 'atendente')),
  constraint clinic_roles_permissions_valid
    check (permissions <@ public.clinic_permission_catalog())
);

create unique index if not exists clinic_roles_clinic_name_uk
  on public.clinic_roles (clinic_id, lower(btrim(name)));

alter table public.clinic_roles enable row level security;

revoke all on public.clinic_roles from anon, authenticated;
grant select, insert, update, delete on public.clinic_roles to authenticated;

drop policy if exists clinic_roles_select on public.clinic_roles;
create policy clinic_roles_select on public.clinic_roles
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists clinic_roles_insert on public.clinic_roles;
create policy clinic_roles_insert on public.clinic_roles
  for insert to authenticated
  with check (public.is_clinic_admin_of(clinic_id));

drop policy if exists clinic_roles_update on public.clinic_roles;
create policy clinic_roles_update on public.clinic_roles
  for update to authenticated
  using (public.is_clinic_admin_of(clinic_id))
  with check (public.is_clinic_admin_of(clinic_id));

drop policy if exists clinic_roles_delete on public.clinic_roles;
create policy clinic_roles_delete on public.clinic_roles
  for delete to authenticated
  using (public.is_clinic_admin_of(clinic_id));

-- O cargo não troca de empresa
create or replace function public.clinic_roles_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.permissions := array(select distinct unnest(new.permissions) order by 1);
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.clinic_id is distinct from old.clinic_id then
    raise exception 'O cargo não pode mudar de empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clinic_roles_before_write on public.clinic_roles;
create trigger trg_clinic_roles_before_write
  before insert or update on public.clinic_roles
  for each row execute function public.clinic_roles_before_write();

-- -----------------------------------------------------------------------------
-- 2. Cargo de cada pessoa
-- -----------------------------------------------------------------------------
alter table public.clinic_users
  add column if not exists role_id uuid references public.clinic_roles(id) on delete set null;

create index if not exists clinic_users_role_id_idx on public.clinic_users (role_id)
  where role_id is not null;

-- Administrador não tem cargo personalizado; o cargo precisa ser da empresa
create or replace function public.clinic_users_role_id_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'admin' then
    new.role_id := null;
  end if;
  if new.role_id is not null and not exists (
    select 1 from public.clinic_roles r
    where r.id = new.role_id and r.clinic_id = new.clinic_id
  ) then
    raise exception 'Cargo não encontrado.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clinic_users_role_id_check on public.clinic_users;
create trigger trg_clinic_users_role_id_check
  before insert or update of role, role_id on public.clinic_users
  for each row execute function public.clinic_users_role_id_check();

-- -----------------------------------------------------------------------------
-- 3. Conferência de permissão
-- -----------------------------------------------------------------------------
-- A partir do papel e do cargo de uma linha de clinic_users (usada dentro de
-- consultas que já leram a linha, sem buscar de novo)
create or replace function public.clinic_member_has_permission(
  p_role text,
  p_role_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_role = 'admin'
    or (p_role_id is null and p_permission = any(public.clinic_agent_default_permissions()))
    or (
      p_role_id is not null
      and exists (
        select 1 from public.clinic_roles r
        where r.id = p_role_id and p_permission = any(r.permissions)
      )
    );
$$;

-- Quem está logado tem a permissão nesta empresa?
create or replace function public.has_clinic_permission(p_clinic_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.user_id = auth.uid()
      and cu.clinic_id = p_clinic_id
      and public.clinic_member_has_permission(cu.role, cu.role_id, p_permission)
  );
$$;

-- Para as edge functions (service role): a pessoa informada tem a permissão?
create or replace function public.clinic_user_has_permission(
  p_user_id uuid,
  p_clinic_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.user_id = p_user_id
      and cu.clinic_id = p_clinic_id
      and public.clinic_member_has_permission(cu.role, cu.role_id, p_permission)
  );
$$;

revoke execute on function public.clinic_member_has_permission(text, uuid, text) from public, anon;
revoke execute on function public.has_clinic_permission(uuid, text) from public, anon;
revoke execute on function public.clinic_user_has_permission(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.clinic_member_has_permission(text, uuid, text) to authenticated, service_role;
grant execute on function public.has_clinic_permission(uuid, text) to authenticated, service_role;
grant execute on function public.clinic_user_has_permission(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Regras das tabelas: admin -> permissão
-- -----------------------------------------------------------------------------
-- Mensagens rápidas
alter policy quick_messages_insert_admin_only on public.quick_messages
  with check (public.has_clinic_permission(clinic_id, 'quick_messages.manage'));
alter policy quick_messages_update_admin_only on public.quick_messages
  using (public.has_clinic_permission(clinic_id, 'quick_messages.manage'))
  with check (public.has_clinic_permission(clinic_id, 'quick_messages.manage'));
alter policy quick_messages_delete_admin_only on public.quick_messages
  using (public.has_clinic_permission(clinic_id, 'quick_messages.manage'));

-- Etiquetas
alter policy tags_insert_admin_only on public.tags
  with check (public.has_clinic_permission(clinic_id, 'tags.manage'));
alter policy tags_update_admin_only on public.tags
  using (public.has_clinic_permission(clinic_id, 'tags.manage'))
  with check (public.has_clinic_permission(clinic_id, 'tags.manage'));
alter policy tags_delete_admin_only on public.tags
  using (public.has_clinic_permission(clinic_id, 'tags.manage'));

-- Bots
alter policy bots_insert on public.bots
  with check (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy bots_update on public.bots
  using (public.has_clinic_permission(clinic_id, 'bots.manage'))
  with check (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy bots_delete on public.bots
  using (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy bot_nodes_insert on public.bot_nodes
  with check (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy bot_nodes_update on public.bot_nodes
  using (public.has_clinic_permission(clinic_id, 'bots.manage'))
  with check (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy bot_nodes_delete on public.bot_nodes
  using (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy bot_options_insert on public.bot_options
  with check (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy bot_options_update on public.bot_options
  using (public.has_clinic_permission(clinic_id, 'bots.manage'))
  with check (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy bot_options_delete on public.bot_options
  using (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy bot_channel_bindings_insert on public.bot_channel_bindings
  with check (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy bot_channel_bindings_update on public.bot_channel_bindings
  using (public.has_clinic_permission(clinic_id, 'bots.manage'))
  with check (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy bot_channel_bindings_delete on public.bot_channel_bindings
  using (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy conversation_bot_events_delete on public.conversation_bot_events
  using (public.has_clinic_permission(clinic_id, 'bots.manage'));
alter policy conversation_bot_sessions_delete on public.conversation_bot_sessions
  using (public.has_clinic_permission(clinic_id, 'bots.manage'));

-- Assistente com IA
alter policy clinic_ai_settings_select on public.clinic_ai_settings
  using (public.has_clinic_permission(clinic_id, 'ai.manage'));
alter policy clinic_ai_settings_insert on public.clinic_ai_settings
  with check (public.has_clinic_permission(clinic_id, 'ai.manage'));
alter policy clinic_ai_settings_update on public.clinic_ai_settings
  using (public.has_clinic_permission(clinic_id, 'ai.manage'))
  with check (public.has_clinic_permission(clinic_id, 'ai.manage'));
alter policy clinic_ai_usage_select on public.clinic_ai_usage
  using (public.has_clinic_permission(clinic_id, 'ai.manage'));

-- Funil: apagar negócio
alter policy deals_delete on public.deals
  using (public.has_clinic_permission(clinic_id, 'leads.all'));

-- -----------------------------------------------------------------------------
-- 5. Funções: admin -> permissão (corpo igual ao anterior, só muda o teste)
-- -----------------------------------------------------------------------------

-- can_access_conversation
CREATE OR REPLACE FUNCTION public.can_access_conversation(p_clinic_id uuid, p_department_id uuid, p_assigned_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.user_id = auth.uid()
      and cu.clinic_id = p_clinic_id
      and (
        public.clinic_member_has_permission(cu.role, cu.role_id, 'conversations.all')
        or p_assigned_user_id = auth.uid()
        or (
          p_assigned_user_id is null
          and (
            cu.department_id = p_department_id
            or exists (
              select 1
              from public.department_members dm
              where dm.department_id = p_department_id
                and dm.clinic_user_id = auth.uid()
            )
          )
        )
      )
  );
$function$;

-- user_can_access_conversation
CREATE OR REPLACE FUNCTION public.user_can_access_conversation(target_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1
    from public.conversations c
    where c.id = target_conversation_id
      and c.clinic_id = public.current_clinic_id()
      and (
        exists (
          select 1
          from public.clinic_users cu
          where cu.user_id = auth.uid()
            and cu.clinic_id = c.clinic_id
            and public.clinic_member_has_permission(cu.role, cu.role_id, 'conversations.all')
        )
        or c.assigned_user_id = auth.uid()
        or (
          c.assigned_user_id is null
          and exists (
            select 1
            from public.department_members dm
            where dm.department_id = c.department_id
              and dm.clinic_user_id = auth.uid()
          )
        )
      )
  );
$function$;

-- can_access_deal_row
CREATE OR REPLACE FUNCTION public.can_access_deal_row(p_clinic_id uuid, p_owner_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.user_id = auth.uid()
      and cu.clinic_id = p_clinic_id
      and (
        public.clinic_member_has_permission(cu.role, cu.role_id, 'leads.all')
        or p_owner_user_id is null
        or p_owner_user_id = auth.uid()
      )
  );
$function$;

-- deals_before_write
CREATE OR REPLACE FUNCTION public.deals_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_stage record;
  v_is_admin boolean;
begin
  select s.pipeline_id, s.kind, s.clinic_id
    into v_stage
    from public.pipeline_stages s
   where s.id = new.stage_id;

  if v_stage.pipeline_id is null then
    raise exception 'Etapa não encontrada.';
  end if;

  -- O funil vem da etapa (mudar de etapa pode mudar de funil)
  new.pipeline_id := v_stage.pipeline_id;

  if tg_op = 'INSERT' then
    new.clinic_id := v_stage.clinic_id;
    new.created_by := coalesce(new.created_by, v_uid);
    new.created_at := now();
  elsif new.clinic_id is distinct from old.clinic_id then
    raise exception 'A negociação não pode mudar de empresa.';
  end if;

  if v_stage.clinic_id <> new.clinic_id then
    raise exception 'Etapa não encontrada.';
  end if;

  if not exists (
    select 1 from public.contacts c
    where c.id = new.contact_id and c.clinic_id = new.clinic_id
  ) then
    raise exception 'Cliente não encontrado na carteira.';
  end if;

  if new.owner_user_id is not null and not exists (
    select 1 from public.clinic_users cu
    where cu.user_id = new.owner_user_id and cu.clinic_id = new.clinic_id
  ) then
    raise exception 'Responsável não faz parte da empresa.';
  end if;

  -- Atendente: só pega para si ou deixa sem responsável
  if v_uid is not null
     and (tg_op = 'INSERT' or new.owner_user_id is distinct from old.owner_user_id)
     and new.owner_user_id is not null
     and new.owner_user_id <> v_uid then
    select exists (
      select 1 from public.clinic_users cu
      where cu.user_id = v_uid and cu.clinic_id = new.clinic_id and public.clinic_member_has_permission(cu.role, cu.role_id, 'leads.all')
    ) into v_is_admin;
    if not v_is_admin then
      raise exception 'Você não tem permissão para passar a negociação para outra pessoa.';
    end if;
  end if;

  if new.lost_reason_id is not null and not exists (
    select 1 from public.deal_loss_reasons lr
    where lr.id = new.lost_reason_id and lr.clinic_id = new.clinic_id
  ) then
    raise exception 'Motivo de perda não encontrado.';
  end if;

  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
  end if;

  new.status := v_stage.kind;
  if v_stage.kind = 'open' then
    new.closed_at := null;
  elsif tg_op = 'INSERT' or old.status is distinct from v_stage.kind then
    new.closed_at := now();
  end if;
  if v_stage.kind <> 'lost' then
    new.lost_reason_id := null;
    new.lost_note := null;
  end if;

  new.title := btrim(new.title);
  new.updated_at := now();
  return new;
end;
$function$;

-- can_access_scheduled_message
CREATE OR REPLACE FUNCTION public.can_access_scheduled_message(p_clinic_id uuid, p_created_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.user_id = auth.uid()
      and cu.clinic_id = p_clinic_id
      and (public.clinic_member_has_permission(cu.role, cu.role_id, 'campaigns.all') or p_created_by = auth.uid())
  );
$function$;

-- scheduled_message_save
CREATE OR REPLACE FUNCTION public.scheduled_message_save(p_id uuid, p_message text, p_scheduled_at timestamp with time zone, p_recipients jsonb, p_channel_connection_id uuid, p_name text, p_send_now boolean, p_conversion_tag_id uuid, p_reply_window_days integer, p_template_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       or not (public.has_clinic_permission(v_clinic_id, 'campaigns.all') or v_current.created_by = v_user_id) then
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
$function$;

-- recurring_message_save
CREATE OR REPLACE FUNCTION public.recurring_message_save(p_id uuid, p_contact_id uuid, p_message text, p_frequency text, p_weekdays smallint[], p_month_day smallint, p_send_time time without time zone, p_starts_on date, p_ends_on date, p_max_runs integer, p_send_now boolean, p_channel_connection_id uuid, p_timezone text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if char_length(v_message) = 0 then
    raise exception 'Escreva a mensagem.';
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
      weekdays, month_day, send_time, timezone, starts_on, ends_on, max_runs, next_run_at
    )
    values (
      v_clinic_id, p_contact_id, v_user_id, v_message, p_channel_connection_id, p_frequency,
      v_weekdays, case when p_frequency = 'monthly' then p_month_day end, v_send_time, v_tz,
      v_starts_on, case when p_frequency = 'once' then null else p_ends_on end,
      case when p_frequency = 'once' then null else p_max_runs end, v_next
    )
    returning id into v_id;
  else
    select * into v_current from public.recurring_messages where id = p_id for update;
    if not found
       or v_current.clinic_id <> v_clinic_id
       or not (public.has_clinic_permission(v_clinic_id, 'campaigns.all') or v_current.created_by = v_user_id) then
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
$function$;

-- operational_now
CREATE OR REPLACE FUNCTION public.operational_now(p_clinic_id uuid, p_channels text[] DEFAULT NULL::text[], p_department_id uuid DEFAULT NULL::uuid, p_timezone text DEFAULT 'America/Sao_Paulo'::text, p_online_window_seconds integer DEFAULT 150)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text;
  v_sla_sec integer;
  v_now timestamptz := now();
  v_today_start timestamptz;
  v_online_since timestamptz;
  v_result jsonb;
begin
  if auth.uid() is null or not public.has_clinic_permission(p_clinic_id, 'dashboard.view') then
    raise exception 'Não autorizado';
  end if;

  if not public.clinic_has_feature(p_clinic_id, 'analytics') then
    raise exception 'Recurso fora do plano';
  end if;

  select tz.name into v_tz from pg_timezone_names tz where tz.name = p_timezone;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select s.sla_first_response_after_minutes * 60
    into v_sla_sec
  from public.conversation_automation_settings s
  where s.clinic_id = p_clinic_id
    and s.sla_first_response_enabled = true
    and s.sla_first_response_after_minutes is not null;
  v_sla_sec := coalesce(v_sla_sec, 120);

  -- Meia-noite de hoje no fuso de quem está olhando
  v_today_start := ((v_now at time zone v_tz)::date)::timestamp at time zone v_tz;
  v_online_since := v_now - make_interval(secs => greatest(30, least(coalesce(p_online_window_seconds, 150), 900)));

  with active as materialized (
    select
      c.id,
      c.status::text as status,
      c.assigned_user_id,
      c.in_bot_flow,
      c.first_unanswered_inbound_at,
      lm.direction::text as last_direction,
      lm.created_at as last_at,
      -- mesma regra do inbox_backlog: violação referente à espera atual
      (
        c.sla_breached_at is not null
        and c.first_unanswered_inbound_at is not null
        and c.sla_breached_at >= c.first_unanswered_inbound_at
      ) as breached
    from public.conversations c
    cross join lateral (
      select m.direction, m.created_at
      from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc
      limit 1
    ) lm
    where c.clinic_id = p_clinic_id
      and c.status in ('open', 'pending')
      and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
      and (p_department_id is null or c.department_id = p_department_id)
  ),
  waiting as (
    select * from active where last_direction = 'inbound'
  ),
  team as (
    select
      cu.user_id,
      coalesce(nullif(btrim(cu.name), ''), cu.email, 'Sem nome') as name,
      cu.role,
      up.last_seen_at
    from public.clinic_users cu
    left join public.user_presence up on up.user_id = cu.user_id
    where cu.clinic_id = p_clinic_id
  ),
  inbound_today as (
    select extract(hour from (m.created_at at time zone v_tz))::int as hour, count(*)::int as n
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where c.clinic_id = p_clinic_id
      and m.direction = 'inbound'
      and m.created_at >= v_today_start
      and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
      and (p_department_id is null or c.department_id = p_department_id)
    group by 1
  )
  select jsonb_build_object(
    'generatedAt', v_now,
    'todayStart', v_today_start,
    'slaThresholdSec', v_sla_sec,
    'now', jsonb_build_object(
      'active', (select count(*) from active),
      'open', (select count(*) from active where status = 'open'),
      'pending', (select count(*) from active where status = 'pending' and not in_bot_flow),
      'inBot', (select count(*) from active where in_bot_flow),
      'unassigned', (select count(*) from active where assigned_user_id is null and not in_bot_flow),
      'waiting', (select count(*) from waiting),
      'slaBreached', (select count(*) from waiting where breached),
      'oldestWaitingAt', (select min(last_at) from waiting),
      'teamTotal', (select count(*) from team),
      'teamOnline', (select count(*) from team where last_seen_at >= v_online_since)
    ),
    -- Mesmo cálculo dos relatórios: hoje até agora e ontem até este mesmo horário
    'today', public.report_period_kpis(p_clinic_id, v_today_start, v_now, p_channels, p_department_id, null, v_sla_sec),
    'yesterdaySoFar', public.report_period_kpis(
      p_clinic_id, v_today_start - interval '1 day', v_now - interval '1 day', p_channels, p_department_id, null, v_sla_sec
    ),
    'inboundByHourToday', (
      select jsonb_agg(coalesce(i.n, 0) order by g.hour)
      from generate_series(0, 23) as g(hour)
      left join inbound_today i on i.hour = g.hour
    ),
    'team', (
      select coalesce(jsonb_agg(row_data order by (row_data->>'online')::boolean desc, (row_data->>'waiting')::int desc, row_data->>'name'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'userId', t.user_id,
          'name', t.name,
          'role', t.role,
          'lastSeenAt', t.last_seen_at,
          'online', coalesce(t.last_seen_at >= v_online_since, false),
          'active', (select count(*) from active a where a.assigned_user_id = t.user_id),
          'waiting', (select count(*) from waiting w where w.assigned_user_id = t.user_id),
          'slaBreached', (select count(*) from waiting w where w.assigned_user_id = t.user_id and w.breached),
          'oldestWaitingAt', (select min(w.last_at) from waiting w where w.assigned_user_id = t.user_id),
          'closedToday', (
            select count(*) from public.conversations c
            where c.clinic_id = p_clinic_id
              and c.assigned_user_id = t.user_id
              and c.closed_at >= v_today_start
              and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
              and (p_department_id is null or c.department_id = p_department_id)
          )
        ) as row_data
        from team t
      ) rows
    )
  )
  into v_result;

  return v_result;
end;
$function$;

-- operational_report
CREATE OR REPLACE FUNCTION public.operational_report(p_clinic_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_channels text[] DEFAULT NULL::text[], p_department_id uuid DEFAULT NULL::uuid, p_assigned_user_id uuid DEFAULT NULL::uuid, p_timezone text DEFAULT 'America/Sao_Paulo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text;
  v_sla_sec integer;
  v_prev_start timestamptz;
  v_result jsonb;
begin
  if auth.uid() is null or not public.has_clinic_permission(p_clinic_id, 'reports.view') then
    raise exception 'Não autorizado';
  end if;

  if not public.clinic_has_feature(p_clinic_id, 'analytics') then
    raise exception 'Recurso fora do plano';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Período inválido';
  end if;

  if p_end - p_start > interval '400 days' then
    raise exception 'Período máximo de 400 dias';
  end if;

  select tz.name into v_tz from pg_timezone_names tz where tz.name = p_timezone;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select s.sla_first_response_after_minutes * 60
    into v_sla_sec
  from public.conversation_automation_settings s
  where s.clinic_id = p_clinic_id
    and s.sla_first_response_enabled = true
    and s.sla_first_response_after_minutes is not null;
  v_sla_sec := coalesce(v_sla_sec, 120);

  -- Período anterior de mesmo tamanho, para a comparação do resumo
  v_prev_start := p_start - (p_end - p_start);

  with scope as materialized (
    select
      c.id,
      c.contact_id,
      c.channel::text as channel,
      c.department_id,
      c.assigned_user_id,
      c.created_at,
      c.closed_at
    from public.conversations c
    where c.clinic_id = p_clinic_id
      and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
      and (p_department_id is null or c.department_id = p_department_id)
      and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
  ),
  leads as materialized (
    select * from scope s where s.created_at >= p_start and s.created_at < p_end
  ),
  msgs as materialized (
    select m.conversation_id, m.direction::text as direction, m.is_automated, m.created_at
    from public.messages m
    join scope s on s.id = m.conversation_id
    where m.created_at >= p_start and m.created_at < p_end
  ),
  first_response as materialized (
    select
      l.id as conversation_id,
      l.channel,
      l.department_id,
      l.assigned_user_id,
      l.contact_id,
      fi.at as first_inbound_at,
      fo.at as first_outbound_at,
      case when fo.at is null then null
           else extract(epoch from (fo.at - fi.at))::numeric end as seconds
    from leads l
    cross join lateral (
      select min(m.created_at) as at
      from public.messages m
      where m.conversation_id = l.id and m.direction = 'inbound'
    ) fi
    cross join lateral (
      select min(m.created_at) as at
      from public.messages m
      where m.conversation_id = l.id
        and m.direction = 'outbound'
        and m.is_automated = false
        and m.created_at >= fi.at
    ) fo
    where fi.at is not null
  ),
  answered as materialized (
    select * from first_response where seconds is not null
  ),
  resolution as materialized (
    select
      s.assigned_user_id,
      extract(epoch from (s.closed_at - s.created_at))::numeric as seconds
    from scope s
    where s.closed_at >= p_start and s.closed_at < p_end and s.created_at is not null
  ),
  surveys as materialized (
    select ss.*
    from public.satisfaction_surveys ss
    where ss.clinic_id = p_clinic_id
      and ss.sent_at >= p_start and ss.sent_at < p_end
      and ss.status <> 'failed'
      and (coalesce(cardinality(p_channels), 0) = 0 or ss.channel = any (p_channels))
      and (p_department_id is null or ss.department_id = p_department_id)
      and (p_assigned_user_id is null or ss.agent_user_id = p_assigned_user_id)
  ),
  team as (
    select cu.user_id, cu.name, cu.role, cu.email
    from public.clinic_users cu
    where cu.clinic_id = p_clinic_id
      and (p_assigned_user_id is null or cu.user_id = p_assigned_user_id)
  )
  select jsonb_build_object(
    'slaThresholdSec', v_sla_sec,
    'timezone', v_tz,
    'summary', jsonb_build_object(
      'current', public.report_period_kpis(p_clinic_id, p_start, p_end, p_channels, p_department_id, p_assigned_user_id, v_sla_sec),
      'previous', public.report_period_kpis(p_clinic_id, v_prev_start, p_start, p_channels, p_department_id, p_assigned_user_id, v_sla_sec),
      'previousStart', v_prev_start,
      'previousEnd', p_start,
      'activeNow', (
        select count(*) from public.conversations c
        where c.clinic_id = p_clinic_id
          and c.status in ('open', 'pending')
          and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
          and (p_department_id is null or c.department_id = p_department_id)
          and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      )
    ),
    'leadsByChannel', (
      select coalesce(jsonb_agg(jsonb_build_object('channel', x.channel, 'leads', x.n) order by x.n desc), '[]'::jsonb)
      from (select channel, count(*) as n from leads group by channel) x
    ),
    'leadsByDepartment', (
      select coalesce(jsonb_agg(jsonb_build_object('department', x.name, 'leads', x.n) order by x.n desc, x.name), '[]'::jsonb)
      from (
        select coalesce(d.name, 'Sem departamento') as name, count(*) as n
        from leads l left join public.departments d on d.id = l.department_id
        group by 1
      ) x
    ),
    'team', (
      select coalesce(jsonb_agg(row_data order by (row_data->>'conversations')::int desc, row_data->>'name'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'userId', t.user_id,
          'name', coalesce(nullif(btrim(t.name), ''), t.email, 'Sem nome'),
          'role', t.role,
          'lastSeenAt', (select up.last_seen_at from public.user_presence up where up.user_id = t.user_id),
          'conversations', (
            select count(*) from scope s
            where s.assigned_user_id = t.user_id
              and (
                (s.created_at >= p_start and s.created_at < p_end)
                or exists (select 1 from msgs m where m.conversation_id = s.id)
              )
          ),
          'closed', (select count(*) from resolution r where r.assigned_user_id = t.user_id),
          'outboundMessages', (
            select count(*) from msgs m
            join scope s on s.id = m.conversation_id
            where s.assigned_user_id = t.user_id
              and m.direction = 'outbound' and not m.is_automated
          ),
          'p50FirstResponseSec', (
            select round(percentile_cont(0.5) within group (order by a.seconds)::numeric, 1)
            from answered a where a.assigned_user_id = t.user_id
          ),
          'withinSlaPct', (
            select round(100.0 * count(*) filter (where a.seconds <= v_sla_sec) / nullif(count(*), 0), 1)
            from answered a where a.assigned_user_id = t.user_id
          ),
          'p50ResolutionSec', (
            select round(percentile_cont(0.5) within group (order by r.seconds)::numeric, 1)
            from resolution r where r.assigned_user_id = t.user_id
          ),
          'surveysAnswered', (
            select count(*) from surveys sv
            where sv.agent_user_id = t.user_id and sv.status = 'answered'
          ),
          'averageScore', (
            select round(avg(sv.score)::numeric, 2) from surveys sv
            where sv.agent_user_id = t.user_id and sv.status = 'answered'
          )
        ) as row_data
        from team t
      ) rows
    ),
    'sla', jsonb_build_object(
      'byChannel', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'label', x.channel, 'count', x.n, 'p50Sec', x.p50, 'p90Sec', x.p90, 'withinSlaPct', x.within
        ) order by x.n desc), '[]'::jsonb)
        from (
          select a.channel, count(*) as n,
            round(percentile_cont(0.5) within group (order by a.seconds)::numeric, 1) as p50,
            round(percentile_cont(0.9) within group (order by a.seconds)::numeric, 1) as p90,
            round(100.0 * count(*) filter (where a.seconds <= v_sla_sec) / nullif(count(*), 0), 1) as within
          from answered a group by a.channel
        ) x
      ),
      'byDepartment', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'label', x.name, 'count', x.n, 'p50Sec', x.p50, 'p90Sec', x.p90, 'withinSlaPct', x.within
        ) order by x.n desc), '[]'::jsonb)
        from (
          select coalesce(d.name, 'Sem departamento') as name, count(*) as n,
            round(percentile_cont(0.5) within group (order by a.seconds)::numeric, 1) as p50,
            round(percentile_cont(0.9) within group (order by a.seconds)::numeric, 1) as p90,
            round(100.0 * count(*) filter (where a.seconds <= v_sla_sec) / nullif(count(*), 0), 1) as within
          from answered a left join public.departments d on d.id = a.department_id
          group by 1
        ) x
      ),
      -- Quanto o cliente esperou pela 1ª resposta humana
      'buckets', (
        select jsonb_agg(jsonb_build_object('label', b.label, 'count', (
          select count(*) from answered a
          where a.seconds >= b.min_sec and (b.max_sec is null or a.seconds < b.max_sec)
        )) order by b.ord)
        from (values
          (1, 'Até 1 min', 0, 60),
          (2, '1 a 5 min', 60, 300),
          (3, '5 a 15 min', 300, 900),
          (4, '15 a 60 min', 900, 3600),
          (5, '1 a 4 h', 3600, 14400),
          (6, 'Mais de 4 h', 14400, null)
        ) as b(ord, label, min_sec, max_sec)
      ),
      -- Mensagens recebidas por dia da semana (1 = segunda) e hora
      'heatmap', (
        select coalesce(jsonb_agg(jsonb_build_object('weekday', h.wd, 'hour', h.hr, 'messages', h.n)), '[]'::jsonb)
        from (
          select
            extract(isodow from (m.created_at at time zone v_tz))::int as wd,
            extract(hour from (m.created_at at time zone v_tz))::int as hr,
            count(*)::int as n
          from msgs m
          where m.direction = 'inbound'
          group by 1, 2
        ) h
      ),
      -- Conversas que mais demoraram (ou ainda não tiveram) a 1ª resposta
      'slowest', (
        select coalesce(jsonb_agg(row_data order by ord), '[]'::jsonb)
        from (
          select
            row_number() over (order by fr.seconds desc nulls first, fr.first_inbound_at) as ord,
            jsonb_build_object(
              'conversationId', fr.conversation_id,
              'contact', coalesce(nullif(btrim(ct.name), ''), ct.phone, 'Contato sem nome'),
              'channel', fr.channel,
              'department', coalesce(d.name, 'Sem departamento'),
              'assignedTo', coalesce(nullif(btrim(cu.name), ''), 'Não atribuído'),
              'firstInboundAt', fr.first_inbound_at,
              'seconds', fr.seconds
            ) as row_data
          from first_response fr
          left join public.contacts ct on ct.id = fr.contact_id
          left join public.departments d on d.id = fr.department_id
          left join public.clinic_users cu
            on cu.user_id = fr.assigned_user_id and cu.clinic_id = p_clinic_id
          where fr.seconds is null or fr.seconds > v_sla_sec
          order by fr.seconds desc nulls first, fr.first_inbound_at
          limit 20
        ) x
      )
    ),
    'satisfaction', jsonb_build_object(
      'distribution', (
        select jsonb_agg(jsonb_build_object('score', g, 'count', (
          select count(*) from surveys sv where sv.status = 'answered' and sv.score = g
        )) order by g)
        from generate_series(1, 5) g
      ),
      'byStatus', (
        select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
        from (select status, count(*) as n from surveys group by status) x
      ),
      'byDepartment', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'label', x.name, 'answered', x.n, 'averageScore', x.avg_score
        ) order by x.avg_score desc nulls last, x.n desc), '[]'::jsonb)
        from (
          select coalesce(d.name, 'Sem departamento') as name, count(*) as n,
            round(avg(sv.score)::numeric, 2) as avg_score
          from surveys sv left join public.departments d on d.id = sv.department_id
          where sv.status = 'answered'
          group by 1
        ) x
      ),
      -- Notas 1 e 2, as mais recentes primeiro, para investigar
      'lowScores', (
        select coalesce(jsonb_agg(row_data order by at desc), '[]'::jsonb)
        from (
          select sv.answered_at as at, jsonb_build_object(
            'answeredAt', sv.answered_at,
            'score', sv.score,
            'comment', nullif(btrim(sv.raw_answer), ''),
            'contact', coalesce(nullif(btrim(ct.name), ''), ct.phone, 'Contato sem nome'),
            'agent', coalesce(nullif(btrim(cu.name), ''), 'Não atribuído'),
            'department', coalesce(d.name, 'Sem departamento')
          ) as row_data
          from surveys sv
          left join public.contacts ct on ct.id = sv.contact_id
          left join public.departments d on d.id = sv.department_id
          left join public.clinic_users cu
            on cu.user_id = sv.agent_user_id and cu.clinic_id = p_clinic_id
          where sv.status = 'answered' and sv.score <= 2
          order by sv.answered_at desc
          limit 30
        ) x
      )
    )
  )
  into v_result;

  -- Série diária: conversas novas e finalizadas por dia (no fuso de quem vê)
  v_result := v_result || jsonb_build_object('daily', (
    with days as (
      select g::date as day
      from generate_series(
        (p_start at time zone v_tz)::date,
        ((p_end - interval '1 second') at time zone v_tz)::date,
        interval '1 day'
      ) g
    ),
    created as (
      select (c.created_at at time zone v_tz)::date as day, count(*) as n
      from public.conversations c
      where c.clinic_id = p_clinic_id
        and c.created_at >= p_start and c.created_at < p_end
        and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
        and (p_department_id is null or c.department_id = p_department_id)
        and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      group by 1
    ),
    closed as (
      select (c.closed_at at time zone v_tz)::date as day, count(*) as n
      from public.conversations c
      where c.clinic_id = p_clinic_id
        and c.closed_at >= p_start and c.closed_at < p_end
        and (coalesce(cardinality(p_channels), 0) = 0 or c.channel::text = any (p_channels))
        and (p_department_id is null or c.department_id = p_department_id)
        and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'day', d.day,
      'leads', coalesce(cr.n, 0),
      'closed', coalesce(cl.n, 0)
    ) order by d.day), '[]'::jsonb)
    from days d
    left join created cr on cr.day = d.day
    left join closed cl on cl.day = d.day
  ));

  return v_result;
end;
$function$;

-- list_report_exports
CREATE OR REPLACE FUNCTION public.list_report_exports(p_clinic_id uuid, p_limit integer DEFAULT 20)
 RETURNS SETOF report_exports
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.has_clinic_permission(p_clinic_id, 'reports.view') then
    raise exception 'Não autorizado';
  end if;

  return query
  select * from public.report_exports re
  where re.clinic_id = p_clinic_id
  order by re.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$function$;

-- register_report_export
CREATE OR REPLACE FUNCTION public.register_report_export(p_clinic_id uuid, p_report_type text, p_format text, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_filters jsonb, p_data_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text;
  v_name text;
  v_row public.report_exports;
begin
  if auth.uid() is null or not public.has_clinic_permission(p_clinic_id, 'reports.view') then
    raise exception 'Não autorizado';
  end if;

  if not public.clinic_has_feature(p_clinic_id, 'analytics') then
    raise exception 'Recurso fora do plano';
  end if;

  select coalesce(nullif(btrim(cu.name), ''), cu.email, 'Administrador')
    into v_name
  from public.clinic_users cu
  where cu.clinic_id = p_clinic_id and cu.user_id = auth.uid();

  -- UNX-XXXX-XXXX (sem 0/O e 1/I para não confundir ao digitar)
  loop
    select 'UNX-' || string_agg(
             case when i = 5 then '-' else
               substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::int, 1)
             end, '' order by i)
      into v_code
    from generate_series(1, 9) i;

    exit when not exists (select 1 from public.report_exports where code = v_code);
  end loop;

  insert into public.report_exports (
    code, clinic_id, generated_by, generated_by_name, report_type, format,
    period_start, period_end, filters, data_hash
  ) values (
    v_code, p_clinic_id, auth.uid(), v_name, p_report_type, p_format,
    p_period_start, p_period_end, coalesce(p_filters, '{}'::jsonb), lower(p_data_hash)
  )
  returning * into v_row;

  return jsonb_build_object(
    'code', v_row.code,
    'createdAt', v_row.created_at,
    'generatedByName', v_row.generated_by_name
  );
end;
$function$;

-- verify_report_export
CREATE OR REPLACE FUNCTION public.verify_report_export(p_clinic_id uuid, p_code text)
 RETURNS SETOF report_exports
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.has_clinic_permission(p_clinic_id, 'reports.view') then
    raise exception 'Não autorizado';
  end if;

  return query
  select * from public.report_exports re
  where re.clinic_id = p_clinic_id
    and re.code = upper(btrim(p_code));
end;
$function$;

-- prevent_clinic_user_privilege_change
CREATE OR REPLACE FUNCTION public.prevent_clinic_user_privilege_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
begin
  -- service role / jobs internos não têm auth.uid()
  if auth.uid() is null then
    return new;
  end if;

  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'clinic_id não pode ser alterado';
  end if;

  if new.role is distinct from old.role
     or new.role_id is distinct from old.role_id
     or new.department_id is distinct from old.department_id then
    select exists (
      select 1
      from public.clinic_users cu
      where cu.user_id = auth.uid()
        and cu.clinic_id = old.clinic_id
        and cu.role = 'admin'
    ) into v_is_admin;

    if not v_is_admin then
      if new.role is distinct from old.role
         or new.role_id is distinct from old.role_id then
        raise exception 'Apenas administradores podem alterar o papel';
      end if;
      raise exception 'Apenas administradores podem alterar o setor';
    end if;
  end if;

  return new;
end;
$function$;

commit;
