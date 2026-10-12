-- =============================================================================
-- Etiquetas gerenciadas só por administradores e limpeza de tabelas técnicas
--
-- 1. tags: criar, editar e excluir passa a ser só do admin da clínica. Excluir
--    uma etiqueta a remove de todas as conversas, e qualquer atendente podia
--    fazer isso. Atendente continua lendo as etiquetas e aplicando nas
--    conversas (conversation_tags não muda).
--
-- 2. send_nonces e edge_rate_limits só cresciam: cada mensagem enviada grava
--    um nonce que vence em 2 minutos e nunca era apagado. Um job diário remove
--    o que já venceu há mais de um dia.
--
-- Ordem de deploy: pode ser aplicada antes ou depois do frontend. Aplicada
-- antes, a tela antiga de etiquetas mostra erro para o atendente que tentar
-- criar ou editar.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Etiquetas: escrita só para admin
-- -----------------------------------------------------------------------------
drop policy if exists "tags_insert_clinic_members" on public.tags;
drop policy if exists "tags_update_clinic_members" on public.tags;
drop policy if exists "tags_delete_clinic_members" on public.tags;
drop policy if exists "tags_insert_admin_only" on public.tags;
drop policy if exists "tags_update_admin_only" on public.tags;
drop policy if exists "tags_delete_admin_only" on public.tags;

create policy "tags_insert_admin_only" on public.tags
  for insert to authenticated
  with check (public.user_can_manage_clinic(clinic_id));

create policy "tags_update_admin_only" on public.tags
  for update to authenticated
  using (public.user_can_manage_clinic(clinic_id))
  with check (public.user_can_manage_clinic(clinic_id));

create policy "tags_delete_admin_only" on public.tags
  for delete to authenticated
  using (public.user_can_manage_clinic(clinic_id));

-- -----------------------------------------------------------------------------
-- 2. Limpeza diária de nonces e contadores vencidos
-- -----------------------------------------------------------------------------
create or replace function public.job_cleanup_edge_tables()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.send_nonces
   where expires_at < now() - interval '1 day';

  delete from public.edge_rate_limits
   where bucket_start < now() - interval '1 day';
$$;

revoke execute on function public.job_cleanup_edge_tables() from public, anon, authenticated;

commit;

create extension if not exists pg_cron;

-- Reagendar com o mesmo nome substitui o job anterior
select cron.schedule(
  'cleanup-edge-tables',
  '17 6 * * *',
  $$select public.job_cleanup_edge_tables();$$
);
