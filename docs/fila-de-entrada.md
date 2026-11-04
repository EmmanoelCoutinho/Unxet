# Fila de entrada dos webhooks

Garante que nenhuma mensagem de cliente se perca quando o Supabase estiver fora.

```
Meta / Evolution ──► Worker no Cloudflare ──► fila ──► edge function no Supabase
                     (responde 200 na hora)          (se falhar, tenta de novo)
```

- O Worker recebe o webhook, guarda na fila e responde na hora.
- O consumidor da fila repassa para a mesma edge function de antes
  (`evolution-in`, `meta-webhook` ou `meta-in`), com o corpo e os cabeçalhos
  originais. A assinatura da Meta e o token da Evolution continuam sendo
  conferidos pelas funções.
- Se a função responder 5xx, 408, 425 ou 429, ou não responder, a mensagem
  volta para a fila e é reenviada: 15 s, 30 s, 1 min, 2 min, 4 min, 8 min e
  depois a cada 15 min, por cerca de 24 horas (o que o plano grátis guarda).
- Se a função recusar (401, 404 etc.), a mensagem é descartada: repetir não
  adiantaria.
- Depois de 100 tentativas, a mensagem vai para a fila `...-falhas`.
- Mensagem maior que 120 KB, ou fila indisponível: o Worker repassa direto,
  como era antes. Se o Supabase também falhar, responde 503 e quem enviou
  tenta de novo (a Meta tenta; a Evolution não).
- Mensagem repetida (pode acontecer numa nova tentativa) é ignorada pelo
  `shared-in-config`, que confere o ID da mensagem.

Código em `cloudflare/webhook-gateway`. Testes rodam no `npm test`.

## Endereços

| Ambiente | Worker | Fila |
|---|---|---|
| Develop | `https://develop.unxet-entrada.workers.dev` | `unxet-entrada-develop` |
| Produção | `https://producao.unxet-entrada.workers.dev` | `unxet-entrada` |

`unxet-entrada.workers.dev` é o subdomínio da conta do Cloudflare (um por
conta). Cada Worker fica em `<nome do worker>.unxet-entrada.workers.dev`.

Caminhos aceitos: `/evolution-in`, `/meta-webhook`, `/meta-in` e `/health`
(para o monitor). A query string vai junto: `/evolution-in?token=...` chega
em `.../functions/v1/evolution-in?token=...`.

## Configuração (uma vez)

1. Criar a conta grátis no Cloudflare e o subdomínio `workers.dev` (feito
   em 04/11/2026: `unxet-entrada.workers.dev`).
2. Criar um token de API (My Profile → API Tokens → Create Token → modelo
   "Edit Cloudflare Workers"), garantindo a permissão **Account → Queues →
   Edit**.
3. No GitHub (Settings → Secrets and variables → Actions), criar os secrets
   do repositório `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` (o ID
   aparece na página inicial da conta).
4. Rodar o workflow **Cloudflare (deploy)** na develop (Actions → Run
   workflow). Ele cria as filas e publica o Worker. Depois, publica sozinho a
   cada push na develop e na main que mexa em `cloudflare/webhook-gateway`.

Sem os secrets, o workflow só avisa e não publica.

## Ligar no develop

1. No Supabase do develop, trocar o secret `EVOLUTION_INSTANCE_WEBHOOK_URL`
   para `https://develop.unxet-entrada.workers.dev/evolution-in?token=<EVOLUTION_WEBHOOK_SECRET>`.
2. Reconectar o número de teste pelo app (o `create-evolution-connection`
   grava o webhook novo na instância).
3. Mandar mensagens para o número e conferir que chegam no app.

## Ligar na produção

1. **Evolution:** no servidor, trocar `WEBHOOK_GLOBAL_URL` para
   `https://producao.unxet-entrada.workers.dev/evolution-in?token=<o mesmo token de hoje>`
   e recriar o container (`docker compose up -d`) num horário calmo.
2. **WhatsApp oficial:** no app da Meta, em WhatsApp → Configuration →
   Webhook, trocar a Callback URL para
   `https://producao.unxet-entrada.workers.dev/meta-webhook` (o verify
   token continua o mesmo; a verificação passa direto para a função).
3. **Instagram e Messenger**, quando forem lançados: `.../meta-in`.
4. No Better Stack, criar o monitor **Recebimento de mensagens** em
   `https://producao.unxet-entrada.workers.dev/health`.

## Voltar atrás

Basta apontar os webhooks de novo direto para o Supabase
(`https://karmtrldanuxqisgzlhk.supabase.co/functions/v1/<função>`). O Worker
pode continuar publicado sem receber nada.

## Acompanhar

- Logs: painel do Cloudflare → Workers & Pages → `producao` → Logs, ou
  `npx wrangler tail --env production` na pasta do Worker.
  - `[GATEWAY_RETRY]`: o Supabase não respondeu; a mensagem será reenviada.
  - `[GATEWAY_DELIVERED_LATE]`: entregue depois de alguma tentativa.
  - `[GATEWAY_REJECTED]`: a função recusou (token, assinatura, conexão).
  - `[GATEWAY_DIRECT_FAILED]`: fila e Supabase fora ao mesmo tempo.
- Volume: painel do Cloudflare → Queues. O plano grátis tem 10 mil
  operações por dia (cerca de 3 mil webhooks). Acima disso, ou para guardar
  mensagens por mais de 24 horas, assinar o Workers Paid (US$ 5/mês) e subir a
  retenção da fila para 14 dias.
- Os cabeçalhos `x-unxet-gateway` e `x-unxet-received-at` chegam nas funções:
  mostram que a mensagem veio pela fila e quando ela foi recebida.
