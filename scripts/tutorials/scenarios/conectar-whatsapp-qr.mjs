// Tutorial: conectar o WhatsApp por QR Code (empresa com um número só)
//
// O QR vem da Evolution de mentira (mock-evolution.mjs) e só abre o site da
// Unxet. "O celular leu o QR" é simulado no banco local, do mesmo jeito que o
// webhook da Evolution faria: a tela muda sozinha pelo realtime.

const CLINIC = "00000000-0000-0000-0000-0000000000c1";

export const meta = {
  id: "conectar-whatsapp-qr",
  title: "Como conectar o WhatsApp por QR Code",
  mockEvolution: true,
};

const evolutionRows = (db) =>
  db.sql(`select id, coalesce(archived_at::text, ''), status from channel_connections
          where clinic_id = '${CLINIC}' and provider = 'evolution' and channel = 'whatsapp';`)
    .map((line) => {
      const [id, archivedAt, status] = line.split("|");
      return { id, archivedAt: archivedAt || null, status };
    });

/**
 * Esconde os números que já existem: o vídeo começa sem WhatsApp conectado.
 * Também desconecta, porque o limite do plano conta os conectados.
 */
export async function prepare(db) {
  const before = evolutionRows(db);
  db.sql(`update channel_connections set archived_at = now(), status = 'disconnected'
          where clinic_id = '${CLINIC}' and provider = 'evolution'
            and channel = 'whatsapp' and archived_at is null;`);
  return before;
}

/** Apaga o número criado no vídeo e devolve os de antes como estavam */
export async function restore(db, before = []) {
  const keep = before.map((row) => db.lit(row.id)).join(",") || "null";
  db.sql(`delete from channel_connections
          where clinic_id = '${CLINIC}' and provider = 'evolution'
            and channel = 'whatsapp' and id not in (${keep});`);
  for (const row of before) {
    db.sql(`update channel_connections
            set archived_at = ${db.lit(row.archivedAt)}, status = ${db.lit(row.status)}
            where id = ${db.lit(row.id)};`);
  }
}

export async function run(page, d, db) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title(
    "Como conectar o WhatsApp por QR Code",
    "Tutorial Unxet · Primeiros passos",
    3200,
  );
  const settingsItem = page.getByRole("button", { name: "Configurações" }).first();
  await settingsItem.waitFor();
  await opening;

  // 1. Configurações (no pé do menu: legenda no topo)
  await d.caption("No menu lateral, abra Configurações", { step: 1, hold: 600, top: true });
  await d.click(settingsItem, { before: 1500, after: 1200 });
  await page.mouse.move(900, 380, { steps: 20 }); // recolhe o menu

  // 2. Aba Integrações
  await d.caption("Entre na aba Integrações", { step: 2, hold: 400 });
  await d.click(page.getByRole("button", { name: "Integrações" }).first(), { after: 1400 });

  // 3. Conectar
  const card = page.getByText("WhatsApp via QR Code", { exact: true }).first();
  await card.waitFor();
  const connectButton = page.getByRole("button", { name: "Conectar via QR Code" }).first();
  await connectButton.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(700);
  await d.caption("No cartão WhatsApp via QR Code, clique em Conectar via QR Code", {
    step: 3,
    hold: 600,
  });
  await d.click(connectButton, { before: 1200, after: 300 });

  const qr = page.getByAltText("QR Code WhatsApp");
  await qr.waitFor({ timeout: 20000 });
  await qr.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(700);
  await d.caption("O QR Code aparece na tela", { step: 4, hold: 300 });
  await d.point(qr, 1400);
  await page.mouse.move(640, 690, { steps: 14 }); // tira o cursor do QR

  // 4. Celular
  await d.caption("Agora, leia o QR Code com o celular da empresa", { step: 5, hold: 300 });
  await d.panel(
    "No celular",
    [
      "Abra o WhatsApp",
      "Toque em <b>⋮</b> (Android) ou em <b>Configurações</b> (iPhone)",
      "Toque em <b>Dispositivos conectados</b>",
      "Toque em <b>Conectar dispositivo</b>",
      "Aponte a câmera para o QR Code",
    ],
    { stepMs: 1700, side: "left" },
  );

  // O "celular" leu: o mesmo que o webhook da Evolution grava
  db.sql(`update channel_connections
          set status = 'connected', qr_code = null,
              connected_phone = '5511987654321', connected_name = 'Empresa Teste',
              last_connection_at = now(), updated_at = now()
          where clinic_id = '${CLINIC}' and provider = 'evolution'
            and channel = 'whatsapp' and archived_at is null;`);
  await d.hidePanel();

  const connected = page.getByText("WhatsApp conectado").first();
  await connected.waitFor({ timeout: 15000 });
  await d.wait(500);
  await d.caption("Pronto! O WhatsApp da empresa está conectado", { hold: 300 });
  await d.point(connected, 2200);
  await d.caption("As mensagens dos clientes já chegam em Atendimentos", { hold: 3200 });
  await d.hideCaption();

  await d.title("Pronto!", "Seu WhatsApp já está conectado à Unxet", 3000, { keep: true });
}
