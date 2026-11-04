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

O vídeo vai para `public/tutorials/<id>.webm`. Use `--headed` para assistir
a gravação. Se algo falhar, a tela do momento do erro fica em `erro.png`.

## Criar um tutorial novo

1. Copie `scenarios/criar-atendente.mjs` com o id do tutorial (o mesmo de
   `src/modules/tutorials/tutorials.ts`).
2. Use o "diretor" (`director.mjs`): `title`, `caption`, `click`, `type`,
   `select`, `point` e `wait`.
3. Em `cleanupEmails`, liste o que o roteiro cria e precisa ser apagado antes
   de gravar de novo.
4. Grave e preencha `video` e `duration` no tutorial.
