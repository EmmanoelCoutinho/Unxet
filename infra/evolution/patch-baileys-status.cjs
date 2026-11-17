// Patch do Baileys 7.0.0-rc.9 (Evolution API 2.3.x): confirma (ack) os Status
// que o WhatsApp manda como <status> solto.
//
// Sem o ack, o servidor do WhatsApp segura as mensagens novas da sessão e
// derruba a conexão a cada ~50 min ("stream errored out" com
// reasonNode ack class:"status"). O número fica "Connected", envia, mas não
// recebe; as mensagens presas chegam horas depois.
//
// Backport de WhiskeySockets/Baileys#2883 (Evolution PR #2785, ainda aberto
// em 17/11/2026). Remover quando a Evolution sair com um Baileys corrigido.
//
// Uso: node patch-baileys-status.cjs /evolution/node_modules/baileys/lib/Socket/messages-recv.js
// Cada ponto de ancoragem precisa existir exatamente uma vez; senão o script
// falha e o build da imagem para (melhor que gerar uma imagem quebrada).

const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("uso: node patch-baileys-status.cjs <caminho de messages-recv.js>");
  process.exit(1);
}

let source = fs.readFileSync(file, "utf8");

if (source.includes("const handleStatus = async")) {
  console.error("[patch-status] o arquivo já tem handleStatus: patch já aplicado ou Baileys já corrigido. Nada feito.");
  process.exit(1);
}

const replaceOnce = (anchor, replacement, label) => {
  const count = source.split(anchor).length - 1;
  if (count !== 1) {
    console.error(`[patch-status] âncora "${label}" encontrada ${count} vez(es); esperado 1. Versão do Baileys diferente?`);
    process.exit(1);
  }
  source = source.replace(anchor, replacement);
};

// 1. Função que só confirma o <status> (não decodifica nada)
replaceOnce(
  "    const processNodeWithBuffer = async (node, identifier, exec) => {",
  [
    "    // [unxet-patch] ack do <status> solto (Baileys#2883)",
    "    const handleStatus = async (node) => {",
    "        await sendMessageAck(node);",
    "    };",
    "    const processNodeWithBuffer = async (node, identifier, exec) => {",
  ].join("\n"),
  "processNodeWithBuffer",
);

// 2. <status> que chega na fila offline (ao reconectar) também é confirmado
replaceOnce(
  "            ['notification', handleNotification]\n        ]);",
  "            ['notification', handleNotification],\n            ['status', handleStatus] // [unxet-patch]\n        ]);",
  "nodeProcessorMap",
);

// 3. Um erro num item não pode travar a fila offline (isProcessing ficava true)
replaceOnce(
  "                    await nodeProcessor(node);",
  [
    "                    try { // [unxet-patch]",
    "                        await nodeProcessor(node);",
    "                    }",
    "                    catch (error) {",
    "                        onUnexpectedError(error, 'processing offline node');",
    "                    }",
  ].join("\n"),
  "nodeProcessor(node)",
);

// 4. <status> recebido com a conexão aberta
replaceOnce(
  "    ws.on('CB:notification', async (node) => {",
  [
    "    // [unxet-patch] ack do <status> solto (Baileys#2883)",
    "    ws.on('CB:status', async (node) => {",
    "        await processNode('status', node, 'acking status', handleStatus);",
    "    });",
    "    ws.on('CB:notification', async (node) => {",
  ].join("\n"),
  "CB:notification",
);

fs.writeFileSync(file, source);
console.log("[patch-status] patch aplicado em", file);
