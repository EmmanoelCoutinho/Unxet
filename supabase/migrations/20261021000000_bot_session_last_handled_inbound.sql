-- =============================================================================
-- Bot: responde uma vez só quando o cliente manda várias mensagens seguidas
--
-- Antes cada mensagem do cliente era tratada sozinha: "Oi" / "Bom dia" /
-- "Queria saber do boleto" geravam três "Não entendi" + menu.
--
-- Agora o bot-engine espera alguns segundos de silêncio e responde ao conjunto.
-- conversation_bot_sessions.last_handled_inbound_at guarda a data da última
-- mensagem do cliente já tratada pelo bot: serve de trava para duas execuções
-- não responderem às mesmas mensagens.
--
-- Ordem de deploy: aplique ANTES de publicar o bot-engine desta entrega.
-- (Sem a coluna o bot continua funcionando, só sem a trava.)
-- =============================================================================

alter table public.conversation_bot_sessions
  add column if not exists last_handled_inbound_at timestamptz;

comment on column public.conversation_bot_sessions.last_handled_inbound_at is
  'created_at da última mensagem do cliente já respondida pelo bot nesta sessão';
