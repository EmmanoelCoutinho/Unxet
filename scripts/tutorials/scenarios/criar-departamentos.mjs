// Tutorial: criar um departamento (Vendas) e colocar uma pessoa nele
// (Carlos Lima, que já atende o Financeiro). No fim, o departamento criado
// e o vínculo somem.

const CLINIC = "00000000-0000-0000-0000-0000000000c1";
const NAME = "Vendas";
const FINANCEIRO = "00000000-0000-0000-0000-0000000000d2";
const CARLOS = "(select user_id from clinic_users where email = 'carlos@teste.local')";

export const meta = {
  id: "criar-departamentos",
  title: "Como criar departamentos",
};

/** Apaga o departamento do vídeo (e o que aponta para ele) */
const wipe = (db) =>
  db.sql(`
    with d as (select id from departments where clinic_id = '${CLINIC}' and name = ${db.lit(NAME)})
    delete from department_members where department_id in (select id from d);
    update clinic_users set department_id = null
      where department_id in (select id from departments where clinic_id = '${CLINIC}' and name = ${db.lit(NAME)});
    update channel_connections set default_department_id = null
      where default_department_id in (select id from departments where clinic_id = '${CLINIC}' and name = ${db.lit(NAME)});
    delete from departments where clinic_id = '${CLINIC}' and name = ${db.lit(NAME)};
  `);

/**
 * O Carlos tem Financeiro como setor principal, mas nos dados de teste não
 * está marcado em "Setores atendidos": marca durante o vídeo e desfaz depois.
 */
export async function prepare(db) {
  wipe(db);
  const [added] = db.sql(`
    with ins as (
      insert into department_members (department_id, clinic_user_id)
      select '${FINANCEIRO}', ${CARLOS}
      where not exists (
        select 1 from department_members
        where department_id = '${FINANCEIRO}' and clinic_user_id = ${CARLOS})
      returning 1)
    select count(*) from ins;`);
  return { addedFinanceiro: added === "1" };
}

export async function restore(db, state) {
  wipe(db);
  if (state?.addedFinanceiro) {
    db.sql(`delete from department_members
            where department_id = '${FINANCEIRO}' and clinic_user_id = ${CARLOS};`);
  }
}

/** Abre um item do fim do menu lateral (rola o menu até ele) */
const openMenuItem = async (page, d, label) => {
  const item = page.getByRole("button", { name: label }).first();
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await item.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.click(item, { before: 1300, after: 1200 });
  await page.mouse.move(900, 380, { steps: 20 }); // recolhe o menu
};

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como criar departamentos", "Tutorial Unxet · Primeiros passos", 3200);
  await page.getByRole("button", { name: "Departamentos" }).first().waitFor();
  await opening;

  // 1. Abrir
  await d.caption("No menu lateral, abra Departamentos", { step: 1, hold: 500, top: true });
  await openMenuItem(page, d, "Departamentos");
  await page.getByRole("heading", { name: "Departamentos" }).first().waitFor();
  await d.wait(600);
  await d.caption("Cada departamento é um setor da empresa, como Recepção ou Financeiro", {
    hold: 2600,
  });

  // 2. Criar
  await d.caption("Clique em Criar departamento", { step: 2, hold: 400 });
  await d.click(page.getByRole("button", { name: "Criar departamento" }).first(), { after: 1000 });
  await d.caption("Dê um nome ao setor", { step: 3, hold: 300 });
  await d.type(page.getByPlaceholder("Ex: Financeiro"), NAME, { delay: 110 });
  await d.caption("Se quiser, descreva o que ele atende", { step: 4, hold: 300 });
  await d.type(
    page.getByPlaceholder("Detalhes opcionais do departamento"),
    "Clientes interessados em comprar",
    { delay: 55 },
  );
  await d.caption(
    "O departamento padrão recebe as conversas que ainda não têm setor. Aqui, deixamos como está",
    { step: 5, hold: 300 },
  );
  await d.point(page.getByText("Definir como padrão").first(), 3000);
  await d.caption("Clique em Criar", { step: 6, hold: 300 });
  await d.click(page.getByRole("button", { name: "Criar", exact: true }).first(), { after: 1400 });
  const created = page.getByText(NAME, { exact: true }).first();
  await created.waitFor();
  await d.caption("Pronto: o setor Vendas está na lista", { hold: 300 });
  await d.point(created, 1800);

  // 3. Pessoas no setor
  await d.caption("Agora coloque as pessoas no setor: abra Atendentes", {
    step: 7,
    hold: 500,
    top: true,
  });
  await openMenuItem(page, d, "Atendentes");
  const row = page
    .locator("div")
    .filter({ hasText: "carlos@teste.local" })
    .filter({ has: page.getByRole("button", { name: "Editar" }) })
    .last();
  await row.waitFor();
  await d.caption("Clique em Editar na pessoa", { step: 8, hold: 300 });
  await d.click(row.getByRole("button", { name: "Editar" }), { after: 1200 });
  const vendas = page.getByRole("checkbox", { name: NAME });
  await vendas.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.caption("Em Setores atendidos, marque Vendas. Uma pessoa pode atender vários setores", {
    step: 9,
    hold: 300,
  });
  await d.click(vendas.locator("xpath=ancestor::label[1]"), { before: 1000, after: 1200 });
  await d.caption("E salve", { step: 10, hold: 300 });
  await d.click(page.getByRole("button", { name: "Salvar alterações" }).first(), { after: 1600 });
  await d.caption("As conversas de Vendas passam a aparecer para o Carlos", { hold: 3000 });
  await d.hideCaption();

  await d.title("Pronto!", "Seus setores estão organizados", 3000, { keep: true });
}
