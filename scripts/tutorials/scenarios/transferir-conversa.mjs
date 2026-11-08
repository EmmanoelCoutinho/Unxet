// Tutorial: transferir uma conversa para outro setor (Mariana passa a
// Juliana, que pediu a segunda via do boleto, para o Financeiro).

import { createJuliana, wipeJuliana } from "./_juliana.mjs";

export const meta = {
  id: "transferir-conversa",
  title: "Como transferir uma conversa",
  login: "mariana@teste.local",
};

export async function prepare(db) {
  createJuliana(db);
}

export async function restore(db) {
  wipeJuliana(db);
}

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como transferir uma conversa", "Tutorial Unxet · Atendimento no dia a dia", 3200);
  await page.getByText(/^Abertas/).first().waitFor();
  await opening;

  // 1. Abrir
  const openTab = page.getByText(/^Abertas/).first();
  await d.caption("Abra a conversa que precisa ir para outro setor", { step: 1, hold: 300 });
  await d.click(openTab, { after: 900 });
  await d.click(page.getByText("Juliana Costa", { exact: true }).first(), { after: 1600 });
  await d.caption("A cliente pediu a segunda via do boleto: quem cuida é o Financeiro", { hold: 2600 });

  // 2. Transferir
  await d.caption("Nas ações da conversa, clique em Transferir conversa", { step: 2, hold: 300 });
  await d.click(page.getByRole("button", { name: "Mais ações" }).last(), { after: 700 });
  await d.click(page.getByRole("button", { name: /Transferir conversa/i }).last(), { after: 1000 });
  await d.caption("Escolha o setor de destino", { step: 3, hold: 300 });
  const sector = page.locator("select").filter({ hasText: "Selecione..." }).last();
  await d.select(sector, "Financeiro", { after: 800 });
  await d.caption("E clique em Transferir", { step: 4, hold: 300 });
  await d.click(page.getByRole("button", { name: "Transferir", exact: true }).last(), { before: 700, after: 2000 });

  await d.caption("A conversa vai para a fila do Financeiro, com todo o histórico, até alguém de lá aceitar", {
    hold: 3200,
  });
  await d.hideCaption();

  await d.title("Pronto!", "O cliente fala com quem pode ajudar", 3000, { keep: true });
}
