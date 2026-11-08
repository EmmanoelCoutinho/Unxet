// Tutorial: configurar o assistente com IA e criar a etapa de IA no bot.
// A configuração da IA da Empresa Teste é guardada antes e devolvida no fim.
// No editor do bot a etapa é montada mas NÃO é salva (o bot Triagem, que
// atende a Empresa Teste, não muda).

const CLINIC = "00000000-0000-0000-0000-0000000000c1";

export const meta = {
  id: "assistente-ia",
  title: "Como configurar o assistente com IA",
};

export async function prepare(db) {
  const [row] = db.sql(`select row_to_json(s) from clinic_ai_settings s where clinic_id = '${CLINIC}';`);
  // Começa com os campos de texto vazios para o vídeo mostrar o preenchimento
  if (row) {
    db.sql(`update clinic_ai_settings set assistant_name = 'Assistente', business_info = '', faq = '', rules = ''
            where clinic_id = '${CLINIC}';`);
  }
  return { row: row ?? null };
}

export async function restore(db, state) {
  db.sql(`delete from clinic_ai_settings where clinic_id = '${CLINIC}';`);
  if (state?.row) {
    db.sql(`insert into clinic_ai_settings
            select * from json_populate_record(null::clinic_ai_settings, ${db.lit(state.row)}::json);`);
  }
}

/** O campo de texto logo depois de um rótulo */
const fieldAfter = (page, label, tag = "textarea") =>
  page.locator(`xpath=//label[normalize-space()='${label}']/following::${tag}[1]`).first();

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como configurar o assistente com IA", "Tutorial Unxet · Automação", 3200);
  const menuItem = page.getByRole("button", { name: "Assistente com IA" }).first();
  await menuItem.waitFor();
  await opening;

  // 1. Abrir
  await d.caption("No menu lateral, abra Assistente com IA", { step: 1, hold: 500 });
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await d.click(menuItem, { before: 1200, after: 1400 });
  await page.mouse.move(900, 420, { steps: 20 });
  await d.caption("A IA conversa com os clientes pelo bot, usando o que você ensinar aqui", { hold: 300 });
  await d.point(page.getByText("A IA só atende pelo bot").first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]"), 2600);
  await d.caption("Aqui você acompanha quantas respostas a IA já usou no mês", { hold: 300 });
  await d.point(page.getByText("Uso neste mês").first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]"), 2000);

  // 2. Jeito de falar
  await d.caption("Dê um nome e escolha o tom de voz", { step: 2, hold: 300 });
  const name = page.locator("#ai-name");
  await name.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(500);
  await d.click(name, { before: 400, after: 200 });
  await name.fill("");
  await d.type(name, "Sofia", { delay: 120 });
  await d.point(page.locator("#ai-tone"), 1200);
  await d.caption("E até quantas mensagens ela responde antes de passar para a equipe", { hold: 300 });
  await d.point(page.getByText("Respostas por atendimento").first(), 2000);

  // 3. O que ela sabe
  await d.caption("Em Sobre a empresa, escreva serviços, preços, horários e endereço", { step: 3, hold: 300 });
  const about = fieldAfter(page, "Sobre a empresa");
  await about.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(500);
  await d.type(
    about,
    "Atendemos de segunda a sexta, das 8h às 18h.\nPlanos: mensal R$ 99, semestral R$ 89/mês, anual R$ 79/mês.\nPagamento: cartão, Pix ou boleto.",
    { delay: 14 },
  );
  await d.caption("Em Perguntas frequentes, as dúvidas mais comuns com a resposta", { step: 4, hold: 300 });
  const faq = fieldAfter(page, "Perguntas frequentes");
  await faq.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(400);
  await d.type(faq, "Dá para cancelar quando quiser?\nSim, sem multa no plano mensal.", { delay: 14 });
  await d.caption("Em Regras, o que a IA não deve fazer", { step: 5, hold: 300 });
  const rules = fieldAfter(page, "Regras");
  await rules.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(400);
  await d.type(rules, "Não ofereça descontos. Não prometa prazos de entrega.", { delay: 16 });
  await d.caption("A IA só responde com o que estiver escrito aqui. Clique em Salvar", { step: 6, hold: 300 });
  const save = page.getByRole("button", { name: "Salvar", exact: true }).first();
  await save.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(400);
  await d.click(save, { before: 700, after: 1600 });

  // 4. Etapa de IA no bot
  await d.caption("Agora, no bot, crie uma etapa de Atendimento com IA", { step: 7, hold: 300 });
  const editor = page.getByRole("link", { name: "Abrir editor do bot" }).first();
  await editor.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(500);
  await d.click(editor, { before: 700, after: 1400 });
  const row = page
    .locator("div")
    .filter({ hasText: "Triagem" })
    .filter({ has: page.getByRole("button", { name: "Editar" }) })
    .last();
  await d.click(row.getByRole("button", { name: "Editar" }).first(), { after: 1400 });
  await d.click(page.getByRole("button", { name: "Fluxo da conversa" }).first(), { after: 1200 });
  await d.caption("Clique em + para criar uma etapa e escolha Atendimento com IA", { step: 8, hold: 300 });
  await d.click(page.getByRole("button", { name: "Nova etapa" }).first(), { after: 1000 });
  await d.click(page.getByRole("radio", { name: /Atendimento com IA/ }).first(), { before: 600, after: 1000 });
  await d.caption("Diga o objetivo da IA nesta etapa e para qual setor ela passa a conversa", {
    step: 9,
    hold: 300,
  });
  const goal = page.getByPlaceholder(/Tire dúvidas sobre os serviços/).first();
  await goal.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(400);
  await d.type(
    goal,
    "Tire dúvidas sobre os planos. Se o cliente quiser contratar, peça o nome e passe para a equipe.",
    { delay: 18 },
  );
  await d.select(page.locator("#stage-ai-department"), "Recepção", { after: 900 });
  await d.caption("Depois, ligue um botão do menu a esta etapa (Abrir etapa), salve e ative o bot", {
    hold: 3400,
  });
  await d.hideCaption();

  await d.title("Pronto!", "Sua IA atende a qualquer hora", 3000, { keep: true });
}
