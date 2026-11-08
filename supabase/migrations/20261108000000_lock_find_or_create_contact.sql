-- =============================================================================
-- find_or_create_contact_for_conversation fechada para o app
--
-- A função é security definer (passa por cima do RLS) e recebe a empresa por
-- parâmetro, sem conferir quem chama. Como o execute estava liberado para
-- anon e authenticated, qualquer pessoa com a chave pública do app conseguia
-- criar contatos em qualquer empresa e trocar nome e foto de um contato
-- existente (só sabendo o id da empresa e o telefone).
--
-- Nenhuma tela nem edge function usa a função hoje; ela fica disponível só
-- para o service role.
--
-- Nem todo banco tem a função (o develop nunca recebeu a migration que a
-- cria): sem ela, não há o que fechar.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.find_or_create_contact_for_conversation(uuid, text, text, text, text)') is null then
    raise notice 'find_or_create_contact_for_conversation não existe neste banco; nada a fazer.';
    return;
  end if;

  revoke execute on function public.find_or_create_contact_for_conversation(uuid, text, text, text, text)
    from public, anon, authenticated;
  grant execute on function public.find_or_create_contact_for_conversation(uuid, text, text, text, text)
    to service_role;
end;
$$;
