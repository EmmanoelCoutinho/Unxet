-- =============================================================================
-- Editar cliente na Carteira de clientes
--
-- contacts não tem política de update para o app (só as edge functions, com o
-- service role, escrevem). A edição passa por contact_update, que confere a
-- empresa e a permissão contacts.view (a mesma que abre a Carteira).
--
-- Campos: nome, telefone e e-mail (coluna nova).
--
-- Telefone: é por ele que as mensagens recebidas encontram o cliente
-- (evolution-in compara contacts.phone; meta-in, phone ou meta_contact_id).
-- Por isso: só dígitos, 10 a 15; não pode repetir o de outro cliente da
-- empresa; e o meta_contact_id acompanha quando era igual ao telefone antigo
-- (contato do WhatsApp), senão a próxima mensagem criaria um cliente duplicado.
--
-- O nome editado não é sobrescrito depois: as funções de entrada só preenchem
-- o nome quando ele está vazio (ou "Cliente").
-- =============================================================================

begin;

alter table public.contacts
  add column if not exists email text;

alter table public.contacts
  drop constraint if exists contacts_email_length,
  add constraint contacts_email_length check (email is null or char_length(email) <= 254);

create or replace function public.contact_update(
  p_contact_id uuid,
  p_name text,
  p_phone text,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.contacts%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_old_phone text;
  v_duplicate text;
begin
  if auth.uid() is null then
    raise exception 'Não autorizado';
  end if;

  select * into v_contact from public.contacts where id = p_contact_id for update;
  if not found
     or v_contact.clinic_id is null
     or not public.has_clinic_permission(v_contact.clinic_id, 'contacts.view') then
    raise exception 'Cliente não encontrado.';
  end if;

  if v_name is null then
    raise exception 'Informe o nome do cliente.';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'O nome pode ter no máximo 120 caracteres.';
  end if;

  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'E-mail inválido.';
  end if;

  v_old_phone := regexp_replace(coalesce(v_contact.phone, ''), '\D', '', 'g');

  if v_phone = '' then
    -- Cliente sem telefone (ex.: Instagram) continua sem; não dá para apagar
    -- o telefone de quem tem
    if v_old_phone <> '' then
      raise exception 'Informe o telefone com DDD.';
    end if;
  elsif v_phone <> v_old_phone then
    if v_phone !~ '^\d{10,15}$' then
      raise exception 'Telefone inválido. Use DDD e número (com o 55 do Brasil, se quiser).';
    end if;

    -- Brasil sem o código do país: completa com 55
    if char_length(v_phone) in (10, 11) then
      v_phone := '55' || v_phone;
    end if;

    select coalesce(nullif(btrim(c.name), ''), c.phone) into v_duplicate
      from public.contacts c
     where c.clinic_id = v_contact.clinic_id
       and c.id <> v_contact.id
       and (
         regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_phone
         or c.meta_contact_id = v_phone
       )
     limit 1;
    if v_duplicate is not null then
      raise exception 'Já existe um cliente com este telefone: %.', v_duplicate;
    end if;
  end if;

  update public.contacts
     set name = v_name,
         email = v_email,
         phone = case when v_phone = '' or v_phone = v_old_phone then phone else v_phone end,
         meta_contact_id = case
           when v_phone <> '' and v_phone <> v_old_phone and meta_contact_id = v_contact.phone then v_phone
           else meta_contact_id
         end,
         updated_at = now()
   where id = v_contact.id;
end;
$$;

revoke execute on function public.contact_update(uuid, text, text, text) from public, anon;
grant execute on function public.contact_update(uuid, text, text, text) to authenticated;

commit;
