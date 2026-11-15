// Tutorial: Banco de arquivos. O admin cadastra um PDF na biblioteca (com
// pasta e descrição) e, na conversa em tela cheia, envia pelo + > Banco de
// arquivos, sem procurar no computador. O PDF é gerado na hora (fictício);
// o envio passa pela Evolution de mentira. Tudo é apagado no fim.

import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLINIC, ADMIN, createJuliana, wipeJuliana } from "./_juliana.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(here, "..", ".videos", "banco");
const PDF = path.join(TMP, "catalogo-de-planos.pdf");
const FILE_NAME = "Catálogo de planos 2026";

export const meta = {
  id: "banco-de-arquivos",
  title: "Como usar o Banco de arquivos",
  mockEvolution: [8787],
};

const wipeFile = (db) =>
  db.sql(`delete from file_library where clinic_id = '${CLINIC}' and name = ${db.lit(FILE_NAME)};`);

// Banco local: a função media-urls não reconhece os links 127.0.0.1 (veja
// enviar-arquivos.mjs). Durante a gravação o bucket fica público.
export async function prepare(db) {
  wipeFile(db);
  createJuliana(db, { assignee: ADMIN });
  db.sql(`update storage.buckets set public = true where id = 'whatsapp-media';`);
}

export async function restore(db) {
  wipeFile(db);
  wipeJuliana(db);
  db.sql(`update storage.buckets set public = false where id = 'whatsapp-media';`);
}

const makePdf = async (page) => {
  mkdirSync(TMP, { recursive: true });
  const tmp = await page.context().browser().newPage();
  await tmp.setContent(`
    <body style="font-family:Arial,sans-serif;padding:40px">
      <h1 style="color:#0A84FF">Catálogo de planos 2026</h1>
      <p>Empresa Teste · documento de exemplo</p>
      <p>Mensal R$ 99 · Semestral R$ 89 · Anual R$ 79 (por mês)</p>
    </body>`);
  await tmp.pdf({ path: PDF, format: "A4" });
  await tmp.close();
};

export async function run(page, d) {
  await page.route("**/functions/v1/media-urls", async (route) => {
    const urls = route.request().postDataJSON()?.urls ?? [];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ urls: Object.fromEntries(urls.map((u) => [u, u])) }),
    });
  });
  await makePdf(page);

  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como usar o Banco de arquivos", "Tutorial Unxet · Atendimento no dia a dia", 3200);
  const menuItem = page.getByRole("button", { name: "Banco de arquivos" }).first();
  await menuItem.waitFor();
  await opening;

  // 1. Abrir
  await d.caption("No menu lateral, abra o Banco de arquivos", { step: 1, hold: 500 });
  await d.click(menuItem, { before: 1200, after: 1400 });
  await page.mouse.move(900, 400, { steps: 20 });
  await d.caption("Guarde aqui os arquivos que a equipe envia sempre: tabelas, catálogos, contratos", {
    hold: 2600,
  });

  // 2. Adicionar
  await d.caption("Clique em Adicionar arquivo", { step: 2, hold: 300 });
  await d.click(page.getByRole("button", { name: "Adicionar arquivo" }).first(), { after: 900 });
  const chooser = page.waitForEvent("filechooser");
  await d.click(page.getByText("Clique para escolher ou arraste o arquivo aqui"), { before: 600, after: 200 });
  await (await chooser).setFiles(PDF);
  await d.wait(900);

  const name = page.locator("#library-file-name");
  await name.fill("");
  await d.caption("Dê um nome fácil de achar", { step: 3, hold: 300, top: true });
  await d.type(name, FILE_NAME, { delay: 55 });
  await d.caption("Pasta e descrição ajudam a organizar (opcionais)", { step: 4, hold: 300, top: true });
  await d.type(page.locator("#library-file-folder"), "Comercial", { delay: 80 });
  await d.type(page.locator("#library-file-description"), "Enviar quando o cliente pedir os planos", {
    delay: 40,
  });
  await d.click(page.getByRole("button", { name: "Adicionar", exact: true }).last(), { after: 1800 });
  await d.caption("Pronto: o arquivo fica disponível para toda a equipe", { hold: 2200 });

  // 3. Enviar na conversa (tela cheia)
  await d.caption("Agora, abra a conversa com o cliente", { step: 5, hold: 300 });
  const item = page.getByText("Juliana Costa", { exact: true }).first();
  await item.waitFor();
  await d.click(item, { after: 1400 });
  await d.click(page.getByRole("button", { name: "Abrir em tela cheia" }).last(), { after: 1400 });

  await d.caption("Clique no + e escolha Banco de arquivos", { step: 6, hold: 300 });
  await d.click(page.getByRole("button", { name: "Anexar" }).last(), { after: 900 });
  await d.click(page.getByRole("button", { name: /Banco de arquivos/ }).last(), { after: 1200 });
  await d.caption("Clique no arquivo e ele vai na hora, sem procurar no computador", { step: 7, hold: 300 });
  await d.click(page.getByRole("button", { name: new RegExp(FILE_NAME) }).last(), { before: 900, after: 2600 });

  await d.caption("Em Enviados recentemente, você reaproveita o que a equipe já mandou", { hold: 2800 });
  await d.hideCaption();

  await d.title("Pronto!", "Os arquivos da empresa sempre à mão", 3000, { keep: true });
}
