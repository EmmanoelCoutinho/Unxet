// Tutorial: gerar e exportar relatórios (admin). As datas da atividade de
// demonstração são adiantadas para hoje durante a gravação e voltam no fim.

import { bringActivityToToday, restoreActivity } from "../db.mjs";

const CLINIC = "00000000-0000-0000-0000-0000000000c1";

/** O cartão inteiro em volta de um título (para o destaque contornar o cartão) */
const card = (page, text) =>
  page
    .getByText(text, { exact: true })
    .first()
    .locator("xpath=ancestor::*[self::div or self::article or self::section][contains(@class,'rounded')][1]");

export const meta = {
  id: "relatorios",
  title: "Como gerar e exportar relatórios",
};

export async function prepare() {
  return bringActivityToToday(CLINIC);
}

export async function restore(_db, days) {
  restoreActivity(CLINIC, days);
}

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como gerar e exportar relatórios", "Tutorial Unxet · Gestão", 3200);
  const menuItem = page.getByRole("button", { name: "Relatórios" }).first();
  await menuItem.waitFor();
  await opening;

  // 1. Abrir (Relatórios fica embaixo no menu: legenda no topo)
  await d.caption("No menu lateral, abra Relatórios", { step: 1, hold: 500, top: true });
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await menuItem.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.click(menuItem, { before: 1300, after: 1200 });
  await page.mouse.move(900, 380, { steps: 20 });
  await page.getByText("Destaques do período").first().waitFor({ timeout: 20000 });

  // 2. Período e filtros
  await d.caption("Escolha o período: atalhos prontos ou as datas que quiser", {
    step: 2,
    hold: 300,
  });
  await d.click(page.getByRole("button", { name: "Últimos 7 dias" }).first(), { after: 1000 });
  await d.click(page.getByRole("button", { name: "Últimos 30 dias" }).first(), { after: 900 });
  await d.caption("Filtre por departamento ou atendente e clique em Aplicar filtros", {
    step: 3,
    hold: 300,
  });
  const dept = page.locator("select").filter({ hasText: "Todos departamentos" }).first();
  await d.select(dept, "Recepção", { after: 600 });
  await d.click(page.getByRole("button", { name: "Aplicar filtros" }).first(), { after: 1600 });

  // 3. Leitura
  await d.caption("Os destaques resumem o período em poucas frases", { step: 4, hold: 300 });
  await d.point(card(page, "Destaques do período"), 2600);
  await d.caption("Cada número vem comparado com o período anterior", { step: 5, hold: 300 });
  await d.point(card(page, "1ª resposta (mediana)"), 2400);
  await d.caption("O gráfico mostra as conversas novas e finalizadas por dia", { step: 6, hold: 300 });
  await d.point(card(page, "Conversas por dia"), 2400);

  // 4. Abas
  await d.caption("Nas abas, veja a equipe, o tempo de atendimento e a satisfação", {
    step: 7,
    hold: 300,
  });
  const teamTab = page.getByRole("button", { name: "Desempenho da Equipe" }).first();
  await teamTab.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.click(teamTab, { after: 2600 });

  // 5. Exportar
  const exportButton = page.getByRole("button", { name: /Exportar/ }).first();
  await exportButton.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(600);
  await d.caption("Para compartilhar, exporte em PDF ou planilha", { step: 8, hold: 300 });
  await d.click(exportButton, { after: 2400 });
  await page.keyboard.press("Escape");
  await d.wait(500);
  await d.hideCaption();

  await d.title("Pronto!", "Use os relatórios para acompanhar a equipe", 3000, { keep: true });
}
