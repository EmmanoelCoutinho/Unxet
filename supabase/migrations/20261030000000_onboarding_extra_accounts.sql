-- =============================================================================
-- Onboarding com várias contas
--
-- A nova empresa já pode nascer com as outras contas pedidas pelo cliente,
-- além do primeiro administrador. Todas entram no departamento padrão
-- Recepção, na mesma transação da empresa.
--
-- O limite de atendentes do plano vale para o total de contas: a checagem
-- abaixo dá a mensagem certa e o gatilho enforce_plan_attendants continua
-- barrando qualquer excesso.
-- =============================================================================

drop function if exists public.platform_onboard_clinic(text, uuid, text, text, text, text, date, text, numeric, integer);

create or replace function public.platform_onboard_clinic(
  p_clinic_name text,
  p_user_id uuid,
  p_user_name text,
  p_user_email text,
  p_plan_code text default 'essencial',
  p_status text default 'active',
  p_current_period_end date default null,
  p_billing_cycle text default 'monthly',
  p_price numeric default null,
  p_whatsapp_numbers_addon integer default null,
  -- [{ "user_id": uuid, "name": text, "email": text, "role": "admin" | "agent" }]
  p_extra_users jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_department_id uuid;
  v_plan public.subscription_plans;
  v_extra jsonb := coalesce(p_extra_users, '[]'::jsonb);
  v_item jsonb;
  v_role text;
begin
  if coalesce(btrim(p_clinic_name), '') = '' then
    raise exception 'Informe o nome da empresa';
  end if;

  select * into v_plan from public.subscription_plans p where p.code = p_plan_code;
  if not found then
    raise exception 'Plano inválido';
  end if;

  if jsonb_typeof(v_extra) <> 'array' then
    raise exception 'Lista de contas inválida';
  end if;

  if v_plan.max_attendants is not null
     and 1 + jsonb_array_length(v_extra) > v_plan.max_attendants then
    raise exception 'O plano % permite até % atendentes.', v_plan.name, v_plan.max_attendants
      using errcode = 'P0001';
  end if;

  insert into public.clinics (name)
  values (btrim(p_clinic_name))
  returning id into v_clinic_id;

  -- Antes do departamento e dos usuários: as travas já leem o plano certo
  insert into public.clinic_subscriptions (
    clinic_id, plan_code, status, current_period_end, billing_cycle, price,
    whatsapp_numbers_addon
  )
  values (
    v_clinic_id, p_plan_code, p_status, p_current_period_end, p_billing_cycle, p_price,
    p_whatsapp_numbers_addon
  );

  -- O webhook só aceita mensagens se houver um departamento padrão ATIVO
  insert into public.departments (clinic_id, name, slug, is_default, is_active)
  values (v_clinic_id, 'Recepção', 'recepcao', true, true)
  returning id into v_department_id;

  insert into public.clinic_users (
    clinic_id, user_id, role, name, department_id, email, invited_at
  )
  values (
    v_clinic_id,
    p_user_id,
    'admin',
    nullif(btrim(p_user_name), ''),
    v_department_id,
    lower(btrim(p_user_email)),
    now()
  );

  insert into public.department_members (department_id, clinic_user_id)
  values (v_department_id, p_user_id);

  for v_item in select * from jsonb_array_elements(v_extra)
  loop
    v_role := coalesce(v_item->>'role', 'agent');
    if v_role not in ('admin', 'agent') then
      raise exception 'Papel inválido para %', v_item->>'email';
    end if;

    insert into public.clinic_users (
      clinic_id, user_id, role, name, department_id, email, invited_at
    )
    values (
      v_clinic_id,
      (v_item->>'user_id')::uuid,
      v_role,
      nullif(btrim(v_item->>'name'), ''),
      v_department_id,
      lower(btrim(v_item->>'email')),
      now()
    );

    insert into public.department_members (department_id, clinic_user_id)
    values (v_department_id, (v_item->>'user_id')::uuid);
  end loop;

  return jsonb_build_object(
    'clinic_id', v_clinic_id,
    'department_id', v_department_id
  );
end;
$$;

revoke execute on function public.platform_onboard_clinic(text, uuid, text, text, text, text, date, text, numeric, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.platform_onboard_clinic(text, uuid, text, text, text, text, date, text, numeric, integer, jsonb)
  to service_role;
