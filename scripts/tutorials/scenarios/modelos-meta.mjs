// Tutorial: modelos aprovados pela Meta (WhatsApp oficial) e campanha com
// modelo.
//
// A Meta não entra no vídeo: a função whatsapp-templates é respondida pelo
// próprio roteiro. "Enviar para aprovação" grava o modelo como em análise e
// "Atualizar status" marca como aprovado, como a Meta faria. A campanha é
// agendada para o dia seguinte. No fim, modelo, campanha e etiqueta somem.

const CLINIC = "00000000-0000-0000-0000-0000000000c1";
const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const TAG = "7a700000-0000-4000-8000-0000000000c1";
const TAG_NAME = "Clientes VIP";
const TEMPLATE = "Promoção de dezembro";
const CAMPAIGN = "Dezembro VIP";

export const meta = {
  id: "modelos-meta",
  title: "Como usar modelos da Meta",
};

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
    delete from message_templates where clinic_id = '${CLINIC}' and name = ${db.lit(TEMPLATE)};
    delete from conversation_tags where tag_id = '${TAG}';
    delete from tags where id = '${TAG}';
  `);

const officialId = (db) =>
  db.sql(`select id from channel_connections where clinic_id = '${CLINIC}'
          and provider = 'meta' and channel = 'whatsapp' and status = 'connected' limit 1;`)[0];

export async function prepare(db) {
  wipe(db);
  if (!officialId(db)) throw new Error("A Empresa Teste precisa de um WhatsApp oficial conectado no banco local");
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
}

export async function restore(db) {
  wipe(db);
}

const tomorrow = () => {
  const date = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Faz o papel da Meta para a função whatsapp-templates. A tela consulta o
 * status sozinha enquanto há modelo em análise: a "aprovação" só sai quando
 * o roteiro libera (approve), para o vídeo mostrar o Em análise.
 */
const metaState = { approve: false };
const fakeMeta = async (page, db) => {
  const connection = officialId(db);
  await page.route("**/functions/v1/whatsapp-templates", async (route) => {
    const body = route.request().postDataJSON() ?? {};
    if (body.action === "create") {
      db.sql(`insert into message_templates
                (clinic_id, created_by, name, meta_template_name, category, language_code, body,
                 variables, footer, buttons, status, meta_template_id, channel_connection_id,
                 last_meta_sync_at, created_at, updated_at)
              values ('${CLINIC}', '${ADMIN}', ${db.lit(body.name)}, 'promocao_de_dezembro_tutorial',
                ${db.lit(body.category ?? "marketing")}, 'pt_BR', ${db.lit(body.body)},
                ${/\{nome\}/i.test(body.body ?? "") ? `'["nome"]'` : "'[]'"}, ${db.lit(body.footer || null)},
                ${db.lit(JSON.stringify(body.buttons ?? []))}::jsonb, 'pending', 'tutorial-${Date.now()}',
                '${connection}', now(), now(), now());`);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true }) });
    }
    if (body.action === "sync" && metaState.approve) {
      db.sql(`update message_templates set status = 'approved', last_meta_sync_at = now(), updated_at = now()
              where clinic_id = '${CLINIC}' and name = ${db.lit(TEMPLATE)};`);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, updated: 1 }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true }) });
  });
};

export async function run(page, d, db) {
  await fakeMeta(page, db);
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como usar modelos da Meta", "Tutorial Unxet · Automação", 3200);
  const menuItem = page.getByRole("button", { name: "Campanhas" }).first();
  await menuItem.waitFor();
  await opening;

  await d.caption("No WhatsApp oficial, a Meta só deixa iniciar conversa com um modelo aprovado", {
    hold: 2800,
  });

  // 1. Abrir os modelos
  await d.caption("Em Campanhas, clique em Modelos da Meta", { step: 1, hold: 300 });
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await d.click(menuItem, { before: 1000, after: 1200 });
  await page.mouse.move(900, 420, { steps: 20 });
  await d.click(page.getByRole("button", { name: "Modelos da Meta" }).first(), { before: 700, after: 1400 });

  // 2. Criar
  await d.caption("Clique em Novo modelo", { step: 2, hold: 300 });
  await d.click(page.getByRole("button", { name: /Novo modelo|Criar modelo/ }).first(), { after: 1000 });
  await d.caption("Dê um nome e escolha o tipo: Marketing para promoções, Utilidade para avisos", {
    step: 3,
    hold: 300,
  });
  await d.type(page.locator("#template-name"), TEMPLATE, { delay: 70 });
  await d.click(page.getByRole("button", { name: /Marketing/ }).first(), { before: 600, after: 800 });
  await d.caption("Escreva a mensagem. {nome} vira o nome de cada cliente", { step: 4, hold: 300 });
  await d.type(
    page.locator("#template-body"),
    "Olá {nome}! Em dezembro, o plano anual está com 20% de desconto. Quer saber mais?",
    { delay: 25 },
  );
  await d.caption("Se quiser, um rodapé e botões de resposta rápida", { hold: 300 });
  await d.type(page.locator("#template-footer"), "Responda SAIR para não receber mais", { delay: 25 });
  const addButton = page.getByRole("button", { name: /Adicionar botão/ }).first();
  if (await addButton.count()) {
    await d.click(addButton, { before: 500, after: 600 });
    await d.type(page.getByLabel("Botão 1", { exact: true }), "Quero saber mais", { delay: 45 });
  }
  await d.caption("Clique em Enviar para aprovação", { step: 5, hold: 300 });
  await d.click(page.getByRole("button", { name: "Enviar para aprovação" }).first(), { before: 700, after: 1600 });
  const card = page.getByText(TEMPLATE, { exact: true }).first();
  await card.waitFor({ timeout: 15000 });
  await d.caption("O modelo fica Em análise até a Meta responder", { hold: 300 });
  await d.point(card.locator("xpath=ancestor::div[contains(@class,'rounded')][1]"), 2400);

  // 3. Aprovação
  await d.caption("O status atualiza sozinho. Para conferir na hora, clique em Atualizar status", {
    step: 6,
    hold: 300,
  });
  metaState.approve = true;
  await d.click(page.getByRole("button", { name: "Atualizar status" }).first(), { before: 700, after: 2000 });
  await page.getByText("Aprovado").first().waitFor({ timeout: 15000 });
  await d.caption("Aprovado! Agora ele pode ser usado nas campanhas", { hold: 2400 });

  // 4. Campanha com o modelo
  await d.caption("Na nova campanha, escolha o modelo aprovado", { step: 7, hold: 300 });
  await page.goBack();
  await d.wait(900);
  await d.click(page.getByRole("button", { name: "Nova campanha" }).first(), { after: 1200 });
  await d.type(page.locator("#campaign-name"), CAMPAIGN, { delay: 70 });
  const option = page.getByText(TEMPLATE, { exact: true }).last();
  await option.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.click(option, { before: 700, after: 1400 });
  await d.caption("A prévia mostra a mensagem como o cliente vai receber", { hold: 2200 });
  await d.click(page.getByRole("button", { name: /Continuar/ }).first(), { before: 500, after: 1200 });

  await d.caption("Escolha quem recebe e quando, como em qualquer campanha", { step: 8, hold: 300 });
  await d.click(page.getByRole("button", { name: /Por etiqueta/ }).first(), { after: 800 });
  await d.click(page.getByRole("button", { name: TAG_NAME, exact: true }).first(), { after: 600 });
  await d.click(page.getByRole("button", { name: /Adicionar clientes dessas etiquetas/ }).first(), {
    after: 1200,
  });
  await d.click(page.getByRole("button", { name: /Continuar/ }).first(), { before: 500, after: 1200 });
  await d.click(page.getByRole("button", { name: /^Agendar/ }).first(), { after: 800 });
  await page.locator("#campaign-date").fill(tomorrow());
  await page.locator("#campaign-time").fill("09:00");
  await d.wait(700);
  await d.click(page.getByRole("button", { name: /Continuar/ }).first(), { before: 500, after: 1200 });
  await d.caption("Confira e clique em Agendar campanha", { step: 9, hold: 1200 });
  await d.click(page.getByRole("button", { name: /Agendar campanha/ }).first(), { before: 700, after: 2000 });
  await page.getByText(CAMPAIGN, { exact: true }).first().waitFor({ timeout: 15000 });
  await d.caption("Pronto! A campanha sai pelo WhatsApp oficial com o modelo aprovado", { hold: 2800 });
  await d.hideCaption();

  await d.title("Pronto!", "Seus modelos aprovados prontos para usar", 3000, { keep: true });
}
