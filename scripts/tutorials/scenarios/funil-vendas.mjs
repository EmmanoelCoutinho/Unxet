// Tutorial: funil de vendas (admin). A negociação criada no vídeo (e tudo
// que aponta para ela: tarefas, histórico, etiquetas) é apagada no fim.

const CLINIC = "00000000-0000-0000-0000-0000000000c1";
const TITLE = "Elisa - plano anual";

export const meta = {
  id: "funil-vendas",
  title: "Como usar o funil de vendas",
};

const wipe = (db) =>
  db.sql(`
    do $$
    declare r record; d record;
    begin
      for d in select id from deals where clinic_id = '${CLINIC}' and title = ${db.lit(TITLE)} loop
        for r in
          select c.conrelid::regclass as tbl, a.attname as col
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
          where c.contype = 'f' and c.confrelid = 'public.deals'::regclass
        loop
          execute format('delete from %s where %I = %L', r.tbl, r.col, d.id);
        end loop;
        delete from deals where id = d.id;
      end loop;
    end $$;
  `);

export async function prepare(db) {
  wipe(db);
}

export async function restore(db) {
  wipe(db);
}

const tomorrow = () => {
  const date = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como usar o funil de vendas", "Tutorial Unxet · Clientes e vendas", 3200);
  const menuItem = page.getByRole("button", { name: "Funil de vendas" }).first();
  await menuItem.waitFor();
  await opening;

  // 1. Abrir
  await d.caption("No menu lateral, abra Funil de vendas", { step: 1, hold: 500 });
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await d.click(menuItem, { before: 1200, after: 1200 });
  await page.mouse.move(900, 420, { steps: 20 });
  await page.getByRole("button", { name: "Nova negociação" }).first().waitFor();
  await d.caption("Cada coluna é uma etapa da venda, do primeiro contato ao fechamento", {
    hold: 2600,
  });

  // 2. Nova negociação
  await d.caption("Clique em Nova negociação", { step: 2, hold: 300 });
  await d.click(page.getByRole("button", { name: "Nova negociação" }).first(), { after: 1000 });
  await d.caption("Escolha o cliente da carteira", { step: 3, hold: 300 });
  await d.type(page.getByLabel("Buscar cliente"), "Elisa Silva", { delay: 110 });
  await d.wait(1200);
  const option = page.getByRole("button", { name: /Demo Elisa Silva/ }).first();
  await d.click(option, { after: 800 });
  await d.caption("Dê um nome e, se souber, o valor", { step: 4, hold: 300 });
  const title = page.locator("#deal-title");
  await title.fill("");
  await d.type(title, TITLE, { delay: 70 });
  await d.type(page.locator("#deal-value"), "1200", { delay: 140 });
  await d.caption("E clique em Criar negociação", { step: 5, hold: 300 });
  await d.click(page.getByRole("button", { name: "Criar negociação" }).last(), { after: 1400 });

  // A ficha da negociação abre sozinha: fecha para mostrar o quadro
  const drawer = page.getByRole("dialog", { name: "Negociação" });
  if (await drawer.isVisible().catch(() => false)) {
    await d.caption("A negociação foi criada na primeira etapa", { hold: 1400 });
    await d.click(drawer.getByRole("button", { name: "Fechar" }).first(), { before: 500, after: 1000 });
  }

  // 3. Arrastar
  const dealCard = page.getByText(TITLE, { exact: true }).first();
  await dealCard.waitFor();
  const target = page.getByText("Em contato", { exact: true }).first();
  await d.caption("Quando a venda avança, arraste o cartão para a próxima etapa", {
    step: 6,
    hold: 300,
  });
  const from = await dealCard.boundingBox();
  const to = await target.boundingBox();
  await d.point(dealCard, 700);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 6 });
  await page.mouse.down();
  await page.mouse.move(to.x + 60, to.y + 120, { steps: 40 });
  await page.mouse.up();
  await d.wait(1600);

  // 4. Ficha e tarefa
  await d.caption("Clique no cartão para abrir a negociação", { step: 7, hold: 300 });
  await d.click(page.getByText(TITLE, { exact: true }).first(), { after: 1400 });
  const tasksTab = page.getByRole("button", { name: /^Tarefas/ }).first();
  await d.caption("Em Tarefas, crie o próximo passo com dia e hora", { step: 8, hold: 300 });
  await d.click(tasksTab, { after: 800 });
  await d.click(page.getByRole("button", { name: "Nova tarefa" }).first(), { after: 800 });
  await d.type(page.getByLabel("Nova tarefa"), "Enviar a proposta do plano anual", { delay: 55 });
  await page.getByLabel("Data", { exact: true }).fill(tomorrow());
  await page.getByLabel("Hora", { exact: true }).fill("10:00");
  await d.wait(600);
  await d.click(page.getByRole("button", { name: "Salvar tarefa" }).first(), { after: 1400 });
  await d.caption("Na hora marcada, a Unxet lembra o responsável", { hold: 2200 });

  // 5. Ganhou
  await d.caption("Fechou a venda? Clique em Marcar como ganha", { step: 9, hold: 300 });
  await d.click(page.getByRole("button", { name: "Marcar como ganha" }).first(), {
    before: 1000,
    after: 2200,
  });
  await d.caption("Ganhos e perdidos entram nos números do funil", { hold: 2200 });
  await page.keyboard.press("Escape");
  await d.wait(600);

  // 6. Dica: pela conversa
  await d.caption("Dica: dá para criar a negociação de dentro da conversa com o cliente", {
    hold: 300,
  });
  // Volta para os atendimentos pelo menu (sem recarregar a página)
  await d.click(page.getByRole("button", { name: "Painel" }).first(), { before: 600, after: 1200 });
  await page.mouse.move(900, 420, { steps: 16 });
  const conversation = page.getByText("Demo Elisa Oliveira", { exact: true }).first();
  await conversation.waitFor();
  await d.click(conversation, { after: 1400 });
  // A barra de negociação aparece com a conversa em tela cheia
  await d.click(page.getByRole("button", { name: "Abrir em tela cheia" }).first(), { after: 1600 });
  const fromChat = page.getByRole("button", { name: "Criar negociação" }).first();
  await fromChat.waitFor();
  await d.point(fromChat, 2600);
  await d.hideCaption();

  await d.title("Pronto!", "Suas vendas acompanhadas de perto", 3000, { keep: true });
}
