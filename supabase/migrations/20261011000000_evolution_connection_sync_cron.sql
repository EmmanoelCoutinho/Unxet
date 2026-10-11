-- =============================================================================
-- Conferência periódica das conexões Evolution (WhatsApp via QR Code)
--
-- O status de channel_connections depende do webhook CONNECTION_UPDATE. Quando
-- o cliente remove o aparelho em "Dispositivos conectados" no WhatsApp, esse
-- evento pode não chegar e a conexão ficava como "conectada" para sempre.
--
-- A cada 5 minutos o pg_cron chama a edge function evolution-connection-sync,
-- que consulta o estado real de cada instância e corrige o status.
--
-- ANTES de aplicar, crie os dois segredos no Vault (SQL Editor), uma única vez:
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<valor de INTERNAL_BOT_SECRET>', 'internal_bot_secret');
--
-- Sem eles o job roda, mas a chamada falha (nada é alterado).
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'evolution-connection-sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/evolution-connection-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_bot_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
