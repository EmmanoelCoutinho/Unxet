// Tutorial: carteira de clientes (admin). A nota e a mensagem agendada
// criadas no vídeo são apagadas no fim (a mensagem fica para o dia
// seguinte, então nada chega a ser enviado).

const CLINIC = "00000000-0000-0000-0000-0000000000c1";
const NOTE = "Prefere ser chamada à tarde. Pediu orçamento do plano anual.";
const SCHEDULED_MARK = "lembrar da proposta do plano anual";

export const meta = {
  id: "carteira-clientes",
  title: "Como usar a carteira de clientes",
};

const wipe = (db) =>
  db.sql(`
    delete from contact_notes where note = ${db.lit(NOTE)}
      and contact_id in (select id from contacts where clinic_id = '${CLINIC}');
    delete from scheduled_message_recipients where scheduled_message_id in (
      select id from scheduled_messages
      where clinic_id = '${CLINIC}' and message like ${db.lit("%" + SCHEDULED_MARK + "%")});
    delete from scheduled_messages
      where clinic_id = '${CLINIC}' and message like ${db.lit("%" + SCHEDULED_MARK + "%")};
    delete from recurring_messages
      where clinic_id = '${CLINIC}' and message like ${db.lit("%" + SCHEDULED_MARK + "%")};
  `);

const tomorrow = () => {
  const date = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export async function prepare(db) {
  wipe(db);
}

export async function restore(db) {
  wipe(db);
}

/** O cartão inteiro em volta de um título */
const card = (page, text) =>
  page
    .getByText(text, { exact: true })
    .first()
    .locator("xpath=ancestor::*[self::div or self::article or self::section][contains(@class,'rounded')][1]");

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como usar a carteira de clientes", "Tutorial Unxet · Clientes e vendas", 3200);
  const menuItem = page.getByRole("button", { name: "Carteira de clientes" }).first();
  await menuItem.waitFor();
  await opening;

  // 1. Abrir
  await d.caption("No menu lateral, abra Carteira de clientes", { step: 1, hold: 500 });
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await d.click(menuItem, { before: 1200, after: 1200 });
  await page.mouse.move(900, 380, { steps: 20 });
  await page.getByText("Total de clientes").first().waitFor();
  await d.caption("Aqui fica todo mundo que já conversou com a empresa", { hold: 2200 });

  // 2. Números
  await d.caption("No topo, quantos clientes estão ativos e quantos estão sem contato", {
    step: 2,
    hold: 300,
  });
  await d.point(card(page, "Sem contato há 30 dias"), 2600);

  // 3. Buscar e abrir
  await d.caption("Busque pelo nome ou telefone", { step: 3, hold: 300 });
  await d.type(page.getByPlaceholder("Buscar por nome ou telefone"), "Elisa Silva", { delay: 110 });
  await d.wait(1200);
  const client = page.getByText("Demo Elisa Silva", { exact: true }).first();
  await client.waitFor();
  await d.caption("Clique no cliente para ver a ficha", { step: 4, hold: 300 });
  await d.click(client, { after: 1400 });
  await d.caption("A ficha mostra contato, canal, responsável, etiquetas e o status comercial", {
    hold: 300,
  });
  await d.point(card(page, "Status comercial"), 2400);

  // 4. Mensagem agendada
  const scheduled = page.getByRole("heading", { name: "Mensagens agendadas" }).first();
  await scheduled.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(700);
  await d.caption("Agende uma mensagem só para este cliente, como um lembrete de retorno", {
    step: 5,
    hold: 300,
  });
  await d.click(page.getByRole("button", { name: /Agendar mensagem/ }).first(), { after: 1000 });
  const text = page.locator("#contact-msg");
  await d.caption("Escreva a mensagem. O botão coloca o nome do cliente sozinho", { hold: 300 });
  await d.type(text, "Oi ", { delay: 90 });
  await d.click(page.getByRole("button", { name: "Inserir nome do cliente" }).first(), { before: 600, after: 600 });
  await text.press("End");
  await page.keyboard.type("! Passando para lembrar da proposta do plano anual. Ficou alguma dúvida?", { delay: 35 });
  await d.wait(600);
  await d.caption("Envie uma vez ou repita todo dia, toda semana ou todo mês", { step: 6, hold: 300 });
  await d.point(page.getByRole("button", { name: "Toda semana" }).first(), 1400);
  await d.click(page.getByRole("button", { name: "Escolher data" }).first(), { before: 600, after: 700 });
  await d.caption("Escolha o dia e a hora do envio", { hold: 300 });
  const day = page.locator("#contact-start");
  await day.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(500);
  await d.point(day, 700);
  await day.fill(tomorrow());
  await d.point(page.locator("#contact-time"), 700);
  await page.locator("#contact-time").fill("10:00");
  await d.wait(800);
  await d.caption("Clique em Agendar", { hold: 300 });
  await d.click(page.getByRole("button", { name: "Agendar", exact: true }).last(), { after: 1600 });
  const item = page.getByText(new RegExp(SCHEDULED_MARK)).first();
  await item.waitFor({ timeout: 10000 });
  await item.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.caption("O agendamento fica na ficha, e dá para editar ou excluir", { hold: 300 });
  await d.point(item, 2200);

  // 5. Nota interna
  const noteBox = page.getByPlaceholder("Adicionar observação interna");
  await noteBox.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(700);
  await d.caption("Em Notas internas, registre o que a equipe precisa saber", { step: 7, hold: 300 });
  await d.type(noteBox, NOTE, { delay: 45 });
  await d.caption("Clique em Criar nota. Só a equipe vê", { step: 8, hold: 300 });
  await d.click(page.getByRole("button", { name: "Criar nota" }).first(), { after: 1200 });
  const saved = page.getByText(NOTE).last();
  await saved.waitFor();
  await d.point(saved, 1800);

  // 6. Filtro
  const status = page.locator("select").filter({ hasText: "Todos os status" }).first();
  await status.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.caption("Filtre os inativos para chamar de volta, por exemplo com uma campanha", {
    step: 9,
    hold: 300,
  });
  // Limpa a busca para o filtro mostrar todos os inativos
  const search = page.getByPlaceholder("Buscar por nome ou telefone");
  await d.click(search, { before: 400, after: 200 });
  await search.fill("");
  await d.wait(900);
  await d.select(status, "Inativo", { after: 1400 });
  await d.point(page.getByText("Inativo", { exact: true }).nth(1), 1800);
  await d.hideCaption();

  await d.title("Pronto!", "Seus clientes organizados em um só lugar", 3000, { keep: true });
}
