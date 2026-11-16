-- =============================================================================
-- Editar cliente: telefone de outro país
--
-- contact_update completava com 55 todo número de 10 ou 11 dígitos. Um
-- número da França (33 7 45 51 36 37, 11 dígitos) virava 55 33 74551-3637,
-- que não existe no WhatsApp.
--
-- Regra nova (a mesma do start-conversation e da tela):
--  - começou com +: já vem com o código do país, fica como está;
--  - 10 dígitos, ou 11 com o 9 do celular depois do DDD: Brasil, recebe o 55;
--  - 11 dígitos sem esse 9 não é celular brasileiro: fica como está;
--  - zeros da frente (011 9..., 0033...) saem.
--
-- Compatível com o front antigo, que manda o número como foi digitado:
-- DDD + número continua recebendo o 55.
-- =============================================================================

begin;

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
  v_international boolean := btrim(coalesce(p_phone, '')) like '+%';
  v_phone text := ltrim(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '0');
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

  -- Brasil sem o código do país: completa com 55
  if not v_international
     and (char_length(v_phone) = 10
          or (char_length(v_phone) = 11 and substr(v_phone, 3, 1) = '9')) then
    v_phone := '55' || v_phone;
  end if;

  if v_phone = '' then
    -- Cliente sem telefone (ex.: Instagram) continua sem; não dá para apagar
    -- o telefone de quem tem
    if v_old_phone <> '' then
      raise exception 'Informe o telefone com DDD.';
    end if;
  elsif v_phone <> v_old_phone then
    if v_phone !~ '^\d{10,15}$' then
      raise exception 'Telefone inválido. Use DDD e número; para outro país, escolha o país ao lado do número.';
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
