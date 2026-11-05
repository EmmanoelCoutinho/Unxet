// Tutorial: conectar o WhatsApp oficial (API da Meta).
//
// O botão leva ao site da Meta, que não aparece no vídeo: um cartão lateral
// mostra os passos de lá, e a volta com o número conectado é simulada no
// banco local (o mesmo resultado do retorno da Meta). O número por QR Code
// da Empresa Teste fica escondido durante a gravação (com ele conectado, a
// Meta fica bloqueada) e tudo volta como estava no fim.

const CLINIC = "00000000-0000-0000-0000-0000000000c1";
const META_ROW = "7a700000-0000-4000-8000-0000000000a1";

export const meta = {
  id: "conectar-whatsapp-oficial",
  title: "Como conectar o WhatsApp oficial (Meta)",
};

export async function prepare(db) {
  db.sql(`delete from channel_connections where id = '${META_ROW}';`);
  const before = db
    .sql(`select id, coalesce(archived_at::text, ''), status from channel_connections
          where clinic_id = '${CLINIC}' and provider = 'evolution' and channel = 'whatsapp';`)
    .map((line) => {
      const [id, archivedAt, status] = line.split("|");
      return { id, archivedAt: archivedAt || null, status };
    });
  db.sql(`update channel_connections set archived_at = now(), status = 'disconnected'
          where clinic_id = '${CLINIC}' and provider = 'evolution'
            and channel = 'whatsapp' and archived_at is null;`);
  return before;
}

export async function restore(db, before = []) {
  db.sql(`delete from channel_connections where id = '${META_ROW}';`);
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
    "Como conectar o WhatsApp oficial (Meta)",
    "Tutorial Unxet · Primeiros passos",
    3200,
  );
  const settingsItem = page.getByRole("button", { name: "Configurações" }).first();
  await settingsItem.waitFor();
  await opening;

  // Antes de começar
  await d.panel(
    "Antes de começar",
    [
      "Tenha o acesso ao Facebook de quem administra a empresa",
      "Separe o número que vai ser o WhatsApp oficial",
      "Tenha o celular desse número por perto para receber o código",
    ],
    { stepMs: 1500, side: "left" },
  );
  await d.hidePanel();

  // 1. Configurações > Integrações
  await d.caption("No menu lateral, abra Configurações", { step: 1, hold: 600, top: true });
  await d.click(settingsItem, { before: 1500, after: 1200 });
  await page.mouse.move(900, 380, { steps: 20 });
  await d.caption("Entre na aba Integrações", { step: 2, hold: 400 });
  await d.click(page.getByRole("button", { name: "Integrações" }).first(), { after: 1400 });

  // 2. Botão da Meta (o clique leva ao site da Meta, que não entra no vídeo)
  const metaButton = page.getByRole("button", { name: "Conectar via Meta" }).first();
  await metaButton.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(700);
  await d.caption("No cartão WhatsApp via Meta, clique em Conectar via Meta", {
    step: 3,
    hold: 600,
  });
  await d.point(metaButton, 1400);
  await page.evaluate(() => window.dispatchEvent(new MouseEvent("mousedown"))); // só a animação
  await d.wait(500);

  // 3. No site da Meta
  await d.caption("Você vai para o site da Meta. Lá, siga estes passos", { step: 4, hold: 300 });
  await page.mouse.move(980, 560, { steps: 12 });
  await d.panel(
    "No site da Meta",
    [
      "Entre com o Facebook de quem administra a empresa",
      "Escolha ou crie a conta da empresa e a conta do WhatsApp Business",
      "Escolha o número e confirme com o código que chega por SMS ou ligação",
      "Autorize a Unxet a usar a conta",
      "Pronto: você volta para a Unxet",
    ],
    { stepMs: 1900, side: "left" },
  );

  // A volta da Meta: o mesmo que o retorno grava
  db.sql(`insert into channel_connections
            (id, clinic_id, provider, channel, status, connected_name,
             meta_waba_id, meta_phone_number_id, last_connection_at, created_at, updated_at)
          values ('${META_ROW}', '${CLINIC}', 'meta', 'whatsapp', 'connected', 'Empresa Teste',
             'tutorial-waba', 'tutorial-phone', now(), now(), now());`);
  await d.hidePanel();

  const metaTitle = page.getByText("WhatsApp via Meta", { exact: true }).first();
  const metaCard = metaTitle.locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await metaCard.getByText("Conectado").first().waitFor({ timeout: 15000 });
  await d.wait(500);
  await d.caption("Pronto! O WhatsApp oficial aparece como Conectado", { hold: 300 });
  await d.point(metaCard, 2400);

  const qrNote = page.getByText(/indisponível enquanto houver um WhatsApp conectado via Meta/).first();
  if (await qrNote.count()) {
    await d.caption("Use um jeito de cada vez: com a Meta conectada, o QR Code fica indisponível", {
      hold: 300,
    });
    await d.point(qrNote, 2600);
  }
  await d.caption("As mensagens dos clientes chegam em Atendimentos, como sempre", { hold: 2800 });
  await d.hideCaption();

  await d.title("Pronto!", "Seu WhatsApp oficial está conectado à Unxet", 3000, { keep: true });
}
