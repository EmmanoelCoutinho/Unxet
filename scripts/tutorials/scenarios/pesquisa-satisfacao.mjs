// Tutorial: pesquisa de satisfação (nota de 0 a 10, sem prazo).
// Liga a pesquisa em Automações de conversa, finaliza a conversa da Juliana
// em tela cheia (a pesquisa sai pela Evolution de mentira), a cliente
// responde "10" e a nota aparece na conversa e nos Relatórios.
// A configuração da Empresa Teste é guardada antes e devolvida no fim.

import { CLINIC, ADMIN, CONVERSATION, PHONE, createJuliana, wipeJuliana } from "./_juliana.mjs";

const SURVEY_TEXT =
  "Como você avalia o nosso atendimento? Responda com uma nota de 0 a 10, sendo 0 muito insatisfeito e 10 muito satisfeito.";

export const meta = {
  id: "pesquisa-satisfacao",
  title: "Como usar a pesquisa de satisfação",
  mockEvolution: [8787],
};

export async function prepare(db) {
  const [row] = db.sql(
    `select row_to_json(s) from conversation_automation_settings s where clinic_id = '${CLINIC}';`,
  );
  // Começa desligada (o vídeo mostra como ligar), com o texto padrão da
  // pergunta e sem agradecimento
  db.sql(`update conversation_automation_settings
             set satisfaction_survey_enabled = false,
                 satisfaction_survey_message = ${db.lit(SURVEY_TEXT)},
                 satisfaction_survey_thanks_message = null
           where clinic_id = '${CLINIC}';`);
  createJuliana(db, { assignee: ADMIN });
  return { row: row ?? null };
}

export async function restore(db, state) {
  wipeJuliana(db);
  db.sql(`delete from conversation_automation_settings where clinic_id = '${CLINIC}';`);
  if (state?.row) {
    db.sql(`insert into conversation_automation_settings
            select * from json_populate_record(null::conversation_automation_settings, ${db.lit(state.row)}::json);`);
  }
}

/** A cliente responde a pesquisa (como o webhook do WhatsApp faria) */
const answerSurvey = (db, score) =>
  db.sql(`
    insert into messages (conversation_id, direction, type, sender, text, payload, sent_at, created_at)
    values ('${CONVERSATION}', 'inbound', 'text', '${PHONE}', '${score}', '{}', now(), now());
    with s as (
      update satisfaction_surveys
         set status = 'answered', score = ${score}, scale_min = 0, scale_max = 10,
             raw_answer = '${score}', answered_at = now()
       where conversation_id = '${CONVERSATION}' and status = 'sent'
       returning conversation_id)
    insert into conversation_events (conversation_id, event_type, performed_by, metadata)
    select conversation_id, 'satisfaction_survey_answered', null,
           jsonb_build_object('score', ${score}, 'scale_min', 0, 'scale_max', 10)
    from s;
  `);

export async function run(page, d, db) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title(
    "Como usar a pesquisa de satisfação",
    "Tutorial Unxet · Gestão",
    3200,
  );
  const settingsItem = page.getByRole("button", { name: "Configurações" }).first();
  await settingsItem.waitFor();
  await opening;

  // 1. Ligar
  await d.caption("Em Configurações, fica a aba Automações de conversa", { step: 1, hold: 600, top: true });
  await d.click(settingsItem, { before: 1500, after: 1200 });
  await page.mouse.move(900, 380, { steps: 20 });
  const toggle = page.getByRole("switch", { name: "Pesquisa de satisfação" });
  await toggle.waitFor();
  await toggle.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(800);
  await d.caption("Ligue a Pesquisa de satisfação", { step: 2, hold: 300 });
  await d.click(toggle, { before: 800, after: 900 });

  const message = page.locator("textarea").first();
  await message.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(700);
  await d.caption("A nota é sempre de 0 a 10. Você pode mudar o texto da pergunta", { step: 3, hold: 300 });
  await d.point(message, 2600);
  const thanks = page.locator("textarea").nth(1);
  await thanks.fill("");
  await d.caption("E, se quiser, mandar um agradecimento depois da nota", { step: 4, hold: 300 });
  await d.type(thanks, "Obrigado pela avaliação! Até a próxima 😊", { delay: 45 });

  const save = page.getByRole("button", { name: "Salvar configurações" }).last();
  await save.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.caption("Clique em Salvar configurações", { step: 5, hold: 300 });
  await d.click(save, { before: 900, after: 2000 });

  // 2. Finalizar a conversa (tela cheia)
  await d.caption("A pesquisa sai sozinha quando a conversa é finalizada", { step: 6, hold: 300 });
  const item = page.getByText("Juliana Costa", { exact: true }).first();
  await item.waitFor();
  await d.click(item, { after: 1400 });
  await d.click(page.getByRole("button", { name: "Abrir em tela cheia" }).last(), { after: 1400 });
  await d.click(page.getByRole("button", { name: /Finalizar conversa/ }).last(), { after: 900 });
  await d.click(page.getByRole("button", { name: "Finalizar", exact: true }).last(), { after: 2400 });

  // Finalizada, a conversa sai da lista; no Painel, Atendimentos de hoje
  const today = page.getByText("Atendimentos de hoje").first();
  await today.waitFor({ timeout: 15000 });
  await today.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
  await d.wait(900);
  await d.caption("As conversas finalizadas hoje ficam no Painel, em Atendimentos de hoje", { hold: 300, top: true });
  await d.click(page.getByRole("button", { name: /^Finalizada \(/ }).first(), { before: 900, after: 1200 });
  await d.click(page.getByRole("button", { name: /Juliana Costa/ }).first(), { after: 1600 });
  const fullscreen = page.getByRole("button", { name: "Abrir em tela cheia" });
  if (await fullscreen.count()) await d.click(fullscreen.last(), { after: 1400 });
  await page.getByText(/enviou a pesquisa de satisfação/).last().waitFor({ timeout: 15000 });
  await d.wait(800);
  await d.caption("O cliente recebe a pergunta no WhatsApp", { hold: 2400, top: true });

  // 3. Resposta
  answerSurvey(db, 10);
  await page.getByText(/avaliou o atendimento com nota 10/).last().waitFor({ timeout: 15000 });
  await d.wait(600);
  await d.caption("Quando ele responde, a nota aparece aqui, sem reabrir a conversa", { step: 7, hold: 2800, top: true });
  await d.caption("Não tem prazo: vale mesmo se o cliente responder dias depois", { hold: 2600, top: true });

  // 4. Relatórios
  await d.caption("Acompanhe as notas em Relatórios, na aba Satisfação", { step: 8, hold: 300 });
  await d.click(page.getByRole("button", { name: "Relatórios" }).first(), { before: 900, after: 1200 });
  await page.mouse.move(900, 380, { steps: 20 });
  const tab = page.getByRole("button", { name: "Satisfação (CSAT)" }).first();
  await tab.waitFor({ timeout: 20000 });
  await d.click(tab, { after: 1200 });
  await tab.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
  await d.wait(1200);
  await d.caption("Nota média, taxa de resposta e as notas baixas para você agir", { hold: 3600 });
  await d.hideCaption();

  await d.title("Pronto!", "Saiba o que os clientes acham do atendimento", 3000, { keep: true });
}
