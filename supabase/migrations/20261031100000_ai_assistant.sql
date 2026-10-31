-- =============================================================================
-- Assistente com IA nos bots
--
-- A IA é um adicional por empresa, como o de vários números de WhatsApp: a
-- Unxet liga pelo painel definindo quantas respostas da IA a empresa pode
-- receber por mês.
--
--   clinic_subscriptions.ai_replies_addon
--     null  adicional desligado: a etapa de IA passa a conversa para a equipe
--     N     adicional ligado: até N respostas da IA por mês (50 a 100000)
--
-- Camadas do comportamento da IA (juntadas pelo bot-engine a cada resposta):
--   1. Base da Unxet: fica no código do bot-engine, igual para todas.
--   2. Configuração da empresa (clinic_ai_settings): nome, tom, informações
--      do negócio, perguntas frequentes e regras. O admin da empresa edita.
--      custom_instructions é do plano sob medida: só a Unxet edita e só a
--      Unxet vê.
--   3. Etapa de IA no fluxo (bot_nodes.node_type = 'ai'): o objetivo daquela
--      etapa e para qual setor passar a conversa.
--
-- Consumo: clinic_ai_usage guarda respostas e tokens por mês (horário de
-- Brasília). clinic_ai_try_consume reserva uma resposta antes de chamar a IA
-- e recusa quando o limite do mês acabou.
--
-- Ordem de deploy: aplique ANTES de publicar o bot-engine e o frontend.
-- =============================================================================

-- Valor novo de enum não pode ser usado na mesma transação em que é criado
alter type public.bot_node_type add value if not exists 'ai';

begin;

-- -----------------------------------------------------------------------------
-- 1. Etapa de IA
-- -----------------------------------------------------------------------------
alter table public.bot_nodes
  add column if not exists ai_instructions text,
  add column if not exists ai_handoff_department_id uuid
    references public.departments(id) on delete set null;

alter table public.bot_nodes
  drop constraint if exists bot_nodes_ai_instructions_length,
  add constraint bot_nodes_ai_instructions_length
    check (ai_instructions is null or char_length(ai_instructions) <= 4000);

-- -----------------------------------------------------------------------------
-- 2. Adicional
-- -----------------------------------------------------------------------------
alter table public.clinic_subscriptions
  add column if not exists ai_replies_addon integer;

alter table public.clinic_subscriptions
  drop constraint if exists clinic_subscriptions_ai_replies_addon_check,
  add constraint clinic_subscriptions_ai_replies_addon_check
    check (ai_replies_addon is null or ai_replies_addon between 50 and 100000);

-- A empresa lê o adicional para saber se mostra a tela e a etapa de IA
grant select (ai_replies_addon)
  on table public.clinic_subscriptions to authenticated;

create or replace function public.clinic_ai_month()
returns date
language sql
stable
as $$
  select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
$$;

-- -----------------------------------------------------------------------------
-- 3. Configuração da IA da empresa
-- -----------------------------------------------------------------------------
create table if not exists public.clinic_ai_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  assistant_name text not null default 'Assistente'
    check (char_length(assistant_name) between 1 and 60),
  tone text not null default 'friendly'
    check (tone in ('friendly', 'formal')),
  use_emojis boolean not null default false,
  business_info text not null default ''
    check (char_length(business_info) <= 20000),
  faq text not null default ''
    check (char_length(faq) <= 30000),
  rules text not null default ''
    check (char_length(rules) <= 10000),
  custom_instructions text not null default ''
    check (char_length(custom_instructions) <= 20000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.clinic_ai_settings enable row level security;

revoke all on table public.clinic_ai_settings from anon, authenticated;
-- custom_instructions fica de fora: é da Unxet
grant select (
  clinic_id, assistant_name, tone, use_emojis, business_info, faq, rules,
  updated_at, updated_by
) on table public.clinic_ai_settings to authenticated;
grant insert (
  clinic_id, assistant_name, tone, use_emojis, business_info, faq, rules,
  updated_at, updated_by
) on table public.clinic_ai_settings to authenticated;
grant update (
  assistant_name, tone, use_emojis, business_info, faq, rules,
  updated_at, updated_by
) on table public.clinic_ai_settings to authenticated;

drop policy if exists "clinic_ai_settings_select" on public.clinic_ai_settings;
create policy "clinic_ai_settings_select" on public.clinic_ai_settings
  for select to authenticated
  using (public.is_clinic_admin_of(clinic_id));

drop policy if exists "clinic_ai_settings_insert" on public.clinic_ai_settings;
create policy "clinic_ai_settings_insert" on public.clinic_ai_settings
  for insert to authenticated
  with check (public.is_clinic_admin_of(clinic_id));

drop policy if exists "clinic_ai_settings_update" on public.clinic_ai_settings;
create policy "clinic_ai_settings_update" on public.clinic_ai_settings
  for update to authenticated
  using (public.is_clinic_admin_of(clinic_id))
  with check (public.is_clinic_admin_of(clinic_id));

-- -----------------------------------------------------------------------------
-- 4. Consumo por mês
-- -----------------------------------------------------------------------------
create table if not exists public.clinic_ai_usage (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  month date not null,
  replies integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (clinic_id, month)
);

alter table public.clinic_ai_usage enable row level security;

revoke all on table public.clinic_ai_usage from anon, authenticated;
grant select on table public.clinic_ai_usage to authenticated;

drop policy if exists "clinic_ai_usage_select" on public.clinic_ai_usage;
create policy "clinic_ai_usage_select" on public.clinic_ai_usage
  for select to authenticated
  using (public.is_clinic_admin_of(clinic_id));

-- Reserva uma resposta do mês. Falso se o adicional está desligado ou o
-- limite acabou. Atômico: duas conversas ao mesmo tempo não passam do limite.
create or replace function public.clinic_ai_try_consume(p_clinic_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_month date := public.clinic_ai_month();
  v_ok boolean;
begin
  select s.ai_replies_addon into v_limit
  from public.clinic_subscriptions s
  where s.clinic_id = p_clinic_id;

  if v_limit is null then
    return false;
  end if;

  insert into public.clinic_ai_usage (clinic_id, month, replies)
  values (p_clinic_id, v_month, 0)
  on conflict (clinic_id, month) do nothing;

  update public.clinic_ai_usage u
     set replies = u.replies + 1,
         updated_at = now()
   where u.clinic_id = p_clinic_id
     and u.month = v_month
     and u.replies < v_limit
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

create or replace function public.clinic_ai_record_tokens(
  p_clinic_id uuid,
  p_input_tokens bigint,
  p_output_tokens bigint
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.clinic_ai_usage u
     set input_tokens = u.input_tokens + greatest(coalesce(p_input_tokens, 0), 0),
         output_tokens = u.output_tokens + greatest(coalesce(p_output_tokens, 0), 0),
         updated_at = now()
   where u.clinic_id = p_clinic_id
     and u.month = public.clinic_ai_month();
$$;

revoke execute on function public.clinic_ai_try_consume(uuid) from public, anon, authenticated;
revoke execute on function public.clinic_ai_record_tokens(uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.clinic_ai_try_consume(uuid) to service_role;
grant execute on function public.clinic_ai_record_tokens(uuid, bigint, bigint) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Painel da Unxet
-- -----------------------------------------------------------------------------
-- Empresas com o adicional ligado ou instruções sob medida, com o consumo do mês
create or replace function public.platform_list_ai()
returns table (
  clinic_id uuid,
  clinic_name text,
  ai_replies_addon integer,
  replies_this_month integer,
  input_tokens_this_month bigint,
  output_tokens_this_month bigint,
  custom_instructions text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.platform_assert_admin();

  return query
  select
    c.id,
    c.name::text,
    s.ai_replies_addon,
    coalesce(u.replies, 0),
    coalesce(u.input_tokens, 0),
    coalesce(u.output_tokens, 0),
    coalesce(a.custom_instructions, '')
  from public.clinics c
  left join public.clinic_subscriptions s on s.clinic_id = c.id
  left join public.clinic_ai_settings a on a.clinic_id = c.id
  left join public.clinic_ai_usage u
    on u.clinic_id = c.id and u.month = public.clinic_ai_month()
  order by c.name;
end;
$$;

create or replace function public.platform_set_ai(
  p_clinic_id uuid,
  p_ai_replies_addon integer,
  p_custom_instructions text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.platform_assert_admin();

  if not exists (select 1 from public.clinic_subscriptions s where s.clinic_id = p_clinic_id) then
    raise exception 'A empresa ainda não tem assinatura cadastrada';
  end if;

  update public.clinic_subscriptions
     set ai_replies_addon = p_ai_replies_addon
   where clinic_id = p_clinic_id;

  if p_custom_instructions is not null then
    insert into public.clinic_ai_settings (clinic_id, custom_instructions, updated_at, updated_by)
    values (p_clinic_id, p_custom_instructions, now(), auth.uid())
    on conflict (clinic_id) do update
      set custom_instructions = excluded.custom_instructions,
          updated_at = now(),
          updated_by = auth.uid();
  end if;
end;
$$;

revoke execute on function public.platform_list_ai() from public, anon;
revoke execute on function public.platform_set_ai(uuid, integer, text) from public, anon;
grant execute on function public.platform_list_ai() to authenticated;
grant execute on function public.platform_set_ai(uuid, integer, text) to authenticated;

commit;
