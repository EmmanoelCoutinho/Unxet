// Tutorial: conhecer a tela de atendimentos (visão da atendente Mariana).
// As datas da atividade de demonstração vão para hoje durante a gravação.

import { bringActivityToToday, restoreActivity } from "../db.mjs";
import { CLINIC, createJuliana, wipeJuliana } from "./_juliana.mjs";

export const meta = {
  id: "conhecer-atendimentos",
  title: "Conhecendo a tela de atendimentos",
  login: "mariana@teste.local",
};

export async function prepare(db) {
  const days = bringActivityToToday(CLINIC);
  createJuliana(db);
  return days;
}

export async function restore(db, days) {
  wipeJuliana(db);
  restoreActivity(CLINIC, days);
}

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Conhecendo a tela de atendimentos", "Tutorial Unxet · Atendimento no dia a dia", 3200);
  const openTab = page.getByText(/^Abertas/).first();
  await openTab.waitFor();
  await opening;

  await d.caption("Aqui ficam as conversas com os clientes", { hold: 2000 });

  // 1. Abas
  await d.caption("Abertas: as conversas que estão com você", { step: 1, hold: 300 });
  await d.click(openTab, { after: 1600 });
  await d.caption("Pendentes: clientes esperando alguém assumir", { step: 2, hold: 300 });
  await d.click(page.getByText(/^Pendentes/).first(), { after: 1600 });
  await d.caption("No bot: o bot ainda está conversando com o cliente", { step: 3, hold: 300 });
  await d.click(page.getByText(/^No bot/).first(), { after: 1600 });
  await d.click(openTab, { before: 400, after: 900 });

  // 2. Filtros e busca
  await d.caption("Filtre por canal: WhatsApp, Instagram ou Messenger", { step: 4, hold: 300 });
  const whatsapp = page.getByRole("button", { name: "WhatsApp", exact: true }).first();
  await d.click(whatsapp, { after: 1400 });
  await d.click(whatsapp, { before: 400, after: 700 });
  await d.caption("Ou por etiqueta, para achar um tipo de conversa", { hold: 300 });
  await d.point(page.getByRole("button", { name: "Agendamento", exact: true }).first(), 1800);
  await d.caption("Busque pelo nome do cliente", { step: 5, hold: 300 });
  const search = page.getByPlaceholder("Buscar...").first();
  await d.type(search, "Juliana", { delay: 110 });
  await d.wait(1200);
  await search.fill("");
  await d.wait(800);

  // 3. Selos
  const sla = page.getByText("SLA estourado").first();
  if (await sla.count()) {
    await d.caption("Em vermelho: o cliente passou do tempo de resposta. Responda esse primeiro", {
      step: 6,
      hold: 300,
    });
    await d.point(sla, 2400);
  }
  await d.caption("O número azul mostra as mensagens que você ainda não leu", { hold: 300 });
  await d.point(page.getByText(/não lidas/).first(), 2000);

  // 4. Janela da conversa
  await d.caption("Clique numa conversa para abrir", { step: 7, hold: 300 });
  await d.click(page.getByText("Juliana Costa", { exact: true }).first(), { after: 1400 });
  await d.caption("Ela abre numa janela: dá para minimizar e seguir na lista", { hold: 300 });
  await d.point(page.getByRole("button", { name: "Minimizar" }).first(), 1600);
  await d.caption("Ou abrir em tela cheia", { hold: 300 });
  await d.click(page.getByRole("button", { name: "Abrir em tela cheia" }).first(), { before: 900, after: 2000 });
  await d.hideCaption();

  await d.title("Pronto!", "Agora você conhece a tela de atendimentos", 3000, { keep: true });
}
