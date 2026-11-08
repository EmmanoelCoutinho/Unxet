// Tutorial: criar um cargo com permissões (Supervisor) e dar ao Carlos.
// No fim, o cargo é apagado e o Carlos volta ao cargo que tinha.

const CLINIC = "00000000-0000-0000-0000-0000000000c1";
const CARLOS = "00000000-0000-0000-0000-0000000000a5";
const NAME = "Supervisor";
const PERMISSIONS = ["Todas as conversas", "Painel", "Relatórios", "Gerenciar mensagens rápidas"];

export const meta = {
  id: "criar-cargos",
  title: "Como criar cargos e permissões",
};

const roleWhere = `clinic_id = '${CLINIC}' and name = '${NAME}'`;

export async function prepare(db) {
  const [row] = db.sql(`select role || '|' || coalesce(role_id::text, '') from clinic_users
                        where clinic_id = '${CLINIC}' and user_id = '${CARLOS}';`);
  const [role, roleId] = (row ?? "agent|").split("|");
  db.sql(`update clinic_users set role_id = null where role_id in (select id from clinic_roles where ${roleWhere});
          delete from clinic_roles where ${roleWhere};`);
  return { role, roleId: roleId || null };
}

export async function restore(db, carlos) {
  db.sql(`update clinic_users set role = ${db.lit(carlos?.role ?? "agent")}, role_id = ${db.lit(carlos?.roleId ?? null)}
          where clinic_id = '${CLINIC}' and user_id = '${CARLOS}';
          update clinic_users set role_id = null where role_id in (select id from clinic_roles where ${roleWhere});
          delete from clinic_roles where ${roleWhere};`);
}

/** Abre um item do fim do menu lateral (rola o menu até ele) */
const openMenuItem = async (page, d, label) => {
  const item = page.getByRole("button", { name: label }).first();
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await item.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.click(item, { before: 1300, after: 1200 });
  await page.mouse.move(900, 380, { steps: 20 });
};

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como criar cargos e permissões", "Tutorial Unxet · Primeiros passos", 3200);
  await page.getByRole("button", { name: "Atendentes" }).first().waitFor();
  await opening;

  await d.caption("Além de Administrador e Atendente, crie cargos com o que cada pessoa pode fazer", {
    hold: 2800,
  });

  // 1. Abrir
  await d.caption("No menu lateral, abra Atendentes", { step: 1, hold: 500, top: true });
  await openMenuItem(page, d, "Atendentes");
  await d.caption("Clique em Cargos e permissões", { step: 2, hold: 300 });
  await d.click(page.getByRole("button", { name: "Cargos e permissões" }).first(), { after: 1200 });

  // 2. Criar o cargo
  await d.caption("Clique em Novo cargo", { step: 3, hold: 300 });
  await d.click(page.getByRole("button", { name: /Novo cargo/ }).last(), { after: 900 });
  await d.caption("Dê um nome ao cargo", { step: 4, hold: 300 });
  await d.type(page.getByPlaceholder("Ex.: Supervisor"), NAME, { delay: 100 });
  await d.caption("Marque o que esse cargo pode ver e fazer", { step: 5, hold: 300 });
  for (const label of PERMISSIONS) {
    const box = page.getByRole("checkbox", { name: new RegExp(label) }).first();
    await box.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
    await d.wait(350);
    await d.click(box.locator("xpath=ancestor::label[1]"), { before: 500, after: 500 });
  }
  await d.caption("O que fica desmarcado, o cargo não vê, como Configurações e Bots", { hold: 2200 });
  const create = page.getByRole("button", { name: "Criar cargo" }).first();
  await create.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(500);
  await d.caption("Clique em Criar cargo", { step: 6, hold: 300 });
  await d.click(create, { before: 700, after: 1500 });
  const panel = page.getByRole("dialog", { name: "Cargos e permissões" });
  const created = panel.getByText(NAME, { exact: true }).first();
  await created.waitFor();
  await d.caption("Pronto: o cargo Supervisor está na lista", { hold: 300 });
  await d.point(created.locator("xpath=ancestor::div[contains(@class,'rounded')][1]"), 1800);
  await d.click(page.getByRole("button", { name: "Fechar" }).last(), { before: 400, after: 900 });

  // 3. Dar o cargo a alguém
  await d.caption("Agora dê o cargo a uma pessoa: clique em Editar", { step: 7, hold: 300 });
  const row = page
    .locator("div")
    .filter({ hasText: "carlos@teste.local" })
    .filter({ has: page.getByRole("button", { name: "Editar" }) })
    .last();
  await d.click(row.getByRole("button", { name: "Editar" }), { after: 1200 });
  const cargo = page.locator("select").filter({ has: page.locator(`option:text-is("${NAME}")`) }).last();
  await d.caption("Em Cargo, escolha Supervisor", { step: 8, hold: 300 });
  await d.select(cargo, NAME, { after: 900 });
  await d.caption("E salve", { hold: 300 });
  await d.click(page.getByRole("button", { name: "Salvar alterações" }).first(), { before: 700, after: 1600 });
  await d.caption("O Carlos passa a ver o Painel e os Relatórios, sem mexer nas configurações da empresa", {
    hold: 3200,
  });
  await d.hideCaption();

  await d.title("Pronto!", "Cada pessoa vê o que precisa", 3000, { keep: true });
}
