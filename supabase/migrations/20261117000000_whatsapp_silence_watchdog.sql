-- =============================================================================
-- Vigia do WhatsApp por QR Code: número conectado que parou de receber
--
-- Às vezes a sessão do WhatsApp dentro da Evolution trava: a instância segue
-- "conectada", mas nenhuma mensagem chega mais, até alguém ler o QR Code de
-- novo. O evolution-connection-sync (a cada 5 minutos) passa a comparar o
-- movimento de agora com o mesmo horário das 4 semanas anteriores; se um
-- número que costuma receber mensagens ficou em silêncio, a instância é
-- reiniciada sozinha e os administradores são avisados.
--
-- Aqui ficam as marcas do vigia e a consulta do movimento de cada número.
--
-- Ordem de deploy: aplique ANTES de publicar o evolution-connection-sync.
-- =============================================================================

begin;

alter table public.channel_connections
  -- Último reinício automático (respeita o intervalo entre reinícios)
  add column if not exists watchdog_restarted_at timestamptz,
  -- Último aviso de "reiniciei e continua sem receber"
  add column if not exists watchdog_alerted_at timestamptz;

-- Movimento de cada número QR Code conectado:
--   recent_count           mensagens recebidas nos últimos p_window_minutes
--   baseline_counts        o mesmo intervalo há 1, 2, 3 e 4 semanas
--   inbound_since_restart  recebidas depois do último reinício automático
-- Conta pela hora em que a mensagem chegou ao sistema (created_at), não pela
-- hora do WhatsApp: depois de um reinício as mensagens represadas chegam com
-- o horário antigo.
create or replace function public.whatsapp_inbound_activity(p_window_minutes integer)
returns table (
  connection_id uuid,
  clinic_id uuid,
  session_name text,
  connected_phone text,
  connected_name text,
  evolution_api_url text,
  evolution_api_key text,
  last_connection_at timestamptz,
  watchdog_restarted_at timestamptz,
  watchdog_alerted_at timestamptz,
  recent_count integer,
  baseline_counts integer[],
  inbound_since_restart integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cc.id,
    cc.clinic_id,
    cc.session_name,
    cc.connected_phone,
    cc.connected_name,
    cc.evolution_api_url,
    cc.evolution_api_key,
    cc.last_connection_at,
    cc.watchdog_restarted_at,
    cc.watchdog_alerted_at,
    (
      select count(*)::integer
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.channel_connection_id = cc.id
        and m.direction = 'inbound'
        and m.created_at >= now() - make_interval(mins => p_window_minutes)
    ),
    array(
      select (
        select count(*)::integer
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
        where c.channel_connection_id = cc.id
          and m.direction = 'inbound'
          and m.created_at >= now() - make_interval(days => 7 * w, mins => p_window_minutes)
          and m.created_at < now() - make_interval(days => 7 * w)
      )
      from generate_series(1, 4) as w
      order by w
    ),
    case
      when cc.watchdog_restarted_at is null then null
      else (
        select count(*)::integer
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
        where c.channel_connection_id = cc.id
          and m.direction = 'inbound'
          and m.created_at >= cc.watchdog_restarted_at
      )
    end
  from public.channel_connections cc
  where cc.provider = 'evolution'
    and cc.channel = 'whatsapp'
    and cc.status = 'connected'
    and cc.archived_at is null
    and cc.session_name is not null;
$$;

revoke execute on function public.whatsapp_inbound_activity(integer) from public, anon, authenticated;
grant execute on function public.whatsapp_inbound_activity(integer) to service_role;

commit;
