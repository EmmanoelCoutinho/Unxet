# Lançamentos em blocos

As mudanças passam primeiro pelo ambiente de testes (develop) e vão para a
produção juntas, quando o bloco inteiro estiver testado.

| | Testes (develop) | Produção |
|---|---|---|
| Branch | `develop` | `main` |
| App | develop.unxet.com.br | app.unxet.com.br |
| Supabase | `ketolvqnptmdczkzrqba` | `karmtrldanuxqisgzlhk` |
| Publicação do Supabase | automática no merge | no merge, depois de aprovar no GitHub |

No app de testes aparece o selo **Testes** ao lado do logo, e o sino mostra a
próxima versão como **Em teste**. Na produção, nenhum dos dois aparece.

## Dia a dia (uma tarefa do ClickUp)

1. Crie o branch a partir da `develop` com o ID da tarefa no nome
   (ex.: `CU-86abc123-funil-filtros`). O card vai para **Em andamento**.
2. Abra o PR com base na `develop`. O card vai para **Em revisão**.
3. Se a mudança for visível para quem usa o app, escreva o que mudou em
   `NEXT_RELEASE` (`src/modules/changelog/releases.ts`), em linguagem de cliente.
4. Merge do PR: a Vercel publica em develop.unxet.com.br e, se o PR mexeu em
   `supabase/`, o GitHub aplica as migrations e publica as functions no
   develop. O card vai para **Em teste**.
5. Testou e está tudo certo: card em **Pronto para produção**.

## Lançamento (o bloco)

Quando todos os cards do bloco estiverem em **Pronto para produção**:

1. Feche a versão do sino na `develop`:
   ```bash
   git switch develop
   git pull
   git switch -c lancamento/AAAA-MM-DD
   npm run release
   ```
   Use `npm run release -- --major` para uma versão grande. Faça o commit de
   `releases.ts`, abra o PR para a `develop` e faça o merge.
2. Abra o PR **`develop` → `main`** com o título "Lançamento X.Y.Z" e a lista
   das tarefas. O CI bloqueia se `NEXT_RELEASE` não estiver vazia.
3. Faça o merge com **Create a merge commit** (não use squash, senão a
   `develop` e a `main` se separam).
4. A Vercel publica em app.unxet.com.br. O workflow **Supabase (deploy)** fica
   esperando aprovação: em Actions, abra a execução e clique em
   **Review deployments → Approve**. Ele aplica as migrations e depois as
   functions.
5. Mova os cards para **Publicado**.

## Correção urgente (hotfix)

1. Branch a partir da `main`, PR direto para a `main`. Se for visível, crie a
   entrada com data em `RELEASE_ENTRIES` (não em `NEXT_RELEASE`).
2. Depois do merge, traga a `main` para a `develop` (PR `main` → `develop`).

## O que é compartilhado entre os dois ambientes

- **Servidor da Evolution**: é o mesmo. O webhook global aponta para a
  produção, então cada instância do develop precisa do próprio webhook
  (`/webhook/set/<instância>` apontando para o `evolution-in` do develop).
- **Apps da Meta**: os webhooks apontam para a produção. No develop dá para
  enviar mensagens pelo WhatsApp oficial e pelo Instagram, mas não receber.
- **Conversor de áudio e e-mail**: os mesmos da produção.
- **Secrets das functions** (`supabase secrets set`): são de cada projeto e
  não são publicados pelo workflow.

## Configuração (uma vez só)

- **Vercel**: domínio `develop.unxet.com.br` ligado ao branch `develop`;
  variável `VITE_APP_URL=https://develop.unxet.com.br` em Preview, só para o
  branch `develop`.
- **Supabase develop** (Authentication → URL Configuration): Site URL
  `https://develop.unxet.com.br` e o mesmo endereço com `/**` nos Redirect URLs.
- **GitHub** (Settings → Environments): ambientes `supabase-develop` e
  `supabase-production`, cada um com a variável `SUPABASE_PROJECT_REF` e os
  secrets `SUPABASE_ACCESS_TOKEN` e `SUPABASE_DB_PASSWORD`. No de produção,
  marque **Required reviewers** e **Deployment branches: main**.
- **GitHub** (Settings → Rules): proteger `main` e `develop` (só por PR, CI
  passando).
- **Histórico de migrations da produção**: a produção veio de um dump e não
  registra as migrations anteriores a 20261021000000. Sem corrigir, o
  `db push` do workflow recusa (não reaplica nada). Para corrigir uma vez, com
  o projeto da produção vinculado, marque essas versões como aplicadas (só
  grava no histórico, não roda SQL):
  ```bash
  supabase migration repair --linked --status applied 20260620000100 20261006000000 20261007000000 20261007100000 20261007110000 20261008000000 20261008100000 20261008200000 20261011000000 20261011100000 20261011100100 20261011100200 20261012000000 20261012100000 20261012200000 20261013000000 20261013100000 20261013200000 20261014000000 20261015000000 20261015100000 20261016000000 20261017000000 20261018000000 20261019000000
  ```
  Depois, `supabase db push --linked --dry-run` deve dizer que está tudo em dia.
