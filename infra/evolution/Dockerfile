# Evolution API com o patch do <status> no Baileys (ver patch-baileys-status.cjs).
# EVOLUTION_IMAGE = a imagem que o servidor usa hoje (docker ps). Fixe a tag;
# nunca use :latest, senão uma atualização troca o código sem o patch.
ARG EVOLUTION_IMAGE=evoapicloud/evolution-api:v2.3.7
FROM ${EVOLUTION_IMAGE}

COPY patch-baileys-status.cjs /tmp/patch-baileys-status.cjs
RUN node /tmp/patch-baileys-status.cjs /evolution/node_modules/baileys/lib/Socket/messages-recv.js \
 && node --check /evolution/node_modules/baileys/lib/Socket/messages-recv.js \
 && grep -q "CB:status" /evolution/node_modules/baileys/lib/Socket/messages-recv.js \
 && rm /tmp/patch-baileys-status.cjs
