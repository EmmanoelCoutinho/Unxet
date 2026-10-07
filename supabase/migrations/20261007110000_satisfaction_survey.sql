-- =============================================================================
-- Pesquisa de satisfação (CSAT 1 a 5)
--
-- Fluxo:
--  1. close-conversation encerra a conversa e, se a pesquisa estiver ativa,
--     envia a pergunta ao cliente e cria um registro "sent".
--  2. Quando o cliente responde com uma nota de 1 a 5 dentro da janela,
--     shared-in-config / meta-in registram a nota ("answered"), enviam o
--     agradecimento e NÃO reabrem a conversa.
--  3. Qualquer outra resposta marca a pesquisa como "skipped" e segue o fluxo
--     normal (reabertura / novo atendimento).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Configuração por clínica
-- -----------------------------------------------------------------------------
alter table public.conversation_automation_settings
  add column if not exists satisfaction_survey_enabled boolean not null default false,
  add column if not exists satisfaction_survey_message text not null
    default 'Como você avalia o nosso atendimento? Responda com uma nota de 1 a 5, sendo 1 muito insatisfeito e 5 muito satisfeito.',
  add column if not exists satisfaction_survey_thanks_message text
    default 'Obrigado pela sua avaliação!',
  add column if not exists satisfaction_survey_window_minutes integer not null default 1440;

alter table public.conversation_automation_settings
  drop constraint if exists conversation_automation_settings_survey_window_check;
alter table public.conversation_automation_settings
  add constraint conversation_automation_settings_survey_window_check
  check (satisfaction_survey_window_minutes between 5 and 10080);

alter table public.conversation_automation_settings
  drop constraint if exists conversation_automation_settings_survey_message_check;
alter table public.conversation_automation_settings
  add constraint conversation_automation_settings_survey_message_check
  check (length(btrim(satisfaction_survey_message)) > 0);

-- -----------------------------------------------------------------------------
-- Pesquisas enviadas / respondidas
-- -----------------------------------------------------------------------------
create table if not exists public.satisfaction_surveys (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  channel_connection_id uuid references public.channel_connections(id) on delete set null,
  channel text,
  -- atendente responsável no momento do encerramento
  agent_user_id uuid references auth.users(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  status text not null default 'sent'
    check (status in ('sent', 'answered', 'skipped', 'expired', 'failed')),
  score smallint check (score between 1 and 5),
  raw_answer text,
  error text,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  constraint satisfaction_surveys_answer_check
    check ((status = 'answered') = (score is not null))
);

create index if not exists satisfaction_surveys_pending_idx
  on public.satisfaction_surveys (clinic_id, contact_id, channel_connection_id, sent_at desc)
  where status = 'sent';

create index if not exists satisfaction_surveys_clinic_sent_idx
  on public.satisfaction_surveys (clinic_id, sent_at desc);

create index if not exists satisfaction_surveys_conversation_idx
  on public.satisfaction_surveys (conversation_id);

alter table public.satisfaction_surveys enable row level security;

-- Leitura: admins veem a clínica toda; atendentes, as próprias avaliações.
-- Escrita apenas pelas edge functions (service role).
drop policy if exists "satisfaction_surveys_select" on public.satisfaction_surveys;
create policy "satisfaction_surveys_select"
  on public.satisfaction_surveys
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.clinic_users cu
      where cu.user_id = auth.uid()
        and cu.clinic_id = satisfaction_surveys.clinic_id
        and (cu.role = 'admin' or satisfaction_surveys.agent_user_id = auth.uid())
    )
  );

revoke insert, update, delete on public.satisfaction_surveys from anon, authenticated;

commit;
