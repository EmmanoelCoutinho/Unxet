-- =============================================================================
-- Transcrições presas em "Transcrevendo..."
--
-- messages.transcript_status tinha DEFAULT 'PENDING': toda mensagem (inclusive
-- texto e áudios sem job, como os da Evolution e do Instagram) nascia
-- "pendente" e a tela mostrava o carregamento para sempre. Além disso, o
-- disparo dos jobs chamava uma função inexistente (transcribe-worker), então
-- nenhum job era processado.
--
-- Agora o status só é preenchido quando um job de transcrição é criado
-- (edge functions via _shared/transcription.ts).
-- =============================================================================

begin;

alter table public.messages alter column transcript_status drop default;

-- Mensagens que não são áudio nunca deveriam ter status de transcrição
update public.messages
   set transcript_status = null
 where transcript_status = 'PENDING'
   and type is distinct from 'audio';

-- Áudios presos: viram FAILED para exibir o botão "solicitar novo processamento".
-- Antes desta correção nenhum job era processado, então todo PENDING está
-- travado. Aplicar ANTES de publicar as edge functions corrigidas.
update public.messages
   set transcript_status = 'FAILED',
       transcript_error = 'transcription_not_started'
 where type = 'audio'
   and transcript_status in ('PENDING', 'PROCESSING');

update public.transcription_jobs
   set status = 'FAILED',
       error = 'never_processed',
       updated_at = now()
 where status in ('PENDING', 'PROCESSING');

commit;
