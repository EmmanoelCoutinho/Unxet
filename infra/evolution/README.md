# Evolution API: patch do `<status>` (número "mudo")

## O problema

Desde o fim de setembro de 2026 o WhatsApp manda os Status dos contatos como um
`<status>` solto. O Baileys 7.0.0-rc.9 (Evolution 2.3.x) não confirma (ack)
esse aviso. Enquanto ele fica sem confirmação, o WhatsApp **segura as mensagens
novas** da sessão e derruba a conexão a cada ~50 min. O número aparece
"Connected" e envia, mas não recebe; as mensagens presas chegam horas depois,
em pacotes. Reiniciar a instância não resolve; ler o QR de novo alivia por
algumas horas.

Assinatura no log da Evolution:

```
"reasonNode":{"tag":"ack","attrs":{"class":"status",...}} ... "msg":"stream errored out"
```

Caso real: Ideal Contabilidade/Legalização, 16–17/11/2026 (mensagens das 16h
chegaram de madrugada e reabriram conversas com o bot).

Correção oficial: WhiskeySockets/Baileys#2883 e evolution-api PR #2785 (abertos
em 17/11/2026). Este patch é o backport, até a Evolution sair com o Baileys
corrigido. Ao atualizar a Evolution, confira se ainda é preciso: o script recusa
rodar num arquivo que já tem a correção.

## O que o patch muda

Arquivo `/evolution/node_modules/baileys/lib/Socket/messages-recv.js`:

1. `handleStatus`: só manda o ack do `<status>` (não decodifica nada).
2. `<status>` que chega na fila offline (ao reconectar) também é confirmado.
3. Um erro num item da fila offline não trava mais a fila.
4. `ws.on('CB:status')`: confirma o `<status>` com a conexão aberta.

Cada ponto de ancoragem precisa existir exatamente uma vez; se não existir, o
build falha em vez de gerar uma imagem quebrada.

## Aplicar no servidor

1. Anote a imagem atual (é ela que vira `EVOLUTION_IMAGE` e é para ela que se volta):

   ```bash
   docker ps --format '{{.Names}}  {{.Image}}'
   ```

2. Copie esta pasta para o servidor (ex.: `/root/evolution-patch`) e gere a imagem:

   ```bash
   cd /root/evolution-patch
   docker build --build-arg EVOLUTION_IMAGE=<imagem atual> -t unxet/evolution-api:v2.3.7-status-ack .
   ```

3. Backup do compose e troca da imagem do serviço da Evolution:

   ```bash
   cp docker-compose.yml docker-compose.yml.bak-$(date +%F)
   # em docker-compose.yml, no serviço evolution-api:
   #   image: unxet/evolution-api:v2.3.7-status-ack
   docker compose up -d evolution-api
   ```

   As sessões ficam no Postgres: as instâncias reconectam sozinhas, sem QR.

4. Conferir (as mensagens presas devem chegar em ~1 min):

   ```bash
   docker exec evolution-api grep -c "unxet-patch" /evolution/node_modules/baileys/lib/Socket/messages-recv.js   # 4
   docker logs --since 10m evolution-api 2>&1 | grep -c '"msg":"stream errored out"'                          # deve parar de subir
   ```

   No dia seguinte, a contagem por hora de `stream errored out` deve ficar perto de zero.

## Voltar atrás

```bash
cp docker-compose.yml.bak-AAAA-MM-DD docker-compose.yml
docker compose up -d evolution-api
```
