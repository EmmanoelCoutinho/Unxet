-- =============================================================================
-- Pesquisa de satisfação: quando a espera pela nota acaba
--
-- A pesquisa não tem prazo. Enquanto espera a nota, um número solto vira nota
-- e um agradecimento recente fica na conversa encerrada sem reabrir. Isso
-- deixava de fazer sentido em dois casos:
--
-- 1. A empresa desligou a pesquisa: as que já tinham sido enviadas seguiam
--    esperando. Agora, ao desligar, todas as pendentes da empresa vencem
--    (status 'expired').
-- 2. A conversa reabriu (áudio, foto ou documento do cliente, atendente que
--    retomou, nova conversa no mesmo canal): a pesquisa seguia pendente e a
--    resposta ao menu do bot ("2") era gravada como nota. Agora a pesquisa
--    pendente do contato naquele canal é encerrada (status 'skipped').
--
-- Os gatilhos rodam como security definer: quem reabre a conversa (atendente)
-- ou desliga a pesquisa (admin) não precisa de permissão em
-- satisfaction_surveys.
--
-- Ordem de deploy: independente das edge functions.
-- =============================================================================

begin;

-- 1. Desligar a pesquisa encerra as pendentes ------------------------------------
create or replace function public.satisfaction_survey_disabled_expire_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.satisfaction_surveys
     set status = 'expired'
   where clinic_id = new.clinic_id
     and status = 'sent';
  return new;
end;
$$;

revoke all on function public.satisfaction_survey_disabled_expire_pending() from public, anon, authenticated;

drop trigger if exists satisfaction_survey_disabled_expire_pending on public.conversation_automation_settings;
create trigger satisfaction_survey_disabled_expire_pending
  after update of satisfaction_survey_enabled on public.conversation_automation_settings
  for each row
  when (old.satisfaction_survey_enabled is distinct from false and new.satisfaction_survey_enabled = false)
  execute function public.satisfaction_survey_disabled_expire_pending();

-- 2. Conversa reaberta encerra a pesquisa pendente ------------------------------
create or replace function public.satisfaction_survey_skip_on_reopen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.contact_id is null or new.channel_connection_id is null then
    return new;
  end if;

  update public.satisfaction_surveys
     set status = 'skipped'
   where clinic_id = new.clinic_id
     and contact_id = new.contact_id
     and channel_connection_id = new.channel_connection_id
     and status = 'sent';
  return new;
end;
$$;

revoke all on function public.satisfaction_survey_skip_on_reopen() from public, anon, authenticated;

drop trigger if exists satisfaction_survey_skip_on_reopen on public.conversations;
create trigger satisfaction_survey_skip_on_reopen
  after update of status on public.conversations
  for each row
  when (old.status = 'closed' and new.status is distinct from 'closed')
  execute function public.satisfaction_survey_skip_on_reopen();

drop trigger if exists satisfaction_survey_skip_on_new_conversation on public.conversations;
create trigger satisfaction_survey_skip_on_new_conversation
  after insert on public.conversations
  for each row
  when (new.status is distinct from 'closed')
  execute function public.satisfaction_survey_skip_on_reopen();

-- 3. Pendentes de empresas que já estão com a pesquisa desligada -----------------
--    (a produção foi corrigida à mão em 24/11; isto cobre o develop e o local)
update public.satisfaction_surveys s
   set status = 'expired'
  from public.conversation_automation_settings st
 where st.clinic_id = s.clinic_id
   and st.satisfaction_survey_enabled = false
   and s.status = 'sent';

update public.satisfaction_surveys s
   set status = 'expired'
 where s.status = 'sent'
   and not exists (select 1 from public.conversation_automation_settings st where st.clinic_id = s.clinic_id);

-- 4. Pendentes de contatos que já voltaram a ser atendidos no mesmo canal -------
update public.satisfaction_surveys s
   set status = 'skipped'
 where s.status = 'sent'
   and exists (
     select 1 from public.conversations c
      where c.clinic_id = s.clinic_id
        and c.contact_id = s.contact_id
        and c.channel_connection_id = s.channel_connection_id
        and c.status <> 'closed'
   );

commit;
