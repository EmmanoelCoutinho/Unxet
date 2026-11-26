-- =============================================================================
-- Trava da recuperação de mensagens ao reconectar o WhatsApp por QR Code
--
-- Ao ler o QR Code de novo, o gatilho mark_inbound_recovery marca a conexão e
-- o evolution-connection-sync importa o que chegou no celular enquanto o
-- número estava fora. Em empresas de teste e de demonstração isso traz de
-- volta conversas que foram apagadas de propósito, a cada reconexão.
--
--   platform_settings.whatsapp_recovery_enabled  liga/desliga para a
--       plataforma inteira (no develop fica desligado: é um dado do ambiente,
--       mudado fora desta migration)
--   clinics.whatsapp_recovery_disabled           desliga para uma empresa
--
-- Na produção: Unxet DEMO e Teste Cezar ficam sem a recuperação.
-- Reconexões já marcadas dessas empresas são canceladas.
--
-- Ordem de deploy: só esta migration (as functions não mudam).
-- =============================================================================

begin;

alter table public.platform_settings
  add column if not exists whatsapp_recovery_enabled boolean not null default true;

alter table public.clinics
  add column if not exists whatsapp_recovery_disabled boolean not null default false;

-- Empresas de teste e de demonstração (ids da produção; no develop não existem)
update public.clinics
   set whatsapp_recovery_disabled = true
 where id in (
   'e5e59168-184e-47ce-8a2a-fe33abbfb939', -- Unxet DEMO
   'a02fff34-3ccd-427b-a0d1-7c526b60d8b8'  -- Teste Cezar
 );

create or replace function public.mark_inbound_recovery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
begin
  if new.provider = 'evolution'
     and new.channel = 'whatsapp'
     and new.status = 'connected'
     and old.status is distinct from 'connected' then
    -- Desligada na plataforma (develop) ou na empresa (teste, demonstração)
    if not coalesce((select ps.whatsapp_recovery_enabled from public.platform_settings ps limit 1), true)
       or coalesce((select c.whatsapp_recovery_disabled from public.clinics c where c.id = new.clinic_id), false) then
      return new;
    end if;

    select max(c.last_inbound_at) into v_from
    from public.conversations c
    where c.channel_connection_id = new.id;

    if v_from is not null then
      new.inbound_recovery_requested_at := now();
      new.inbound_recovery_from := v_from;
      new.inbound_recovery_total := null;
      new.inbound_recovery_done := 0;
      new.inbound_recovery_progress_at := now();
    end if;
  end if;
  return new;
end;
$$;

-- Recuperação em andamento das empresas travadas: encerra
update public.channel_connections cc
   set inbound_recovery_requested_at = null,
       inbound_recovery_from = null,
       inbound_recovery_total = null,
       inbound_recovery_done = 0
  from public.clinics c
 where c.id = cc.clinic_id
   and c.whatsapp_recovery_disabled
   and cc.inbound_recovery_requested_at is not null;

commit;
