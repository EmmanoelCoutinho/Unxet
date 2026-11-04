# Página de status

Mostra para as empresas clientes se o Unxet está funcionando e avisa a equipe
quando alguma parte cai.

## Como funciona

1. A edge function `health` testa cada parte do sistema e responde com o
   resultado.
2. Um serviço de monitoramento **externo** (Better Stack ou UptimeRobot) chama
   essa função a cada poucos minutos, de fora da nossa estrutura.
3. O mesmo serviço publica a página `status.unxet.com.br` e manda alerta para a
   equipe.

A página precisa ficar fora da nossa estrutura: se estivesse no Supabase ou na
Vercel, cairia junto com o sistema e o cliente não veria nada.

## A função `health`

Endereços:

| Ambiente | URL |
|---|---|
| Produção | `https://karmtrldanuxqisgzlhk.supabase.co/functions/v1/health` |
| Develop | `https://ketolvqnptmdczkzrqba.supabase.co/functions/v1/health` |

Partes testadas:

| Nome | O que testa | O cliente vê como |
|---|---|---|
| `database` | Uma consulta simples no banco | Atendimentos e dados |
| `auth` | O serviço de login do Supabase | Login |
| `storage` | O armazenamento de arquivos | Arquivos e mídias |
| `evolution` | Se o servidor da Evolution responde | WhatsApp por QR Code |

Para testar só algumas partes: `.../health?check=database,auth`.

Resposta:

```json
{
  "status": "ok",
  "checked_at": "2026-11-04T12:00:00.000Z",
  "checks": {
    "database": { "status": "ok", "latency_ms": 85 },
    "auth": { "status": "ok", "latency_ms": 60 }
  }
}
```

- `ok`: respondeu em até 2 s.
- `degraded`: respondeu, mas demorou mais de 2 s. Continua com HTTP 200, para
  não disparar alerta de queda por lentidão.
- `down`: deu erro ou passou de 8 s. A resposta vem com **HTTP 503**.

A função é pública e não devolve mensagens de erro, só status e tempo. Os
detalhes de uma falha ficam no log da função no painel do Supabase (linha
`[health]`).

Se a própria função não responder (Supabase inteiro fora), o monitor recebe
erro ou timeout e também marca como fora do ar.

## Configurar o monitoramento (Better Stack)

Feito uma vez, por quem administra a conta:

1. Criar a conta em betterstack.com (Uptime) com o e-mail da Unxet.
2. Criar um monitor por parte, todos do tipo "URL becomes unavailable":
   - **Acesso ao sistema**: `https://app.unxet.com.br`
   - **Atendimentos e dados**: `.../functions/v1/health?check=database`
   - **Login**: `.../functions/v1/health?check=auth`
   - **Arquivos e mídias**: `.../functions/v1/health?check=storage`
   - **WhatsApp por QR Code**: `.../functions/v1/health?check=evolution`
   - **Site**: `https://unxet.com.br`

   Use a URL da produção no Supabase (`https://karmtrldanuxqisgzlhk.supabase.co`),
   **nunca** `app.unxet.com.br/functions/...`: a Vercel responde 200 com a
   página do app para qualquer caminho, e o monitor ficaria sempre verde.
   Não use "Painel" no nome: é o nome de uma tela do Unxet. Intervalo de 1 minuto se o plano permitir. Ativar
   "confirmar de mais de uma região" para evitar alarme falso.
3. Em "Status pages", criar a página com esses monitores, em português, com
   nomes que o cliente entende (os da lista acima).
4. Domínio próprio: em "Custom domain", usar `status.unxet.com.br` e criar na
   GoDaddy o CNAME que o Better Stack indicar.
5. Alertas: e-mail e app no celular de quem cuida do sistema.

Dá para fazer o mesmo no UptimeRobot. Os passos são parecidos. Conferir no
plano escolhido se o intervalo de 1 minuto e o domínio próprio estão incluídos.

## Quando houver incidente

- O status de cada parte muda sozinho, pelo monitor.
- Para avisos escritos ("estamos investigando", "resolvido"), criar um
  incidente na página do Better Stack. Os clientes inscritos recebem por
  e-mail.
- Manutenção planejada: agendar na página com antecedência, além do banner de
  manutenção do próprio app.
