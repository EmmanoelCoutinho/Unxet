-- Remove a RPC inbox_analytics, substituída no PR #65 por operational_now
-- (Painel) e operational_report (Relatórios). Ela foi mantida até o front novo
-- estar publicado, para não quebrar versões em cache do app (PWA).
-- inbox_backlog continua em uso e NÃO é removida aqui.

drop function if exists public.inbox_analytics(uuid, timestamptz, timestamptz, text[], uuid, uuid, text);
