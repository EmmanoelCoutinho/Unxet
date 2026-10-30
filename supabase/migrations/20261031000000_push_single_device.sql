-- =============================================================================
-- Push só no aparelho logado
--
-- Uma conta fica logada em um aparelho por vez: o login novo encerra as outras
-- sessões. As inscrições de push desses aparelhos ficavam no banco e eles
-- continuavam recebendo notificações. O front chama esta RPC no login, passando
-- a inscrição deste aparelho (ou null, se ele não tem push), e as demais da
-- conta são apagadas.
-- =============================================================================

begin;

create or replace function public.keep_only_push_subscription(p_endpoint text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.push_subscriptions
  where user_id = auth.uid()
    and endpoint is distinct from p_endpoint;
end;
$$;

revoke execute on function public.keep_only_push_subscription(text) from public, anon;
grant execute on function public.keep_only_push_subscription(text) to authenticated;

commit;
