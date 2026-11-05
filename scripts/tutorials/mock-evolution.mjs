// Evolution de mentira, só para gravar tutoriais. Responde o que a função
// create-evolution-connection pede e devolve um QR Code que só abre o site
// da Unxet (não conecta WhatsApp nenhum).
//
// A função do Supabase local chama EVOLUTION_API_URL (host.docker.internal
// :8080 em supabase/functions/.env), então este servidor ocupa essa porta
// enquanto a Evolution local de verdade estiver desligada.

import http from "node:http";
import QRCode from "qrcode";

export const MOCK_EVOLUTION_PORT = 8080;
const QR_TEXT = "https://unxet.com.br";

export async function startMockEvolution(port = MOCK_EVOLUTION_PORT) {
  const qr = await QRCode.toDataURL(QR_TEXT, {
    width: 512,
    margin: 2,
    color: { dark: "#111827", light: "#ffffff" },
  });

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    req.resume();

    if (url.startsWith("/instance/fetchInstances")) return send(200, []);
    if (url.startsWith("/instance/create")) {
      return send(201, { instance: { instanceName: "tutorial", status: "created" } });
    }
    if (url.startsWith("/instance/connectionState/")) {
      return send(200, { instance: { state: "close" } });
    }
    if (url.startsWith("/instance/connect/")) return send(200, { base64: qr });
    // webhook/set, settings/set e o que mais vier: tudo certo
    return send(200, {});
  });

  await new Promise((resolve, reject) => {
    server.once("error", (err) =>
      reject(
        err.code === "EADDRINUSE"
          ? new Error(
              `A porta ${port} está ocupada (Evolution local ligada?). Desligue-a para gravar.`,
            )
          : err,
      ),
    );
    server.listen(port, "0.0.0.0", resolve);
  });

  return () => new Promise((resolve) => server.close(() => resolve()));
}
