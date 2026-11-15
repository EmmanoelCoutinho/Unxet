# Vídeos da tela Tutoriais

Os vídeos são gravados pelo Playwright no **ambiente local** (Supabase do Docker,
Empresa Teste), com cursor, legendas e telas de abertura e encerramento
desenhados na própria página. Nada de dado real aparece.

## Gravar

1. Suba o Supabase local e o app apontando para ele: `.env.local` (ou
   `.env.localtest.local`, com o app em `vite --mode localtest`) com
   `VITE_SUPABASE_URL=http://127.0.0.1:54321` e `LOCAL_TEST_PASSWORD`.
2. Nesta pasta:

```bash
npm install
node record.mjs criar-atendente --url http://localhost:5173
```

O vídeo vai para `out/<id>.mp4` (fora do git). Use `--headed` para assistir
a gravação. Se algo falhar, a tela do momento do erro fica em `erro.png`.

Para revisar sem assistir tudo, `node frames.mjs <id> [segundos] [início]`
monta uma folha com quadros do vídeo em `out/<id>-quadros-<início>.jpg`.

## Publicar

Os vídeos ficam no bucket público `tutorials` do Supabase Storage (migration
`20261124000000_tutorials_bucket.sql`), não no repositório. Envie para o
develop e para a produção (na raiz do projeto, PowerShell ou bash):

```bash
node scripts/tutorials/upload.mjs --project ketolvqnptmdczkzrqba criar-atendente
node scripts/tutorials/upload.mjs --project karmtrldanuxqisgzlhk criar-atendente
```

`--project` busca a service role pelo CLI do Supabase (precisa estar logado
no CLI) e cria o bucket se ainda não existir. `--all` envia tudo que estiver
em `out/`. Regravar com o mesmo id substitui o
arquivo (o navegador pega o novo em até 1 hora).

O app monta o link a partir do `VITE_SUPABASE_URL`. Rodando o app no banco
local (que não tem os vídeos), use
`VITE_TUTORIALS_URL=https://ketolvqnptmdczkzrqba.supabase.co/storage/v1/object/public/tutorials`
para assistir os do develop.

## WhatsApp por QR Code

O roteiro `conectar-whatsapp-qr` usa uma Evolution de mentira
(`mock-evolution.mjs`, porta 8080): o QR mostrado só abre o site da Unxet.
A Evolution local de verdade precisa estar desligada, e o Supabase local
precisa ter sido iniciado com `supabase/functions/.env` presente. A tabela
`channel_connections` precisa estar na publicação `supabase_realtime` do
banco local para a tela mudar sozinha quando o número conecta.

## Opções do roteiro

- `meta.login`: quem aparece no vídeo (padrão `admin@teste.local`). O dia a dia
  do atendente usa `mariana@teste.local` (Mariana Souza, Recepção), com a
  mesma `LOCAL_TEST_PASSWORD`.
- `meta.mockEvolution`: `true` (porta 8080) ou a lista de portas. Os envios de
  mensagem da Empresa Teste vão para a 8787.
- `bringActivityToToday` / `restoreActivity` (`db.mjs`): adiantam as datas
  da atividade de demonstração para hoje (Painel e Relatórios cheios) e
  devolvem no fim.
- O banco local precisa ter na publicação `supabase_realtime` as tabelas que
  o app escuta (conversations, messages, conversation_tags, channel_connections
  e outras), senão a tela não muda sozinha.

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
4. Grave, publique (`upload.mjs`) e preencha `video` (`<id>.mp4`) e
   `duration` no tutorial.
