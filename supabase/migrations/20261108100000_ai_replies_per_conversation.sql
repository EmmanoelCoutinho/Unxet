-- =============================================================================
-- Assistente com IA: limite de respostas por atendimento
--
-- A empresa escolhe quantas respostas a IA pode dar ao mesmo cliente num
-- atendimento (uma sessão do bot). Ao chegar no limite, o bot avisa o
-- cliente com educação e passa a conversa para a equipe. Protege a cota do
-- mês de um cliente que fica mandando mensagens sem parar.
--
-- O bot-engine conta as respostas pelas mensagens da sessão marcadas com
-- payload.bot.ai_reply = true.
--
-- Ordem de deploy: aplique ANTES de publicar o bot-engine e o frontend.
-- =============================================================================

begin;

alter table public.clinic_ai_settings
  add column if not exists max_replies_per_conversation integer not null default 20;

alter table public.clinic_ai_settings
  drop constraint if exists clinic_ai_settings_max_replies_per_conversation_check,
  add constraint clinic_ai_settings_max_replies_per_conversation_check
    check (max_replies_per_conversation between 1 and 200);

grant select (max_replies_per_conversation),
      insert (max_replies_per_conversation),
      update (max_replies_per_conversation)
  on table public.clinic_ai_settings to authenticated;

commit;
