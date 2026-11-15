-- =============================================================================
-- Dados da empresa (Configurações > Dados da empresa)
--
-- clinics só tinha o nome. Entram razão social, CNPJ/CPF, telefone, e-mail,
-- site e endereço. Quem edita é o Administrador da empresa (Configurações é
-- só admin, como decidido nos cargos personalizados).
--
-- Escrita: só pela clinic_update_profile (security definer), que confere o
-- admin e valida os campos. O app perde INSERT/UPDATE/DELETE direto na tabela
-- (nada no front escrevia nela; o onboarding cria a empresa por função
-- security definer). anon não tem motivo para tocar na tabela.
--
-- Leitura: antes só o admin lia a própria empresa, então o cabeçalho do
-- atendente ficava sem o nome dela. Agora todo membro lê a própria empresa.
-- =============================================================================

begin;

alter table public.clinics
  add column if not exists legal_name text,
  add column if not exists document text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists website text,
  add column if not exists postal_code text,
  add column if not exists street text,
  add column if not exists street_number text,
  add column if not exists complement text,
  add column if not exists neighborhood text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists updated_at timestamptz;

alter table public.clinics
  drop constraint if exists clinics_name_length,
  add constraint clinics_name_length check (char_length(btrim(name)) between 1 and 120) not valid,
  drop constraint if exists clinics_document_format,
  add constraint clinics_document_format check (document is null or document ~ '^(\d{11}|\d{14})$'),
  drop constraint if exists clinics_phone_format,
  add constraint clinics_phone_format check (phone is null or phone ~ '^\d{10,15}$'),
  drop constraint if exists clinics_email_length,
  add constraint clinics_email_length check (email is null or char_length(email) <= 254),
  drop constraint if exists clinics_website_length,
  add constraint clinics_website_length check (website is null or char_length(website) <= 200),
  drop constraint if exists clinics_postal_code_format,
  add constraint clinics_postal_code_format check (postal_code is null or postal_code ~ '^\d{8}$'),
  drop constraint if exists clinics_state_format,
  add constraint clinics_state_format check (state is null or state ~ '^[A-Z]{2}$');

-- Leitura: qualquer membro da própria empresa
drop policy if exists "admins can view clinics" on public.clinics;
drop policy if exists "members can view own clinic" on public.clinics;
create policy "members can view own clinic"
  on public.clinics
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.clinic_users cu
      where cu.user_id = auth.uid()
        and cu.clinic_id = clinics.id
    )
  );

revoke all on table public.clinics from anon;
revoke insert, update, delete, truncate, trigger, references on table public.clinics from authenticated;
grant select on table public.clinics to authenticated;

create or replace function public.clinic_update_profile(
  p_clinic_id uuid,
  p_profile jsonb
)
returns public.clinics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.clinics%rowtype;
  v_name text := nullif(btrim(coalesce(p_profile->>'name', '')), '');
  v_legal_name text := nullif(btrim(coalesce(p_profile->>'legal_name', '')), '');
  v_document text := nullif(regexp_replace(coalesce(p_profile->>'document', ''), '\D', '', 'g'), '');
  v_phone text := nullif(regexp_replace(coalesce(p_profile->>'phone', ''), '\D', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_profile->>'email', ''))), '');
  v_website text := nullif(btrim(coalesce(p_profile->>'website', '')), '');
  v_postal_code text := nullif(regexp_replace(coalesce(p_profile->>'postal_code', ''), '\D', '', 'g'), '');
  v_street text := nullif(btrim(coalesce(p_profile->>'street', '')), '');
  v_street_number text := nullif(btrim(coalesce(p_profile->>'street_number', '')), '');
  v_complement text := nullif(btrim(coalesce(p_profile->>'complement', '')), '');
  v_neighborhood text := nullif(btrim(coalesce(p_profile->>'neighborhood', '')), '');
  v_city text := nullif(btrim(coalesce(p_profile->>'city', '')), '');
  v_state text := nullif(upper(btrim(coalesce(p_profile->>'state', ''))), '');
begin
  if auth.uid() is null or p_clinic_id is null or not public.is_clinic_admin_of(p_clinic_id) then
    raise exception 'Só o administrador da empresa pode alterar os dados da empresa.';
  end if;

  if v_name is null then
    raise exception 'Informe o nome da empresa.';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'O nome pode ter no máximo 120 caracteres.';
  end if;
  if char_length(coalesce(v_legal_name, '')) > 160 then
    raise exception 'A razão social pode ter no máximo 160 caracteres.';
  end if;

  if v_document is not null and char_length(v_document) not in (11, 14) then
    raise exception 'CNPJ ou CPF inválido.';
  end if;

  if v_phone is not null then
    if v_phone !~ '^\d{10,15}$' then
      raise exception 'Telefone inválido. Use DDD e número.';
    end if;
    -- Brasil sem o código do país: completa com 55
    if char_length(v_phone) in (10, 11) then
      v_phone := '55' || v_phone;
    end if;
  end if;

  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'E-mail inválido.';
  end if;

  if v_website is not null then
    if v_website !~* '^https?://' then
      v_website := 'https://' || v_website;
    end if;
    if char_length(v_website) > 200 or v_website ~ '\s' or v_website !~* '^https?://[^/]+\.[^/]+' then
      raise exception 'Site inválido.';
    end if;
  end if;

  if v_postal_code is not null and v_postal_code !~ '^\d{8}$' then
    raise exception 'CEP inválido. Use 8 números.';
  end if;

  if v_state is not null and v_state not in (
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
    'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
  ) then
    raise exception 'Estado (UF) inválido.';
  end if;

  if greatest(
    char_length(coalesce(v_street, '')),
    char_length(coalesce(v_complement, '')),
    char_length(coalesce(v_neighborhood, '')),
    char_length(coalesce(v_city, ''))
  ) > 120 or char_length(coalesce(v_street_number, '')) > 20 then
    raise exception 'Algum campo do endereço passou do tamanho máximo.';
  end if;

  update public.clinics
     set name = v_name,
         legal_name = v_legal_name,
         document = v_document,
         phone = v_phone,
         email = v_email,
         website = v_website,
         postal_code = v_postal_code,
         street = v_street,
         street_number = v_street_number,
         complement = v_complement,
         neighborhood = v_neighborhood,
         city = v_city,
         state = v_state,
         updated_at = now()
   where id = p_clinic_id
  returning * into v_row;

  if not found then
    raise exception 'Empresa não encontrada.';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.clinic_update_profile(uuid, jsonb) from public, anon;
grant execute on function public.clinic_update_profile(uuid, jsonb) to authenticated;

commit;
