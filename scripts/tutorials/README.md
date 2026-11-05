# Vídeos da tela Tutoriais

Os vídeos são gravados pelo Playwright no **ambiente local** (Supabase do Docker,
Empresa Teste), com cursor, legendas e telas de abertura e encerramento
desenhados na própria página. Nada de dado real aparece.

## Gravar

1. Suba o Supabase local e o app apontando para ele (`.env.local` com
   `VITE_SUPABASE_URL=http://127.0.0.1:54321` e `LOCAL_TEST_PASSWORD`).
2. Nesta pasta:

```bash
npm install
node record.mjs criar-atendente --url http://localhost:5173
```

O vídeo vai para `public/tutorials/<id>.mp4`. Use `--headed` para assistir
a gravação. Se algo falhar, a tela do momento do erro fica em `erro.png`.

## WhatsApp por QR Code

O roteiro `conectar-whatsapp-qr` usa uma Evolution de mentira
(`mock-evolution.mjs`, porta 8080): o QR mostrado só abre o site da Unxet.
A Evolution local de verdade precisa estar desligada, e o Supabase local
precisa ter sido iniciado com `supabase/functions/.env` presente. A tabela
`channel_connections` precisa estar na publicação `supabase_realtime` do
banco local para a tela mudar sozinha quando o número conecta.

## Música

Todos os vídeos usam a mesma trilha, composta pelo próprio script (`music.mjs`,
sem direitos autorais de terceiros). Para ouvir: `node music.mjs 30` gera
`trilha-previa.wav`. O ffmpeg vem do pacote `ffmpeg-static`.

## Criar um tutorial novo

1. Copie `scenarios/criar-atendente.mjs` com o id do tutorial (o mesmo de
   `src/modules/tutorials/tutorials.ts`).
2. Use o "diretor" (`director.mjs`): `title`, `caption`, `click`, `type`,
   `select`, `point` e `wait`.
3. Em `cleanupEmails`, liste o que o roteiro cria e precisa ser apagado antes
   de gravar de novo.
   Para mudanças maiores no banco local, exporte `prepare(db)` e
   `restore(db, estado)` (restore roda mesmo se a gravação falhar).
   Exemplo: `scenarios/conectar-whatsapp-qr.mjs`.
4. Grave e preencha `video` e `duration` no tutorial.
