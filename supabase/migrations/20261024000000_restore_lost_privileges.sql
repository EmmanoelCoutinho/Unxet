-- =============================================================================
-- Reaplica as permissões que se perderam na mudança de região (17/10)
--
-- O banco de produção (karmtrldanuxqisgzlhk) veio de um dump do projeto
-- antigo. Na restauração, tabelas e funções voltaram com as permissões padrão
-- do Supabase (anon e authenticated com acesso total), e os REVOKE das
-- migrations anteriores à mudança deixaram de valer. As migrations aplicadas
-- depois (20261021000000 em diante) estão corretas.
--
-- O mais grave: qualquer usuário logado lia, da própria empresa, a chave da
-- Evolution (a mesma para o servidor inteiro) e os tokens da Meta em
-- channel_connections (20261011100100_channel_connections_hide_secrets).
-- Funções internas (filas, jobs, worker de transcrição) também podiam ser
-- chamadas pelo app e até sem login.
--
-- Esta migration só repete o que as migrations já definiam: não muda regra
-- nenhuma. Pode rodar de novo sem efeito. Funções que não existem mais são
-- ignoradas.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. channel_connections: o app lê só colunas sem segredo e edita só apelido
--    e setor (20261011100100 + 20261023100000 + 20261023200000)
-- -----------------------------------------------------------------------------
revoke all on public.channel_connections from anon, authenticated;

grant select (
  id,
  clinic_id,
  provider,
  channel,
  meta_phone_number_id,
  meta_waba_id,
  meta_page_id,
  meta_ig_user_id,
  token_expires_at,
  status,
  created_at,
  updated_at,
  session_name,
  qr_code,
  connected_phone,
  connected_name,
  last_connection_at,
  last_disconnection_at,
  display_name,
  default_department_id,
  archived_at,
  disconnect_reason
) on public.channel_connections to authenticated;

grant update (display_name, default_department_id, updated_at)
  on public.channel_connections to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Tabelas fechadas pelas migrations antigas
-- -----------------------------------------------------------------------------
-- Chat interno (20261014000000)
revoke all on public.internal_chat_threads from anon;
revoke all on public.internal_chat_messages from anon;
revoke all on public.internal_chat_reads from anon;

-- Admins da plataforma (20261015000000)
revoke all on table public.platform_admins from anon, authenticated;
grant select on table public.platform_admins to authenticated;

-- Mensagens programadas (20261017000000): o app só lê; grava pelas RPCs
revoke all on public.scheduled_messages from anon, authenticated;
revoke all on public.scheduled_message_recipients from anon, authenticated;
grant select on public.scheduled_messages to authenticated;
grant select on public.scheduled_message_recipients to authenticated;

-- Presença (20261018000000)
revoke all on table public.user_presence from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Funções
-- -----------------------------------------------------------------------------
do $$
declare
  v_sig text;
  v_proc regprocedure;
begin
  -- Só o servidor (service role / pg_cron): filas, jobs e workers
  foreach v_sig in array array[
    'public.claim_transcription_jobs(integer)',
    'public.enqueue_message(text, jsonb)',
    'public.enqueue_message_batch(text, jsonb[])',
    'public.finalize_scheduled_messages()',
    'public.job_cleanup_edge_tables()',
    'public.job_conversation_auto_close()',
    'public.job_conversation_return_to_pending()',
    'public.job_conversation_sla_first_response()',
    'public.mark_clinic_user_invite_accepted()',
    'public.prevent_clinic_user_privilege_change()'
  ] loop
    v_proc := to_regprocedure(v_sig);
    if v_proc is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', v_proc);
      execute format('grant execute on function %s to service_role', v_proc);
    end if;
  end loop;

  -- Usuário logado sim, visitante sem login não
  foreach v_sig in array array[
    'public.can_access_conversation(uuid, uuid, uuid)',
    'public.can_access_conversation_id(uuid)',
    'public.can_access_internal_thread(uuid)',
    'public.can_access_scheduled_message(uuid, uuid)',
    'public.inbox_backlog(uuid, text[], uuid, uuid, integer)',
    'public.internal_chat_list_threads()',
    'public.internal_chat_mark_read(uuid)',
    'public.internal_chat_open_direct(uuid)',
    'public.mark_conversation_read(uuid)',
    'public.mark_conversation_read(uuid, uuid)',
    'public.platform_metrics(integer, text)',
    'public.platform_online_users(integer)',
    'public.register_push_subscription(text, text, text, text)',
    'public.scheduled_message_cancel(uuid)',
    'public.scheduled_message_delete(uuid)',
    'public.send_mass_messages_to_queue(text, jsonb)',
    'public.set_default_department(uuid)',
    'public.touch_presence()',
    'public.unregister_push_subscription(text)'
  ] loop
    v_proc := to_regprocedure(v_sig);
    if v_proc is not null then
      execute format('revoke execute on function %s from public, anon', v_proc);
      execute format('grant execute on function %s to authenticated', v_proc);
    end if;
  end loop;

  -- O chat interno também é usado pelas edge functions
  v_proc := to_regprocedure('public.can_access_internal_thread(uuid)');
  if v_proc is not null then
    execute format('grant execute on function %s to service_role', v_proc);
  end if;
end;
$$;

commit;
