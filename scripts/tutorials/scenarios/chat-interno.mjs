// Tutorial: chat interno (Mariana fala com o Carlos). A resposta do Carlos
// é simulada no banco local; as mensagens do vídeo são apagadas no fim.

import { CARLOS, CLINIC, MARIANA } from "./_juliana.mjs";

const MINE = "Carlos, a Juliana Costa pediu a segunda via do boleto. Consegue ver pra mim?";
const REPLY = "Vejo sim! Já mando pra ela 👍";

export const meta = {
  id: "chat-interno",
  title: "Como usar o chat interno",
  login: "mariana@teste.local",
};

const wipe = (db) =>
  db.sql(`
    delete from internal_chat_messages where clinic_id = '${CLINIC}'
      and body in (${db.lit(MINE)}, ${db.lit(REPLY)});
    -- a conversa Mariana x Carlos que o vídeo abre, se ficou vazia
    delete from internal_chat_reads where thread_id in (
      select t.id from internal_chat_threads t
      where t.clinic_id = '${CLINIC}'
        and ((t.user_a = '${MARIANA}' and t.user_b = '${CARLOS}') or (t.user_a = '${CARLOS}' and t.user_b = '${MARIANA}'))
        and not exists (select 1 from internal_chat_messages m where m.thread_id = t.id));
    delete from internal_chat_threads t
      where t.clinic_id = '${CLINIC}'
        and ((t.user_a = '${MARIANA}' and t.user_b = '${CARLOS}') or (t.user_a = '${CARLOS}' and t.user_b = '${MARIANA}'))
        and not exists (select 1 from internal_chat_messages m where m.thread_id = t.id);
  `);

export async function prepare(db) {
  wipe(db);
}

export async function restore(db) {
  wipe(db);
}

export async function run(page, d, db) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como usar o chat interno", "Tutorial Unxet · Atendimento no dia a dia", 3200);
  const menuItem = page.getByRole("button", { name: "Chat interno" }).first();
  await menuItem.waitFor();
  await opening;

  await d.caption("Fale com a equipe sem sair da Unxet e sem usar o WhatsApp pessoal", { hold: 2400 });

  // 1. Abrir
  await d.caption("No menu lateral, abra Chat interno", { step: 1, hold: 300 });
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await d.click(menuItem, { before: 1000, after: 1400 });
  await page.mouse.move(900, 420, { steps: 20 });

  // 2. Escolher a pessoa
  const general = page.getByText("Geral", { exact: true }).first();
  if (await general.isVisible().catch(() => false)) {
    await d.caption("No canal Geral, a mensagem vai para a equipe toda", { step: 2, hold: 300 });
    await d.point(general, 2000);
  }
  await d.caption("Ou escolha uma pessoa para conversar só com ela", { step: 3, hold: 300 });
  const search = page.getByPlaceholder("Buscar pessoa...").first();
  if (await search.isVisible().catch(() => false)) {
    await d.type(search, "Carlos", { delay: 120 });
    await d.wait(700);
  }
  await d.click(page.getByText("Carlos Lima", { exact: true }).first(), { after: 1400 });

  // 3. Mensagem
  await d.caption("Escreva e envie", { step: 4, hold: 300 });
  const input = page.getByPlaceholder("Mensagem para a equipe...").first();
  await d.type(input, MINE, { delay: 30 });
  await d.click(page.getByRole("button", { name: "Enviar" }).last(), { before: 500, after: 1600 });

  // A resposta do Carlos (como chegaria de outro computador)
  db.sql(`
    insert into internal_chat_messages (thread_id, clinic_id, sender_id, body, created_at)
    select t.id, '${CLINIC}', '${CARLOS}', ${db.lit(REPLY)}, now()
    from internal_chat_threads t
    where t.clinic_id = '${CLINIC}'
      and ((t.user_a = '${MARIANA}' and t.user_b = '${CARLOS}') or (t.user_a = '${CARLOS}' and t.user_b = '${MARIANA}'))
    limit 1;
    update internal_chat_threads set last_message_at = now()
    where clinic_id = '${CLINIC}'
      and ((user_a = '${MARIANA}' and user_b = '${CARLOS}') or (user_a = '${CARLOS}' and user_b = '${MARIANA}'));
  `);
  await page.getByText(REPLY).last().waitFor({ timeout: 10000 });
  await d.caption("A resposta chega na hora. Quando você está em outra tela, o número aparece no menu", {
    step: 5,
    hold: 3200,
  });
  await d.hideCaption();

  await d.title("Pronto!", "Sua equipe conversando em um só lugar", 3000, { keep: true });
}
