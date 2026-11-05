// Tutorial: criar uma etiqueta (admin), marcar uma conversa e filtrar a
// lista por ela. A etiqueta é apagada no fim (com as marcações).

import { CLINIC, createJuliana, wipeJuliana } from "./_juliana.mjs";

const NAME = "Pós-venda";

export const meta = {
  id: "usar-etiquetas",
  title: "Como usar etiquetas",
};

const wipeTag = (db) =>
  db.sql(`
    delete from conversation_tags where tag_id in (
      select id from tags where clinic_id = '${CLINIC}' and name = ${db.lit(NAME)});
    delete from deal_tags where tag_id in (
      select id from tags where clinic_id = '${CLINIC}' and name = ${db.lit(NAME)});
    delete from tags where clinic_id = '${CLINIC}' and name = ${db.lit(NAME)};
  `);

export async function prepare(db) {
  wipeTag(db);
  createJuliana(db);
}

export async function restore(db) {
  wipeTag(db);
  wipeJuliana(db);
}

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como usar etiquetas", "Tutorial Unxet · Atendimento no dia a dia", 3200);
  const menuItem = page.getByRole("button", { name: "Etiquetas" }).first();
  await menuItem.waitFor();
  await opening;

  // 1. Criar (administrador)
  await d.caption("Etiquetas marcam as conversas para achar e agrupar depois", { hold: 2200 });
  await d.caption("Quem cria é o administrador: abra Etiquetas no menu", { step: 1, hold: 300 });
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await d.click(menuItem, { before: 1000, after: 1200 });
  await page.mouse.move(900, 420, { steps: 20 });
  await d.caption("Clique em Nova etiqueta", { step: 2, hold: 300 });
  await d.click(page.getByRole("button", { name: /Nova Etiqueta/i }).first(), { after: 900 });
  await d.caption("Dê um nome e escolha uma cor", { step: 3, hold: 300 });
  await d.type(page.getByPlaceholder("Ex: Pós-venda"), NAME, { delay: 110 });
  await d.click(page.locator('button[class*="rounded-full"][style*="background"]').nth(1), { before: 500, after: 700 });
  await d.click(page.getByRole("button", { name: "Criar etiqueta" }).first(), { before: 600, after: 1400 });

  // 2. Marcar uma conversa
  await d.caption("Na conversa, abra as ações e escolha Gerenciar etiquetas", { step: 4, hold: 300 });
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await d.click(page.getByRole("button", { name: "Painel" }).first(), { before: 600, after: 1200 });
  await page.mouse.move(900, 420, { steps: 20 });
  await d.click(page.getByText("Juliana Costa", { exact: true }).first(), { after: 1400 });
  await d.click(page.getByRole("button", { name: "Mais ações" }).last(), { after: 700 });
  await d.click(page.getByRole("button", { name: /Gerenciar etiquetas/i }).last(), { after: 900 });
  await d.click(page.getByRole("button", { name: NAME, exact: true }).last(), { after: 1200 });
  await d.click(page.getByRole("button", { name: "Fechar" }).last(), { after: 900 });
  await d.caption("A etiqueta aparece na conversa e na lista", { hold: 2200 });

  // 3. Filtrar
  await d.caption("Para ver só essas conversas, clique na etiqueta no filtro da lista", {
    step: 5,
    hold: 300,
  });
  const filter = page.getByRole("button", { name: NAME, exact: true }).first();
  await d.click(filter, { after: 2200 });
  await d.caption("Etiquetas também servem para mandar campanhas só para esse grupo", { hold: 2800 });
  await d.hideCaption();

  await d.title("Pronto!", "Conversas organizadas por etiqueta", 3000, { keep: true });
}
