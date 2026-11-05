// Tutorial: ler o Painel (admin). As datas da atividade de demonstração são
// adiantadas para hoje durante a gravação e voltam no fim.

import { bringActivityToToday, restoreActivity } from "../db.mjs";

const CLINIC = "00000000-0000-0000-0000-0000000000c1";

/** O cartão inteiro em volta de um título (para o destaque contornar o cartão) */
const card = (page, text) =>
  page
    .getByText(text, { exact: true })
    .first()
    .locator("xpath=ancestor::*[self::div or self::article or self::section][contains(@class,'rounded')][1]");

export const meta = {
  id: "painel",
  title: "Como ler o Painel",
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
  const opening = d.title("Como ler o Painel", "Tutorial Unxet · Gestão", 3200);
  const heading = page.getByRole("heading", { name: "Painel" }).first();
  await heading.waitFor();
  await page.getByText("Clientes esperando resposta").first().waitFor();
  await opening;

  await d.caption("O Painel mostra o atendimento agora e se atualiza sozinho", { hold: 300 });
  await d.point(heading, 2000);

  const alert = page.getByText(/clientes? estão? esperando além da meta/).first();
  if (await alert.count()) {
    await d.caption("Se clientes passam da meta de 1ª resposta, aparece este alerta", {
      hold: 300,
    });
    await d.point(alert, 2200);
  }

  await d.caption("Agora: quantos clientes esperam resposta neste momento", { step: 1, hold: 300 });
  await d.point(card(page, "Clientes esperando resposta"), 2000);
  await d.caption("Em vermelho, os que já passaram da meta: atenda esses primeiro", {
    step: 2,
    hold: 300,
  });
  await d.point(card(page, "Além da meta de 1ª resposta"), 2200);
  await d.caption("Na fila sem responsável: ninguém assumiu ainda", { step: 3, hold: 300 });
  await d.point(card(page, "Na fila sem responsável"), 2000);
  await d.caption("E quantas pessoas da equipe estão online agora", { step: 4, hold: 300 });
  await d.point(card(page, "Equipe online"), 1800);

  await d.caption("Hoje: o dia de hoje comparado com ontem, até o mesmo horário", {
    step: 5,
    hold: 300,
  });
  await d.point(card(page, "Novas conversas"), 2400);

  await d.caption("Equipe agora: quem está online e quantos clientes cada um tem esperando", {
    step: 6,
    hold: 300,
  });
  await d.point(card(page, "Equipe agora"), 2600);

  await d.caption("A fila mostra quem espera há mais tempo; clique para abrir a conversa", {
    step: 7,
    hold: 300,
  });
  await d.point(card(page, "Fila: clientes esperando resposta"), 2800);

  await d.caption("Filtre por canal ou departamento quando quiser olhar só uma parte", {
    step: 8,
    hold: 300,
  });
  await page.getByRole("heading", { name: "Painel" }).first().evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "smooth" }),
  );
  await d.wait(800);
  await d.point(page.getByRole("combobox").first(), 2000);
  await d.caption("Para ver um período, como o mês, use Análise do período", { hold: 300 });
  await d.point(page.getByRole("button", { name: /Análise do período/ }).first(), 2200);
  await d.hideCaption();

  await d.title("Pronto!", "Olhe o Painel algumas vezes ao dia", 3000, { keep: true });
}
