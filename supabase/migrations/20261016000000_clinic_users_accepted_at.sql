-- =============================================================================
-- clinic_users.accepted_at passa a refletir o aceite do convite
--
-- Até aqui o campo nunca era preenchido, então não havia como saber quem ainda
-- não aceitou o convite (necessário para exibir "Convite pendente" e permitir
-- reenviar o e-mail quando o link expira).
--
-- O convite só é considerado aceito quando o usuário define a senha. Clicar no
-- link já confirma o e-mail no Supabase Auth, mas quem fecha a página sem
-- definir a senha continua sem conseguir entrar — e deve seguir como pendente.
-- =============================================================================

begin;

create or replace function public.mark_clinic_user_invite_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.encrypted_password, '') = '' then
    return new;
  end if;

  update public.clinic_users
     set accepted_at = now()
   where user_id = new.id
     and accepted_at is null;

  return new;
end;
$$;

revoke execute on function public.mark_clinic_user_invite_accepted()
  from public, anon, authenticated;

drop trigger if exists trg_mark_clinic_user_invite_accepted on auth.users;
create trigger trg_mark_clinic_user_invite_accepted
  after update of encrypted_password on auth.users
  for each row execute function public.mark_clinic_user_invite_accepted();

-- Backfill: quem já tem senha definida aceitou o convite. A data exata não é
-- conhecida; usa o primeiro indicador disponível.
update public.clinic_users cu
   set accepted_at = coalesce(u.last_sign_in_at, u.email_confirmed_at, u.updated_at, now())
  from auth.users u
 where u.id = cu.user_id
   and cu.accepted_at is null
   and coalesce(u.encrypted_password, '') <> '';

commit;
