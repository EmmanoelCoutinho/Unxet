-- =============================================================================
-- Planos novos e campanhas travadas no WhatsApp por QR Code
--
-- 1. Planos
--    - subscription_plans ganha max_departments (NULL = ilimitado), contando
--      os departamentos ATIVOS da empresa, o padrão incluído.
--    - Essencial: até 4 atendentes e 3 departamentos; passa a ter Instagram e
--      Messenger, departamentos (com transferências) e o painel/relatórios.
--    - Todos os planos têm social_channels e analytics.
--    - Gatilho enforce_plan_departments barra criar ou reativar departamento
--      acima do limite. Rebaixar o plano não desativa nada: o que já existe
--      fica, só não dá para criar/reativar mais.
--
-- 2. Campanhas pelo QR Code
--    Disparo em massa pelo WhatsApp por QR Code (Evolution) é o que mais leva
--    a Meta a bloquear o número. Campanha agora só sai pelo WhatsApp oficial,
--    com modelo aprovado (template_id preenchido).
--    - Gatilho de restrição (deferido, roda no fim da transação) recusa
--      campanha sem modelo criada, editada ou reenviada por um usuário. É
--      deferido porque deal_schedule_message cria a linha pela mesma função das
--      campanhas e só depois preenche deal_id: no fim da transação a mensagem
--      do funil já está marcada e passa. Envios do funil (deal_id) e das
--      mensagens recorrentes (recurring_message_id) continuam pelo QR Code.
--      O disparador e o cron (sem auth.uid()) não são afetados.
--    - Campanhas pelo QR Code agendadas ou em andamento são canceladas aqui
--      (o que ainda não saiu fica como cancelado; o que saiu continua no
--      resultado).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Planos
-- -----------------------------------------------------------------------------
alter table public.subscription_plans
  add column if not exists max_departments integer
    check (max_departments is null or max_departments > 0);

update public.subscription_plans
   set max_attendants = 4,
       max_departments = 3
 where code = 'essencial';

update public.subscription_plans
   set features = array(
         select distinct f
         from unnest(features || array['social_channels', 'departments', 'analytics']) as f
         order by f
       )
 where code = 'essencial';

update public.subscription_plans
   set features = array(
         select distinct f
         from unnest(features || array['social_channels', 'analytics']) as f
         order by f
       )
 where code in ('profissional', 'empresarial');

create or replace function public.enforce_plan_departments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.subscription_plans;
  v_active integer;
begin
  if not new.is_active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_active then
    return new;
  end if;

  v_plan := public.clinic_plan(new.clinic_id);
  if v_plan.max_departments is null then
    return new;
  end if;

  select count(*)
    into v_active
    from public.departments d
   where d.clinic_id = new.clinic_id
     and d.is_active
     and d.id <> new.id;

  if v_active >= v_plan.max_departments then
    raise exception 'O plano % permite até % departamentos ativos. Desative um departamento ou fale com a Unxet para mudar de plano.',
      v_plan.name, v_plan.max_departments
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_plan_departments() from public, anon, authenticated;

drop trigger if exists enforce_plan_departments on public.departments;
create trigger enforce_plan_departments
  before insert or update of is_active on public.departments
  for each row execute function public.enforce_plan_departments();

-- -----------------------------------------------------------------------------
-- 2. Campanhas só pelo WhatsApp oficial
-- -----------------------------------------------------------------------------
create or replace function public.block_qr_campaigns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scheduled_messages%rowtype;
begin
  -- Disparador, cron e migrations: sem usuário, sem trava
  if auth.uid() is null then
    return null;
  end if;

  -- Estado no fim da transação (deal_id pode ter sido preenchido depois)
  select * into v_row from public.scheduled_messages where id = new.id;
  if not found then
    return null;
  end if;

  if v_row.status in ('scheduled', 'processing')
     and v_row.template_id is null
     and v_row.deal_id is null
     and v_row.recurring_message_id is null then
    raise exception 'Campanhas pelo WhatsApp por QR Code foram desativadas para proteger o seu número de bloqueio. Use o WhatsApp oficial (API da Meta) com um modelo aprovado.'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

revoke execute on function public.block_qr_campaigns() from public, anon, authenticated;

drop trigger if exists block_qr_campaigns on public.scheduled_messages;
create constraint trigger block_qr_campaigns
  after insert or update on public.scheduled_messages
  deferrable initially deferred
  for each row execute function public.block_qr_campaigns();

-- Campanhas pelo QR Code que ainda iam sair
with stopped as (
  update public.scheduled_messages sm
     set status = 'cancelled',
         finished_at = now(),
         updated_at = now()
   where sm.status in ('scheduled', 'processing')
     and sm.template_id is null
     and sm.deal_id is null
     and sm.recurring_message_id is null
  returning sm.id
)
update public.scheduled_message_recipients r
   set status = 'cancelled'
  from stopped
 where r.scheduled_message_id = stopped.id
   and r.status = 'pending';

commit;
