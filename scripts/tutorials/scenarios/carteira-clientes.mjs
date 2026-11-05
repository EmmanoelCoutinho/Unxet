// Tutorial: carteira de clientes (admin). A nota criada no vídeo é apagada
// no fim.

const CLINIC = "00000000-0000-0000-0000-0000000000c1";
const NOTE = "Prefere ser chamada à tarde. Pediu orçamento do plano anual.";

export const meta = {
  id: "carteira-clientes",
  title: "Como usar a carteira de clientes",
};

const wipe = (db) =>
  db.sql(`delete from contact_notes where note = ${db.lit(NOTE)}
          and contact_id in (select id from contacts where clinic_id = '${CLINIC}');`);

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
  await d.caption("Dá para agendar uma mensagem só para este cliente, como um lembrete de retorno", {
    step: 5,
    hold: 300,
  });
  await d.point(page.getByRole("button", { name: /Agendar mensagem/ }).first(), 2600);

  // 5. Nota interna
  const noteBox = page.getByPlaceholder("Adicionar observação interna");
  await noteBox.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(700);
  await d.caption("Em Notas internas, registre o que a equipe precisa saber", { step: 6, hold: 300 });
  await d.type(noteBox, NOTE, { delay: 45 });
  await d.caption("Clique em Criar nota. Só a equipe vê", { step: 7, hold: 300 });
  await d.click(page.getByRole("button", { name: "Criar nota" }).first(), { after: 1200 });
  const saved = page.getByText(NOTE).last();
  await saved.waitFor();
  await d.point(saved, 1800);

  // 6. Filtro
  const status = page.locator("select").filter({ hasText: "Todos os status" }).first();
  await status.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.caption("Filtre os inativos para chamar de volta, por exemplo com uma campanha", {
    step: 8,
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
