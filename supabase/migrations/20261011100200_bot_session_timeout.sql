-- =============================================================================
-- Bots: encerramento da sessão por inatividade
--
-- Antes a sessão do bot ficava ativa para sempre: o cliente recebia o menu,
-- respondia dias depois e caía em "opção inválida".
--
-- 1. bots.session_timeout_hours: prazo configurável por bot, de 1 a 24h
--    (padrão 24h). O teto é 24h porque depois disso o WhatsApp oficial não
--    permite mais enviar mensagem livre ao cliente.
-- 2. A cada 5 minutos o pg_cron chama a edge function bot-session-timeout, que
--    encerra as sessões vencidas e envia bots.timeout_message (se preenchida).
--
-- ATENÇÃO — ordem de deploy: aplique ANTES de publicar o bot-engine e o
-- frontend desta entrega; os dois já leem/gravam a coluna nova.
--
-- O job usa os mesmos segredos do Vault criados para o
-- evolution-connection-sync ('project_url' e 'internal_bot_secret').
-- =============================================================================

alter table public.bots
  add column if not exists session_timeout_hours integer not null default 24;

alter table public.bots
  drop constraint if exists bots_session_timeout_hours_check;

alter table public.bots
  add constraint bots_session_timeout_hours_check
  check (session_timeout_hours between 1 and 24);

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'bot-session-timeout',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/bot-session-timeout',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_bot_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
