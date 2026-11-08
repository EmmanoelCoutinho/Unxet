// Tutorial: automações de conversa (meta de 1ª resposta, volta para a fila,
// fechamento e reabertura automáticos, pesquisa de satisfação).
// A configuração da Empresa Teste é guardada antes e devolvida no fim.

const CLINIC = "00000000-0000-0000-0000-0000000000c1";

export const meta = {
  id: "automacoes-conversa",
  title: "Como configurar as automações de conversa",
};

export async function prepare(db) {
  const [row] = db.sql(
    `select row_to_json(s) from conversation_automation_settings s where clinic_id = '${CLINIC}';`,
  );
  return { row: row ?? null };
}

export async function restore(db, state) {
  db.sql(`delete from conversation_automation_settings where clinic_id = '${CLINIC}';`);
  if (state?.row) {
    db.sql(`insert into conversation_automation_settings
            select * from json_populate_record(null::conversation_automation_settings, ${db.lit(state.row)}::json);`);
  }
}

/** Campo de minutos do mesmo cartão do interruptor */
const minutesOf = (page, title) =>
  page
    .getByRole("switch", { name: title })
    .locator("xpath=ancestor::div[.//input[@type='number']][1]")
    .getByRole("spinbutton");

/** Liga (se estiver desligado) e ajusta os minutos */
const setCard = async (page, d, title, minutes) => {
  const toggle = page.getByRole("switch", { name: title });
  await toggle.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  if ((await toggle.getAttribute("aria-checked")) !== "true") {
    await d.click(toggle, { before: 700, after: 700 });
  } else {
    await d.point(toggle, 900);
  }
  if (minutes !== undefined) {
    const input = minutesOf(page, title);
    await input.fill(""); // apaga o valor antigo antes de digitar
    await d.type(input, String(minutes), { delay: 160 });
  }
};

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title(
    "Como configurar as automações de conversa",
    "Tutorial Unxet · Primeiros passos",
    3200,
  );
  const settingsItem = page.getByRole("button", { name: "Configurações" }).first();
  await settingsItem.waitFor();
  await opening;

  // 1. Abrir
  await d.caption("No menu lateral, abra Configurações", { step: 1, hold: 600, top: true });
  await d.click(settingsItem, { before: 1500, after: 1200 });
  await page.mouse.move(900, 380, { steps: 20 });
  await page.getByRole("switch", { name: "SLA da primeira resposta" }).waitFor();
  await d.caption("Em Automações de conversa, a Unxet cuida do tempo de cada atendimento", {
    hold: 2400,
  });

  // 2. Cartões
  await d.caption("Meta de 1ª resposta: em quantos minutos o cliente deve ser respondido", {
    step: 2,
    hold: 300,
  });
  await setCard(page, d, "SLA da primeira resposta", 5);
  await d.caption("Quem passar desse tempo aparece em vermelho no Painel", { hold: 1800 });

  await d.caption("Voltar para a fila: se o atendente não responder, outra pessoa pode assumir", {
    step: 3,
    hold: 300,
  });
  await setCard(page, d, "Voltar para fila de espera", 30);

  await d.caption("Fechamento automático: encerra conversas paradas depois desse tempo", {
    step: 4,
    hold: 300,
  });
  await setCard(page, d, "Fechamento automático", 1440);
  await d.caption("1440 minutos são 24 horas", { hold: 1600 });

  await d.caption("Reabrir: se o cliente voltar a escrever, a conversa volta com todo o histórico", {
    step: 5,
    hold: 300,
  });
  await setCard(page, d, "Reabrir conversa automaticamente");
  await d.wait(800);

  // 3. Pesquisa
  await d.caption("Pesquisa de satisfação: a Unxet pergunta a nota ao cliente ao finalizar", {
    step: 6,
    hold: 300,
  });
  await setCard(page, d, "Pesquisa de satisfação");
  const surveyMessage = page.locator("textarea").first(); // Mensagem da pesquisa
  await surveyMessage.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.point(surveyMessage, 2200);
  await d.caption("As notas aparecem nos Relatórios, na aba Satisfação", { hold: 2000 });

  // 4. Salvar
  const save = page.getByRole("button", { name: "Salvar configurações" }).last();
  await save.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.caption("Clique em Salvar configurações", { step: 7, hold: 300 });
  await d.click(save, { before: 900, after: 2200 });
  await d.hideCaption();

  await d.title("Pronto!", "A Unxet cuida do tempo de cada conversa", 3000, { keep: true });
}
