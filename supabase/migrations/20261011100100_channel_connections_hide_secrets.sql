-- =============================================================================
-- channel_connections: tokens e chaves de API fora do alcance do navegador
--
-- A policy de SELECT libera a tabela para todo membro da clínica e o papel
-- "authenticated" tinha SELECT em todas as colunas. Na prática qualquer
-- atendente conseguia ler, pela API REST, o access_token da Meta e a
-- evolution_api_key da clínica (a tela de bots fazia select("*")).
--
-- A partir daqui o cliente só enxerga as colunas não sensíveis. As edge
-- functions usam service role e continuam lendo tudo.
--
-- ATENÇÃO — ordem de deploy: aplique DEPOIS de publicar o frontend desta
-- mesma entrega. A versão antiga da tela de bots fazia select("*") e passa a
-- receber "permission denied" com este grant por coluna.
-- =============================================================================

begin;

revoke select on public.channel_connections from anon, authenticated;

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
  last_disconnection_at
) on public.channel_connections to authenticated;

commit;
