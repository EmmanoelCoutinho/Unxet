// Tutorial: cadastrar uma mensagem rápida (administrador ou cargo com a
// permissão) e
// usar na conversa com "/". Gravado como administrador.
// A mensagem rápida e a conversa de exemplo são apagadas no fim; o envio
// passa pela Evolution de mentira.

import { ADMIN, CLINIC, createJuliana, openJuliana, wipeJuliana } from "./_juliana.mjs";

const TEXT = "Prontinho! Segue a segunda via do boleto. Qualquer dúvida, é só chamar 😊";

export const meta = {
  id: "usar-mensagens-rapidas",
  title: "Como usar mensagens rápidas",
  mockEvolution: [8787],
};

const wipeQuick = (db) =>
  db.sql(`delete from quick_messages where clinic_id = '${CLINIC}' and message = ${db.lit(TEXT)};`);

export async function prepare(db) {
  wipeQuick(db);
  createJuliana(db, { assignee: ADMIN });
}

export async function restore(db) {
  wipeQuick(db);
  wipeJuliana(db);
}

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como usar mensagens rápidas", "Tutorial Unxet · Atendimento no dia a dia", 3200);
  const menuItem = page.getByRole("button", { name: "Mensagens rápidas" }).first();
  await menuItem.waitFor();
  await opening;

  // 1. Cadastrar
  await d.caption("Respostas que você manda sempre? Cadastre uma vez e use com dois toques", {
    hold: 2400,
  });
  await d.caption("Quem cadastra é o administrador (ou um cargo com essa permissão): abra Mensagens rápidas", { step: 1, hold: 300 });
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await d.click(menuItem, { before: 1000, after: 1200 });
  await page.mouse.move(900, 420, { steps: 20 });
  await d.caption("Clique em Nova mensagem", { step: 2, hold: 300 });
  await d.click(page.getByRole("button", { name: /Nova mensagem/ }).first(), { after: 900 });
  await d.caption("Escreva o texto", { step: 3, hold: 300 });
  await d.type(page.getByPlaceholder("Ex: Olá! Tudo bem? Em que posso te ajudar hoje?"), TEXT, { delay: 30 });
  await d.click(page.getByRole("button", { name: "Salvar", exact: true }).last(), { before: 600, after: 1400 });
  await d.caption("Ela fica disponível para toda a equipe usar nas conversas", { hold: 2000 });

  // 2. Usar na conversa
  await d.caption("Agora, numa conversa", { step: 4, hold: 300 });
  const inboxItem = page.getByRole("button", { name: "Painel" }).first();
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await d.click(inboxItem, { before: 800, after: 1200 });
  await page.mouse.move(900, 420, { steps: 20 });
  await openJuliana(page, d);
  const input = page.getByPlaceholder("Digite uma mensagem...").last();
  await input.waitFor();
  await d.caption("Digite / e uma palavra da mensagem", { step: 5, hold: 300 });
  await d.type(input, "/boleto", { delay: 150 });
  const option = page.getByRole("option").filter({ hasText: "segunda via do boleto" }).first();
  await option.waitFor();
  await d.wait(500);
  await d.caption("Escolha na lista: o texto entra no campo", { hold: 300 });
  await d.click(option, { before: 900, after: 900 });
  await d.caption("Dá para ajustar antes. Aperte Enter para enviar", { step: 6, hold: 1200 });
  await input.press("Enter");
  await page.getByText("Prontinho! Segue a segunda via").last().waitFor();
  await d.wait(1600);
  await d.caption("Dica: o clipe de anexar também tem o atalho Mensagens rápidas", { hold: 2600 });
  await d.hideCaption();

  await d.title("Pronto!", "Respostas prontas, atendimento mais rápido", 3000, { keep: true });
}
