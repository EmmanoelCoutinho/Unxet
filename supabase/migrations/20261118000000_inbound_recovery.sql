-- =============================================================================
-- Recuperação das mensagens recebidas com o WhatsApp por QR Code fora do ar
--
-- Quando a sessão trava ou o número é desconectado, as mensagens dos clientes
-- não chegam ao Unxet. Ao ler o QR Code de novo, o celular manda o histórico
-- recente para a Evolution. Depois que a conexão volta, o
-- evolution-connection-sync busca na Evolution o que chegou desde a última
-- mensagem recebida e importa o que falta (_shared/inboundRecovery.ts).
--
-- Aqui fica a marca da recuperação: toda vez que um número QR Code passa para
-- "connected", o gatilho anota a hora e a última mensagem que o Unxet tinha
-- recebido por ele naquele momento (antes de as novas começarem a chegar).
-- Número que nunca recebeu mensagem não é marcado: conexão nova não importa
-- histórico.
--
-- Ordem de deploy: aplique ANTES das edge functions.
-- =============================================================================

begin;

alter table public.channel_connections
  -- Quando a conexão voltou (null = nada a recuperar)
  add column if not exists inbound_recovery_requested_at timestamptz,
  -- Última mensagem recebida antes de a conexão voltar: início da busca
  add column if not exists inbound_recovery_from timestamptz;

create or replace function public.mark_inbound_recovery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
begin
  if new.provider = 'evolution'
     and new.channel = 'whatsapp'
     and new.status = 'connected'
     and old.status is distinct from 'connected' then
    select max(c.last_inbound_at) into v_from
    from public.conversations c
    where c.channel_connection_id = new.id;

    if v_from is not null then
      new.inbound_recovery_requested_at := now();
      new.inbound_recovery_from := v_from;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists mark_inbound_recovery on public.channel_connections;
create trigger mark_inbound_recovery
  before update of status on public.channel_connections
  for each row execute function public.mark_inbound_recovery();

commit;
