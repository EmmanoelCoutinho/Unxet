-- =============================================================================
-- Funil de vendas (Kanban de negociações)
--
--   pipelines            funis da empresa (ex.: "Funil de vendas", "Pós-venda")
--   pipeline_stages      etapas de cada funil; kind = open | won | lost
--   deals                negociação: um cartão ligado a um cliente (contacts).
--                        Um cliente pode ter mais de uma.
--   deal_events          histórico do cartão (criação, etapa, valor, responsável,
--                        notas, tarefas concluídas, mensagens agendadas)
--   deal_tasks           tarefas com data/hora e lembrete por push
--   deal_tags            etiquetas do cartão (mesmas etiquetas da empresa)
--   deal_loss_reasons    motivos de perda configuráveis
--
-- Quem vê: o admin vê tudo; o atendente vê as negociações dele e as sem
-- responsável (mesma ideia das conversas). Atendente só passa a negociação
-- para si mesmo ou a deixa sem responsável; só o admin atribui a outra pessoa.
-- Configurar funis, etapas e motivos de perda é só do admin.
--
-- Plano: mesmo recurso das Campanhas ("scheduled_messages").
--
-- Também:
--   - scheduled_messages.deal_id: mensagem agendada de um cliente só, feita
--     pelo cartão (não aparece na lista de Campanhas)
--   - campanhas: "Aderiu" move para Ganho a negociação que veio da campanha,
--     e campaign_to_deals leva quem respondeu para o funil
--   - lembretes: pg_cron chama a edge function deal-task-reminders a cada
--     minuto, só quando há tarefa vencendo
--
-- Ordem de deploy: depois da 20261025000000_campaigns. Aplique antes de
-- publicar a edge function deal-task-reminders e o frontend.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Tabelas
-- -----------------------------------------------------------------------------
create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pipelines_clinic_idx on public.pipelines (clinic_id, position);

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  position integer not null default 0,
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  created_at timestamptz not null default now()
);

create index if not exists pipeline_stages_pipeline_idx
  on public.pipeline_stages (pipeline_id, position);

create table if not exists public.deal_loss_reasons (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists deal_loss_reasons_clinic_idx
  on public.deal_loss_reasons (clinic_id, position);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- Etapa e funil não podem sumir com cartões dentro (a tela pede para mover antes)
  pipeline_id uuid not null references public.pipelines (id) on delete restrict,
  stage_id uuid not null references public.pipeline_stages (id) on delete restrict,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  value numeric(12, 2) check (value is null or value >= 0),
  owner_user_id uuid references auth.users (id) on delete set null,
  source text not null default 'manual'
    check (source in ('manual', 'conversation', 'campaign')),
  source_conversation_id uuid references public.conversations (id) on delete set null,
  source_campaign_id uuid references public.scheduled_messages (id) on delete set null,
  -- Copiado do tipo da etapa pelo gatilho
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  lost_reason_id uuid references public.deal_loss_reasons (id) on delete set null,
  lost_note text check (lost_note is null or char_length(lost_note) <= 500),
  -- Ordem dentro da etapa (menor em cima)
  position double precision not null default 0,
  stage_entered_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deals_board_idx on public.deals (pipeline_id, stage_id, position);
create index if not exists deals_contact_idx on public.deals (contact_id) where status = 'open';
create index if not exists deals_owner_idx on public.deals (clinic_id, owner_user_id);

create table if not exists public.deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  type text not null check (type in (
    'created', 'stage_changed', 'value_changed', 'owner_changed', 'note',
    'task_done', 'message_scheduled', 'campaign_converted'
  )),
  note text check (note is null or char_length(note) <= 4000),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists deal_events_deal_idx on public.deal_events (deal_id, created_at desc);

create table if not exists public.deal_tasks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  task_type text not null default 'other'
    check (task_type in ('call', 'message', 'meeting', 'other')),
  due_at timestamptz not null,
  -- Quem recebe o lembrete; vazio = responsável da negociação
  assigned_user_id uuid references auth.users (id) on delete set null,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  reminded_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists deal_tasks_deal_idx on public.deal_tasks (deal_id, due_at);
create index if not exists deal_tasks_reminder_idx on public.deal_tasks (due_at)
  where done_at is null and reminded_at is null;

create table if not exists public.deal_tags (
  deal_id uuid not null references public.deals (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (deal_id, tag_id)
);

-- Mensagem agendada feita pelo cartão (cliente só)
alter table public.scheduled_messages
  add column if not exists deal_id uuid references public.deals (id) on delete set null;

create index if not exists scheduled_messages_deal_idx
  on public.scheduled_messages (deal_id) where deal_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Acesso
-- -----------------------------------------------------------------------------
create or replace function public.can_access_deal_row(
  p_clinic_id uuid,
  p_owner_user_id uuid
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
    where cu.user_id = auth.uid()
      and cu.clinic_id = p_clinic_id
      and (
        cu.role = 'admin'
        or p_owner_user_id is null
        or p_owner_user_id = auth.uid()
      )
  );
$$;

create or replace function public.can_access_deal(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_access_deal_row(d.clinic_id, d.owner_user_id)
    from public.deals d
    where d.id = p_deal_id
  ), false);
$$;

revoke execute on function public.can_access_deal_row(uuid, uuid) from public, anon;
revoke execute on function public.can_access_deal(uuid) from public, anon;
grant execute on function public.can_access_deal_row(uuid, uuid) to authenticated;
grant execute on function public.can_access_deal(uuid) to authenticated;

alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.deal_loss_reasons enable row level security;
alter table public.deals enable row level security;
alter table public.deal_events enable row level security;
alter table public.deal_tasks enable row level security;
alter table public.deal_tags enable row level security;

revoke all on public.pipelines, public.pipeline_stages, public.deal_loss_reasons,
  public.deals, public.deal_events, public.deal_tasks, public.deal_tags
  from anon;
grant select, insert, update, delete on public.pipelines, public.pipeline_stages,
  public.deal_loss_reasons, public.deals, public.deal_tasks, public.deal_tags
  to authenticated;
grant select, insert, delete on public.deal_events to authenticated;

-- Configuração: todos da empresa leem, só o admin altera
drop policy if exists pipelines_select on public.pipelines;
create policy pipelines_select on public.pipelines for select to authenticated
  using (public.is_clinic_member(clinic_id));
drop policy if exists pipelines_admin_write on public.pipelines;
create policy pipelines_admin_write on public.pipelines for all to authenticated
  using (public.is_clinic_admin_of(clinic_id))
  with check (public.is_clinic_admin_of(clinic_id));

drop policy if exists pipeline_stages_select on public.pipeline_stages;
create policy pipeline_stages_select on public.pipeline_stages for select to authenticated
  using (public.is_clinic_member(clinic_id));
drop policy if exists pipeline_stages_admin_write on public.pipeline_stages;
create policy pipeline_stages_admin_write on public.pipeline_stages for all to authenticated
  using (public.is_clinic_admin_of(clinic_id))
  with check (public.is_clinic_admin_of(clinic_id));

drop policy if exists deal_loss_reasons_select on public.deal_loss_reasons;
create policy deal_loss_reasons_select on public.deal_loss_reasons for select to authenticated
  using (public.is_clinic_member(clinic_id));
drop policy if exists deal_loss_reasons_admin_write on public.deal_loss_reasons;
create policy deal_loss_reasons_admin_write on public.deal_loss_reasons for all to authenticated
  using (public.is_clinic_admin_of(clinic_id))
  with check (public.is_clinic_admin_of(clinic_id));

-- Negociações
drop policy if exists deals_select on public.deals;
create policy deals_select on public.deals for select to authenticated
  using (public.can_access_deal_row(clinic_id, owner_user_id));
drop policy if exists deals_insert on public.deals;
create policy deals_insert on public.deals for insert to authenticated
  with check (public.can_access_deal_row(clinic_id, owner_user_id));
drop policy if exists deals_update on public.deals;
create policy deals_update on public.deals for update to authenticated
  using (public.can_access_deal_row(clinic_id, owner_user_id))
  with check (public.can_access_deal_row(clinic_id, owner_user_id));
drop policy if exists deals_delete on public.deals;
create policy deals_delete on public.deals for delete to authenticated
  using (public.is_clinic_admin_of(clinic_id));

-- Histórico: lê quem vê o cartão; escreve só nota própria; apaga só a própria nota
drop policy if exists deal_events_select on public.deal_events;
create policy deal_events_select on public.deal_events for select to authenticated
  using (public.can_access_deal(deal_id));
drop policy if exists deal_events_insert_note on public.deal_events;
create policy deal_events_insert_note on public.deal_events for insert to authenticated
  with check (
    type = 'note'
    and user_id = auth.uid()
    and public.can_access_deal(deal_id)
  );
drop policy if exists deal_events_delete_note on public.deal_events;
create policy deal_events_delete_note on public.deal_events for delete to authenticated
  using (type = 'note' and user_id = auth.uid() and public.can_access_deal(deal_id));

drop policy if exists deal_tasks_all on public.deal_tasks;
create policy deal_tasks_all on public.deal_tasks for all to authenticated
  using (public.can_access_deal(deal_id))
  with check (public.can_access_deal(deal_id));

drop policy if exists deal_tags_all on public.deal_tags;
create policy deal_tags_all on public.deal_tags for all to authenticated
  using (public.can_access_deal(deal_id))
  with check (
    public.can_access_deal(deal_id)
    and exists (
      select 1
      from public.tags t
      join public.deals d on d.id = deal_tags.deal_id
      where t.id = deal_tags.tag_id
        and t.clinic_id = d.clinic_id
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Gatilhos: coerência (empresa, etapa, situação) e histórico
-- -----------------------------------------------------------------------------

-- Etapa sempre na mesma empresa do funil
create or replace function public.pipeline_stages_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.clinic_id into new.clinic_id from public.pipelines p where p.id = new.pipeline_id;
  if new.clinic_id is null then
    raise exception 'Funil não encontrado.';
  end if;
  if tg_op = 'UPDATE' and new.pipeline_id is distinct from old.pipeline_id then
    raise exception 'A etapa não pode mudar de funil.';
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;

drop trigger if exists pipeline_stages_before_write on public.pipeline_stages;
create trigger pipeline_stages_before_write
  before insert or update on public.pipeline_stages
  for each row execute function public.pipeline_stages_before_write();

create or replace function public.deals_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
      where cu.user_id = v_uid and cu.clinic_id = new.clinic_id and cu.role = 'admin'
    ) into v_is_admin;
    if not v_is_admin then
      raise exception 'Só o administrador passa a negociação para outra pessoa.';
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
$$;

drop trigger if exists deals_before_write on public.deals;
create trigger deals_before_write
  before insert or update on public.deals
  for each row execute function public.deals_before_write();

drop trigger if exists enforce_plan_feature on public.deals;
create trigger enforce_plan_feature
  before insert on public.deals
  for each row execute function public.enforce_plan_feature('scheduled_messages', 'O funil de vendas não faz parte');

create or replace function public.deals_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.deal_events (deal_id, clinic_id, user_id, type, payload)
    values (new.id, new.clinic_id, v_uid, 'created', jsonb_build_object(
      'stage_id', new.stage_id,
      'stage_name', (select name from public.pipeline_stages where id = new.stage_id),
      'source', new.source
    ));
    return null;
  end if;

  if new.stage_id is distinct from old.stage_id then
    insert into public.deal_events (deal_id, clinic_id, user_id, type, note, payload)
    values (new.id, new.clinic_id, v_uid, 'stage_changed', new.lost_note, jsonb_build_object(
      'from_stage_id', old.stage_id,
      'from_stage_name', (select name from public.pipeline_stages where id = old.stage_id),
      'to_stage_id', new.stage_id,
      'to_stage_name', (select name from public.pipeline_stages where id = new.stage_id),
      'status', new.status,
      'lost_reason', (select name from public.deal_loss_reasons where id = new.lost_reason_id)
    ));
  end if;

  if new.value is distinct from old.value then
    insert into public.deal_events (deal_id, clinic_id, user_id, type, payload)
    values (new.id, new.clinic_id, v_uid, 'value_changed',
      jsonb_build_object('from', old.value, 'to', new.value));
  end if;

  if new.owner_user_id is distinct from old.owner_user_id then
    insert into public.deal_events (deal_id, clinic_id, user_id, type, payload)
    values (new.id, new.clinic_id, v_uid, 'owner_changed',
      jsonb_build_object('from', old.owner_user_id, 'to', new.owner_user_id));
  end if;

  return null;
end;
$$;

drop trigger if exists deals_after_write on public.deals;
create trigger deals_after_write
  after insert or update on public.deals
  for each row execute function public.deals_after_write();

-- Nota: empresa vem da negociação
create or replace function public.deal_events_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select d.clinic_id into new.clinic_id from public.deals d where d.id = new.deal_id;
  if new.clinic_id is null then
    raise exception 'Negociação não encontrada.';
  end if;
  if new.type = 'note' and char_length(btrim(coalesce(new.note, ''))) = 0 then
    raise exception 'Escreva a nota.';
  end if;
  return new;
end;
$$;

drop trigger if exists deal_events_before_insert on public.deal_events;
create trigger deal_events_before_insert
  before insert on public.deal_events
  for each row execute function public.deal_events_before_insert();

create or replace function public.deal_tasks_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
begin
  select d.clinic_id into v_clinic from public.deals d where d.id = new.deal_id;
  if v_clinic is null then
    raise exception 'Negociação não encontrada.';
  end if;

  if tg_op = 'INSERT' then
    new.clinic_id := v_clinic;
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := now();
    new.done_at := null;
    new.reminded_at := null;
  else
    if new.deal_id is distinct from old.deal_id or new.clinic_id is distinct from old.clinic_id then
      raise exception 'A tarefa não pode mudar de negociação.';
    end if;
    -- Nova data: avisa de novo
    if new.due_at is distinct from old.due_at then
      new.reminded_at := null;
    end if;
    if new.done_at is not null and old.done_at is null then
      new.done_by := auth.uid();
    elsif new.done_at is null then
      new.done_by := null;
    end if;
  end if;

  if new.assigned_user_id is not null and not exists (
    select 1 from public.clinic_users cu
    where cu.user_id = new.assigned_user_id and cu.clinic_id = v_clinic
  ) then
    raise exception 'Responsável pela tarefa não faz parte da empresa.';
  end if;

  new.title := btrim(new.title);
  return new;
end;
$$;

drop trigger if exists deal_tasks_before_write on public.deal_tasks;
create trigger deal_tasks_before_write
  before insert or update on public.deal_tasks
  for each row execute function public.deal_tasks_before_write();

create or replace function public.deal_tasks_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.done_at is not null and old.done_at is null then
    insert into public.deal_events (deal_id, clinic_id, user_id, type, payload)
    values (new.deal_id, new.clinic_id, auth.uid(), 'task_done',
      jsonb_build_object('task_id', new.id, 'title', new.title, 'task_type', new.task_type));
  end if;
  return null;
end;
$$;

drop trigger if exists deal_tasks_after_update on public.deal_tasks;
create trigger deal_tasks_after_update
  after update of done_at on public.deal_tasks
  for each row execute function public.deal_tasks_after_update();

revoke execute on function public.pipeline_stages_before_write() from public, anon, authenticated;
revoke execute on function public.deals_before_write() from public, anon, authenticated;
revoke execute on function public.deals_after_write() from public, anon, authenticated;
revoke execute on function public.deal_events_before_insert() from public, anon, authenticated;
revoke execute on function public.deal_tasks_before_write() from public, anon, authenticated;
revoke execute on function public.deal_tasks_after_update() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Funil padrão (criado na primeira vez que alguém da empresa abre a tela)
-- -----------------------------------------------------------------------------
create or replace function public.create_default_pipeline(p_clinic_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pipeline uuid;
begin
  -- Uma por vez por empresa (duas abas abrindo a tela ao mesmo tempo)
  perform pg_advisory_xact_lock(hashtext('default_pipeline:' || p_clinic_id::text));

  select id into v_pipeline from public.pipelines
   where clinic_id = p_clinic_id order by position, created_at limit 1;
  if v_pipeline is not null then
    return v_pipeline;
  end if;

  insert into public.pipelines (clinic_id, name, position)
  values (p_clinic_id, 'Funil de vendas', 0)
  returning id into v_pipeline;

  insert into public.pipeline_stages (pipeline_id, clinic_id, name, color, position, kind)
  values
    (v_pipeline, p_clinic_id, 'Novo lead',   '#3b82f6', 0, 'open'),
    (v_pipeline, p_clinic_id, 'Em contato',  '#8b5cf6', 1, 'open'),
    (v_pipeline, p_clinic_id, 'Proposta',    '#f59e0b', 2, 'open'),
    (v_pipeline, p_clinic_id, 'Negociação',  '#f97316', 3, 'open'),
    (v_pipeline, p_clinic_id, 'Ganho',       '#22c55e', 4, 'won'),
    (v_pipeline, p_clinic_id, 'Perdido',     '#ef4444', 5, 'lost');

  if not exists (select 1 from public.deal_loss_reasons where clinic_id = p_clinic_id) then
    insert into public.deal_loss_reasons (clinic_id, name, position)
    values
      (p_clinic_id, 'Preço', 0),
      (p_clinic_id, 'Sem resposta', 1),
      (p_clinic_id, 'Escolheu outro lugar', 2),
      (p_clinic_id, 'Sem interesse no momento', 3),
      (p_clinic_id, 'Outro motivo', 4);
  end if;

  return v_pipeline;
end;
$$;

create or replace function public.ensure_default_pipeline()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
begin
  select cu.clinic_id into v_clinic
    from public.clinic_users cu
   where cu.user_id = auth.uid()
   limit 1;
  if v_clinic is null then
    raise exception 'Não autorizado';
  end if;
  return public.create_default_pipeline(v_clinic);
end;
$$;

revoke execute on function public.create_default_pipeline(uuid) from public, anon, authenticated;
revoke execute on function public.ensure_default_pipeline() from public, anon;
grant execute on function public.ensure_default_pipeline() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Mensagem agendada pelo cartão (um cliente só, mesmo motor das campanhas)
-- -----------------------------------------------------------------------------
create or replace function public.deal_schedule_message(
  p_deal_id uuid,
  p_message text,
  p_scheduled_at timestamptz,
  p_send_now boolean,
  p_channel_connection_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_id uuid;
begin
  select * into v_deal from public.deals where id = p_deal_id;
  if not found or not public.can_access_deal_row(v_deal.clinic_id, v_deal.owner_user_id) then
    raise exception 'Negociação não encontrada.';
  end if;

  v_id := public.scheduled_message_save(
    null,
    p_message,
    p_scheduled_at,
    jsonb_build_array(jsonb_build_object('contact_id', v_deal.contact_id)),
    p_channel_connection_id,
    v_deal.title,
    coalesce(p_send_now, false),
    null,
    7
  );

  update public.scheduled_messages set deal_id = p_deal_id where id = v_id;

  insert into public.deal_events (deal_id, clinic_id, user_id, type, note, payload)
  values (p_deal_id, v_deal.clinic_id, auth.uid(), 'message_scheduled', btrim(p_message),
    jsonb_build_object(
      'scheduled_message_id', v_id,
      'scheduled_at', (select scheduled_at from public.scheduled_messages where id = v_id)
    ));

  return v_id;
end;
$$;

revoke execute on function public.deal_schedule_message(uuid, text, timestamptz, boolean, uuid) from public, anon;
grant execute on function public.deal_schedule_message(uuid, text, timestamptz, boolean, uuid) to authenticated;

-- Lista de campanhas: as mensagens do cartão ficam de fora (coluna nova no fim)
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
  coalesce(s.preview_names, '{}'::text[]) as preview_names,
  sm.deal_id
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

grant select on public.scheduled_message_summaries to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Campanhas -> funil
-- -----------------------------------------------------------------------------

-- Adesão marcada: a negociação que veio desta campanha vai para "Ganho"
create or replace function public.campaign_mark_deal_won(p_recipient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient record;
begin
  select r.contact_id, r.scheduled_message_id, r.conversion_value
    into v_recipient
    from public.scheduled_message_recipients r
   where r.id = p_recipient_id;

  if v_recipient.contact_id is null then
    return;
  end if;

  update public.deals d
     set stage_id = (
           select s.id
           from public.pipeline_stages s
           where s.pipeline_id = d.pipeline_id and s.kind = 'won'
           order by s.position
           limit 1
         ),
         value = coalesce(d.value, v_recipient.conversion_value)
   where d.contact_id = v_recipient.contact_id
     and d.source_campaign_id = v_recipient.scheduled_message_id
     and d.status = 'open'
     and exists (
       select 1 from public.pipeline_stages s
       where s.pipeline_id = d.pipeline_id and s.kind = 'won'
     );
exception when others then
  raise warning '[campaign_mark_deal_won] %', sqlerrm;
end;
$$;

revoke execute on function public.campaign_mark_deal_won(uuid) from public, anon, authenticated;

-- Mesmas regras da 20261025000000; passa a avisar o funil na adesão
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
    perform public.campaign_mark_deal_won(p_recipient_id);
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

-- Adesão pela etiqueta de conversão também avisa o funil
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
      if found then
        perform public.campaign_mark_deal_won(v_recipient_id);
      end if;
    end if;
    return null;
  end if;

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

-- Leva para a primeira etapa do funil quem recebeu a campanha (só quem
-- respondeu, ou todos que receberam). Quem já tem negociação aberta fica de fora.
create or replace function public.campaign_to_deals(
  p_campaign_id uuid,
  p_only_replied boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.scheduled_messages%rowtype;
  v_pipeline uuid;
  v_stage uuid;
  v_won_stage uuid;
  v_count integer;
begin
  select * into v_campaign from public.scheduled_messages where id = p_campaign_id;
  if not found
     or not public.can_access_scheduled_message(v_campaign.clinic_id, v_campaign.created_by) then
    raise exception 'Campanha não encontrada.';
  end if;

  v_pipeline := public.create_default_pipeline(v_campaign.clinic_id);
  select s.id into v_stage
    from public.pipeline_stages s
   where s.pipeline_id = v_pipeline and s.kind = 'open'
   order by s.position
   limit 1;

  select s.id into v_won_stage
    from public.pipeline_stages s
   where s.pipeline_id = v_pipeline and s.kind = 'won'
   order by s.position
   limit 1;

  -- Quem já aderiu entra direto em "Ganho", com o valor da adesão
  insert into public.deals (
    clinic_id, pipeline_id, stage_id, contact_id, title, value, owner_user_id,
    source, source_campaign_id, source_conversation_id, position
  )
  select distinct on (r.contact_id)
    v_campaign.clinic_id, v_pipeline,
    case when r.converted_at is not null and v_won_stage is not null then v_won_stage else v_stage end,
    r.contact_id,
    left(coalesce(nullif(btrim(c.name), ''), r.phone) || ' · ' ||
         coalesce(nullif(btrim(v_campaign.name), ''), 'Campanha'), 120),
    case when r.converted_at is not null then r.conversion_value end,
    null, 'campaign', p_campaign_id, r.conversation_id,
    -- Negativo: entra no topo da etapa (a tela usa "menor em cima")
    -extract(epoch from now())
  from public.scheduled_message_recipients r
  join public.contacts c on c.id = r.contact_id
  where r.scheduled_message_id = p_campaign_id
    and r.status = 'sent'
    and (not coalesce(p_only_replied, true) or r.replied_at is not null)
    and not exists (
      select 1 from public.deals d
      where d.contact_id = r.contact_id and d.status = 'open'
    );
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke execute on function public.campaign_to_deals(uuid, boolean) from public, anon;
grant execute on function public.campaign_to_deals(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Lembretes de tarefa (worker: service role)
-- -----------------------------------------------------------------------------
create or replace function public.claim_deal_task_reminders(p_max integer default 100)
returns table (
  task_id uuid,
  deal_id uuid,
  title text,
  task_type text,
  due_at timestamptz,
  user_id uuid,
  deal_title text,
  contact_name text
)
language sql
security definer
set search_path = public
as $$
  with due as (
    select t.id
    from public.deal_tasks t
    where t.done_at is null
      and t.reminded_at is null
      and t.due_at <= now()
      -- Tarefa antiga criada já vencida não vira enxurrada de avisos
      and t.due_at > now() - interval '1 day'
    order by t.due_at
    limit greatest(1, p_max)
    for update skip locked
  ),
  marked as (
    update public.deal_tasks t
       set reminded_at = now()
      from due
     where t.id = due.id
    returning t.*
  )
  select m.id, m.deal_id, m.title, m.task_type, m.due_at,
         coalesce(m.assigned_user_id, d.owner_user_id, m.created_by),
         d.title, c.name
  from marked m
  join public.deals d on d.id = m.deal_id
  left join public.contacts c on c.id = d.contact_id;
$$;

revoke execute on function public.claim_deal_task_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_deal_task_reminders(integer) to service_role;

-- -----------------------------------------------------------------------------
-- 8. Funil padrão para as empresas que já existem
-- -----------------------------------------------------------------------------
do $$
declare
  v_clinic uuid;
begin
  for v_clinic in select id from public.clinics loop
    perform public.create_default_pipeline(v_clinic);
  end loop;
end;
$$;

commit;

-- -----------------------------------------------------------------------------
-- Agendamento dos lembretes: a cada minuto, só quando há tarefa vencendo
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('deal-task-reminders')
 where exists (select 1 from cron.job where jobname = 'deal-task-reminders');

select cron.schedule(
  'deal-task-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/deal-task-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_bot_secret')
    ),
    body := '{}'::jsonb
  )
  where exists (
    select 1
    from public.deal_tasks t
    where t.done_at is null
      and t.reminded_at is null
      and t.due_at <= now()
      and t.due_at > now() - interval '1 day'
  );
  $$
);
