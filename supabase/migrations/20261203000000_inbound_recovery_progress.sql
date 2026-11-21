-- =============================================================================
-- Progresso da sincronização do WhatsApp por QR Code
--
-- Ao ler o QR Code de novo, o evolution-connection-sync importa as mensagens
-- que chegaram enquanto o número esteve fora (20261118000000_inbound_recovery).
-- Aqui ficam os números que a faixa "Sincronizando mensagens" mostra para a
-- equipe da empresa:
--   - inbound_recovery_total: quantas mensagens a recuperação vai trazer
--     (já trazidas + as que faltam), gravado a cada rodada do sync. Null
--     enquanto a primeira busca não rodou.
--   - inbound_recovery_done: quantas já entraram nas conversas (o
--     shared-in-config soma uma a cada mensagem recuperada gravada).
--   - inbound_recovery_progress_at: último avanço. Sem avanço por um tempo, a
--     faixa some (o que sobrou não entra: contato bloqueado, falha...).
--
-- Ordem de deploy: aplique ANTES das edge functions.
-- =============================================================================

begin;

alter table public.channel_connections
  add column if not exists inbound_recovery_total integer,
  add column if not exists inbound_recovery_done integer not null default 0,
  add column if not exists inbound_recovery_progress_at timestamptz;

-- Mesmo gatilho de 20261118000000, agora zerando o progresso a cada reconexão
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
      new.inbound_recovery_total := null;
      new.inbound_recovery_done := 0;
      new.inbound_recovery_progress_at := now();
    end if;
  end if;
  return new;
end;
$$;

-- Uma mensagem recuperada entrou na conversa (chamado pelo shared-in-config)
create or replace function public.bump_inbound_recovery(p_connection_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.channel_connections
  set inbound_recovery_done = inbound_recovery_done + 1,
      inbound_recovery_progress_at = now()
  where id = p_connection_id
    and inbound_recovery_requested_at is not null;
$$;

revoke all on function public.bump_inbound_recovery(uuid) from public, anon, authenticated;
grant execute on function public.bump_inbound_recovery(uuid) to service_role;

-- A faixa lê o progresso direto da tabela (e pelo Realtime)
grant select (
  inbound_recovery_requested_at,
  inbound_recovery_total,
  inbound_recovery_done,
  inbound_recovery_progress_at
) on public.channel_connections to authenticated;

commit;
