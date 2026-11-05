-- Tempo real: todas as tabelas que o app escuta (postgres_changes) precisam
-- estar na publicação supabase_realtime. Até aqui isso era configurado à mão
-- no painel, e faltavam três tabelas no develop e na produção:
--   conversation_events: avisos na conversa ("aceitou", "transferiu") feitos
--                        por outra pessoa só apareciam ao reabrir
--   quick_messages:      mensagem rápida nova só aparecia ao recarregar
--   campaigns:           andamento das Campanhas Meta não atualizava sozinho
-- As outras já estavam ligadas; ficam aqui para o repositório ser a fonte da
-- verdade (e o banco local funcionar igual). Só adiciona o que falta.

do $$
declare
  t text;
begin
  foreach t in array array[
    'campaigns',
    'channel_connections',
    'conversation_events',
    'conversation_tags',
    'conversations',
    'internal_chat_messages',
    'messages',
    'platform_settings',
    'quick_messages',
    'tags'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
