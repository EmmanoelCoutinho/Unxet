// Tutorial: criar uma campanha (mensagem para vários clientes).
//
// O roteiro cria a etiqueta "Clientes VIP" em algumas conversas de
// demonstração, monta a campanha para quem tem essa etiqueta e AGENDA para
// o dia seguinte (nada é enviado). No fim, a campanha e a etiqueta somem.

const CLINIC = "00000000-0000-0000-0000-0000000000c1";
const TAG = "7a700000-0000-4000-8000-0000000000c1";
const TAG_NAME = "Clientes VIP";
const CAMPAIGN = "Black Friday VIP";

export const meta = {
  id: "criar-campanha",
  title: "Como criar uma campanha",
  mockEvolution: [8787],
};

/** Apaga a campanha (e o que aponta para ela) e a etiqueta do vídeo */
const wipe = (db) =>
  db.sql(`
    do $$
    declare r record; c record;
    begin
      for c in select id from scheduled_messages
               where clinic_id = '${CLINIC}' and name = ${db.lit(CAMPAIGN)} loop
        for r in
          select k.conrelid::regclass as tbl, a.attname as col
          from pg_constraint k
          join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
          where k.contype = 'f' and k.confrelid = 'public.scheduled_messages'::regclass
        loop
          execute format('delete from %s where %I = %L', r.tbl, r.col, c.id);
        end loop;
        delete from scheduled_messages where id = c.id;
      end loop;
    end $$;
    delete from conversation_tags where tag_id = '${TAG}';
    delete from tags where id = '${TAG}';
  `);

// Este vídeo mostra o caminho do QR Code (texto livre), o da maioria das
// empresas. Com o WhatsApp oficial conectado a campanha usaria modelo da
// Meta (vídeo "modelos-meta"), então o oficial fica desconectado durante a
// gravação e volta no fim.
const officialRows = (db) =>
  db.sql(`select id, status from channel_connections
          where clinic_id = '${CLINIC}' and provider = 'meta' and channel = 'whatsapp';`)
    .map((line) => { const [id, status] = line.split("|"); return { id, status }; });

export async function prepare(db) {
  wipe(db);
  const official = officialRows(db);
  db.sql(`update channel_connections set status = 'disconnected'
          where clinic_id = '${CLINIC}' and provider = 'meta' and channel = 'whatsapp';`);
  // Seis conversas de WhatsApp com telefone, de clientes diferentes
  db.sql(`
    insert into tags (id, clinic_id, name, color, created_at)
    values ('${TAG}', '${CLINIC}', ${db.lit(TAG_NAME)}, '#AF52DE', now());
    insert into conversation_tags (conversation_id, tag_id)
    select distinct on (c.contact_id) c.id, '${TAG}'
    from conversations c join contacts ct on ct.id = c.contact_id
    where c.clinic_id = '${CLINIC}' and c.channel = 'whatsapp'
      and ct.phone ~ '^[0-9]{12,13}$' and ct.name like 'Demo %'
    order by c.contact_id, c.last_message_at desc
    limit 6;
  `);
  return official;
}

export async function restore(db, official = []) {
  wipe(db);
  for (const row of official) {
    db.sql(`update channel_connections set status = ${db.lit(row.status)} where id = ${db.lit(row.id)};`);
  }
}

const tomorrow = () => {
  const date = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como criar uma campanha", "Tutorial Unxet · Automação", 3200);
  const menuItem = page.getByRole("button", { name: "Campanhas" }).first();
  await menuItem.waitFor();
  await opening;

  // 1. Abrir
  await d.caption("No menu lateral, abra Campanhas", { step: 1, hold: 500 });
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await d.click(menuItem, { before: 1200, after: 1200 });
  await page.mouse.move(900, 420, { steps: 20 });
  const newButton = page.getByRole("button", { name: "Nova campanha" }).first();
  await newButton.waitFor();
  await d.caption("Uma campanha manda a mesma mensagem para vários clientes, cada um na sua conversa", {
    hold: 2600,
  });

  // 2. Mensagem
  await d.caption("Clique em Nova campanha", { step: 2, hold: 300 });
  await d.click(newButton, { after: 1200 });
  await d.caption("Dê um nome (só a equipe vê) e escreva a mensagem", { step: 3, hold: 300 });
  await d.type(page.locator("#campaign-name"), CAMPAIGN, { delay: 80 });
  const message = page.locator("#campaign-message");
  await d.type(message, "Oi ", { delay: 90 });
  await d.click(page.getByRole("button", { name: "Inserir nome do cliente" }).first(), { before: 500, after: 500 });
  await message.press("End");
  await page.keyboard.type(
    "! A Black Friday chegou: 30% de desconto no plano anual até domingo. Responda esta mensagem para garantir o seu.",
    { delay: 25 },
  );
  await d.wait(500);
  await d.caption("Ao lado, a prévia mostra como o cliente vê, já com o nome dele", { hold: 300 });
  await d.point(page.getByText("Como o cliente vê").first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]"), 2400);
  await d.click(page.getByRole("button", { name: /Continuar/ }).first(), { before: 600, after: 1200 });

  // 3. Destinatários
  await d.caption("Escolha quem recebe. Aqui, os clientes com a etiqueta Clientes VIP", {
    step: 4,
    hold: 300,
  });
  await d.click(page.getByRole("button", { name: /Por etiqueta/ }).first(), { after: 900 });
  await d.click(page.getByRole("button", { name: TAG_NAME, exact: true }).first(), { after: 700 });
  await d.click(page.getByRole("button", { name: /Adicionar clientes dessas etiquetas/ }).first(), {
    after: 1400,
  });
  await d.caption("Dá para combinar etiquetas, clientes escolhidos e números avulsos", { hold: 2400 });
  await d.click(page.getByRole("button", { name: /Continuar/ }).first(), { before: 600, after: 1200 });

  // 4. Envio
  await d.caption("Envie agora ou agende o dia e a hora", { step: 5, hold: 300 });
  await d.click(page.getByRole("button", { name: /^Agendar/ }).first(), { after: 900 });
  const date = page.locator("#campaign-date");
  await date.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(500);
  await d.point(date, 700);
  await date.fill(tomorrow());
  await d.point(page.locator("#campaign-time"), 700);
  await page.locator("#campaign-time").fill("09:00");
  await d.wait(600);
  const safe = page.getByText(/As mensagens saem uma de cada vez/).first();
  if (await safe.count()) {
    await d.caption("As mensagens saem uma de cada vez, para proteger o seu número", { hold: 300 });
    await d.point(safe, 2200);
  }
  await d.click(page.getByRole("button", { name: /Continuar/ }).first(), { before: 600, after: 1200 });

  // 5. Revisão
  await d.caption("Confira tudo na revisão e clique em Agendar campanha", { step: 6, hold: 1600 });
  await d.click(page.getByRole("button", { name: /Agendar campanha/ }).first(), { before: 900, after: 2000 });

  // 6. Lista
  const row = page.getByText(CAMPAIGN, { exact: true }).first();
  await row.waitFor({ timeout: 15000 });
  await d.caption("Pronto! Na lista você acompanha os envios e as respostas", { hold: 300 });
  await d.point(row, 2600);
  await d.hideCaption();

  await d.title("Pronto!", "Sua campanha está agendada", 3000, { keep: true });
}
