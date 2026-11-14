-- =============================================================================
-- Pesquisa de satisfação: nota sempre de 0 a 10 e sem prazo para responder
--
-- 1. A escala deixa de ser escolhida pela empresa: toda pesquisa nova é de
--    0 a 10. As colunas satisfaction_survey_scale_min/max continuam (os
--    relatórios leem a escala atual da empresa), mas ficam fixas em 0 e 10.
--    Avaliações antigas (1 a 5, 1 a 10) seguem convertidas pelos relatórios.
-- 2. A mensagem padrão (texto que o sistema sugere) passa a pedir 0 a 10.
--    Texto escrito pela empresa não é alterado; a tela pede o ajuste.
-- 3. Sem prazo: a pesquisa espera a nota até o cliente mandar outra mensagem
--    que não seja nota (aí a conversa reabre) ou até a próxima pesquisa.
--    satisfaction_surveys.expires_at passa a aceitar nulo e deixa de ser
--    gravado. satisfaction_survey_window_minutes fica sem uso.
--    Pesquisas pendentes que já tinham vencido continuam vencidas.
--
-- Ordem de deploy: aplique ANTES de publicar as edge functions (meta-in,
-- shared-in-config, close-conversation e quem importa _shared/satisfactionSurvey).
-- =============================================================================

begin;

-- 1. Escala fixa em 0 a 10
alter table public.conversation_automation_settings
  alter column satisfaction_survey_scale_min set default 0,
  alter column satisfaction_survey_scale_max set default 10;

update public.conversation_automation_settings
   set satisfaction_survey_scale_min = 0,
       satisfaction_survey_scale_max = 10
 where satisfaction_survey_scale_min is distinct from 0
    or satisfaction_survey_scale_max is distinct from 10;

-- 2. Mensagem padrão em 0 a 10 (só quem ainda usa o texto sugerido)
alter table public.conversation_automation_settings
  alter column satisfaction_survey_message set default
    'Como você avalia o nosso atendimento? Responda com uma nota de 0 a 10, sendo 0 muito insatisfeito e 10 muito satisfeito.';

update public.conversation_automation_settings
   set satisfaction_survey_message =
     'Como você avalia o nosso atendimento? Responda com uma nota de 0 a 10, sendo 0 muito insatisfeito e 10 muito satisfeito.'
 where satisfaction_survey_message ~
   '^Como você avalia o nosso atendimento\? Responda com uma nota de \d{1,2} a \d{1,2}, sendo \d{1,2} muito insatisfeito e \d{1,2} muito satisfeito\.$';

-- 3. Sem prazo para responder
update public.satisfaction_surveys
   set status = 'expired'
 where status = 'sent'
   and expires_at is not null
   and expires_at <= now();

alter table public.satisfaction_surveys
  alter column expires_at drop not null;

update public.satisfaction_surveys
   set expires_at = null
 where status = 'sent';

commit;
