-- =============================================================================
-- Tipos aceitos no bucket whatsapp-media
--
-- O botão "Abrir" da conversa leva direto ao link do Storage. Um arquivo
-- gravado como HTML, SVG ou XML rodaria script no navegador do atendente.
-- O front e as edge functions já gravam só tipos seguros (texto e marcação
-- como text/plain, o resto como binário: _shared/storageContentType.ts).
-- Esta trava garante o mesmo para quem tentar subir direto pela API do
-- Storage com o próprio login.
--
-- Manter igual a STORAGE_ALLOWED_MIME_TYPES em _shared/storageContentType.ts.
-- =============================================================================

update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg',
     'image/png',
     'image/webp',
     'image/gif',
     'audio/*',
     'video/*',
     'application/pdf',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-powerpoint',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'application/x-pkcs12',
     'application/zip',
     'application/octet-stream',
     'text/plain'
   ]
 where id = 'whatsapp-media';
