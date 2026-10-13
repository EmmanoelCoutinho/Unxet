-- =============================================================================
-- clinic_users.accepted_at passa a refletir o aceite do convite
--
-- Até aqui o campo nunca era preenchido, então não havia como saber quem ainda
-- não aceitou o convite (necessário para exibir "Convite pendente" e permitir
-- reenviar o e-mail quando o link expira).
--
-- O convite é considerado aceito quando o Supabase Auth confirma o e-mail do
-- usuário (clique no link do convite) ou quando ele faz login pela primeira vez.
-- =============================================================================

begin;

create or replace function public.mark_clinic_user_invite_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is null and new.last_sign_in_at is null then
    return new;
  end if;

  update public.clinic_users
     set accepted_at = coalesce(new.email_confirmed_at, new.last_sign_in_at, now())
   where user_id = new.id
     and accepted_at is null;

  return new;
end;
$$;

revoke execute on function public.mark_clinic_user_invite_accepted()
  from public, anon, authenticated;

drop trigger if exists trg_mark_clinic_user_invite_accepted on auth.users;
create trigger trg_mark_clinic_user_invite_accepted
  after update of email_confirmed_at, last_sign_in_at on auth.users
  for each row execute function public.mark_clinic_user_invite_accepted();

-- Backfill: quem já confirmou o e-mail ou já entrou no sistema aceitou o convite.
update public.clinic_users cu
   set accepted_at = coalesce(u.email_confirmed_at, u.last_sign_in_at)
  from auth.users u
 where u.id = cu.user_id
   and cu.accepted_at is null
   and (u.email_confirmed_at is not null or u.last_sign_in_at is not null);

commit;
