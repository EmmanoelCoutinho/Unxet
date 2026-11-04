// Tutorial: criar uma atendente (convite pela tela Atendentes)

export const meta = {
  id: "criar-atendente",
  title: "Como criar uma atendente",
  // Apagado antes de gravar, para o convite funcionar de novo
  cleanupEmails: ["ana.ribeiro@suaempresa.com.br"],
};

export async function run(page, d) {
  // A abertura aparece logo; o sistema termina de carregar por trás
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como criar uma atendente", "Tutorial Unxet · Primeiros passos", 3200);
  await page.getByRole("button", { name: "Atendentes" }).first().waitFor();
  await opening;

  // 1. Abrir a tela
  // Atendentes fica no fim do menu: a legenda sobe para não cobrir o botão
  await d.caption("No menu lateral, abra Atendentes", { step: 1, hold: 600, top: true });
  // Abre o menu e rola até o botão, que é o último da lista
  const attendantsItem = page.getByRole("button", { name: "Atendentes" }).first();
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await attendantsItem.evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "smooth" }),
  );
  await d.wait(700);
  await d.click(attendantsItem, {
    before: 1800,
    after: 1400,
  });
  await page.mouse.move(900, 400, { steps: 20 }); // recolhe o menu
  await d.caption("Aqui ficam todas as pessoas da sua equipe", { hold: 2200 });

  // 2. Convidar
  const inviteButton = page.getByRole("button", { name: /Convidar atendente/ }).first();
  await d.caption("Clique em Convidar atendente", { step: 2, hold: 400 });
  await d.click(inviteButton, { after: 1200 });

  const dialog = page
    .locator("div.fixed.inset-0")
    .filter({ has: page.getByRole("heading", { name: "Convidar atendente" }) });
  await d.caption("Preencha o e-mail da nova atendente", { step: 3, hold: 300 });
  await d.type(dialog.getByPlaceholder("email@empresa.com"), "ana.ribeiro@suaempresa.com.br");

  await d.caption("Depois, o nome dela", { step: 4, hold: 300 });
  await d.type(dialog.getByPlaceholder("Nome do atendente"), "Ana Ribeiro");

  const selects = dialog.locator("select");
  await d.caption("Escolha o cargo: Atendente vê os atendimentos; Administrador vê todas as telas", {
    step: 5,
    hold: 600,
  });
  await d.select(selects.nth(0), "Atendente", { after: 2200 });

  await d.caption("Se quiser, escolha o setor principal dela", { step: 6, hold: 300 });
  await d.select(selects.nth(1), "Recepção", { after: 1200 });

  await d.caption("Clique em Enviar convite", { step: 7, hold: 300 });
  await d.click(dialog.getByRole("button", { name: "Enviar convite" }), { after: 300 });
  await dialog.waitFor({ state: "hidden", timeout: 15000 });

  // 3. Resultado
  const row = page.getByText("Ana Ribeiro").first();
  await row.waitFor({ timeout: 15000 });
  await d.wait(600);
  await d.caption("Pronto! A Ana aparece na lista da equipe", { hold: 400 });
  await d.point(row, 2000);
  await d.caption("Ela recebe um e-mail para criar a senha e já pode começar a atender", {
    hold: 3400,
  });
  await d.hideCaption();

  await d.title("Pronto!", "Sua atendente já faz parte da equipe", 3000, { keep: true });
}
