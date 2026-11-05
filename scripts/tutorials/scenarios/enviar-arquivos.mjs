// Tutorial: enviar imagem e documento (e onde gravar áudio) na conversa.
// A imagem e o PDF são gerados na hora (fictícios). O envio passa pela
// Evolution de mentira; a conversa de exemplo é apagada no fim.

import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createJuliana, openJuliana, wipeJuliana } from "./_juliana.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(here, "..", ".videos", "arquivos");
const IMAGE = path.join(TMP, "tabela-de-planos.png");
const PDF = path.join(TMP, "proposta-plano-anual.pdf");

export const meta = {
  id: "enviar-arquivos",
  title: "Como enviar áudio, imagem e arquivo",
  login: "mariana@teste.local",
  mockEvolution: [8787],
};

// Só no banco local: a função media-urls compara o endereço da mídia com o
// endereço interno do Docker (kong:8000) e não reconhece o 127.0.0.1 gravado
// pelo app, então a imagem não abriria no vídeo. Durante a gravação o bucket
// fica público e o navegador usa o próprio endereço do arquivo (veja run).
// Na produção os dois endereços são o mesmo e isso não acontece.
export async function prepare(db) {
  createJuliana(db);
  db.sql(`update storage.buckets set public = true where id = 'whatsapp-media';`);
}

export async function restore(db) {
  wipeJuliana(db);
  db.sql(`update storage.buckets set public = false where id = 'whatsapp-media';`);
}

/** Gera a imagem e o PDF de exemplo com o próprio navegador */
const makeFiles = async (page) => {
  mkdirSync(TMP, { recursive: true });
  const ctx = page.context().browser();
  const tmp = await ctx.newPage({ viewport: { width: 900, height: 560 } });
  await tmp.setContent(`
    <body style="margin:0;font-family:Inter,Arial,sans-serif;background:#f1f5f9">
      <div style="margin:32px;padding:28px 32px;background:#fff;border-radius:18px">
        <h1 style="margin:0 0 4px;color:#0A84FF">Tabela de planos</h1>
        <p style="margin:0 0 22px;color:#64748b">Empresa Teste · valores de exemplo</p>
        ${[["Mensal", "R$ 99/mês"], ["Semestral", "R$ 89/mês"], ["Anual", "R$ 79/mês"]]
          .map(([n, v]) => `<div style="display:flex;justify-content:space-between;padding:14px 0;border-top:1px solid #e2e8f0;font-size:22px"><b>${n}</b><span>${v}</span></div>`)
          .join("")}
      </div>
    </body>`);
  await tmp.screenshot({ path: IMAGE });
  await tmp.setContent(`
    <body style="font-family:Arial,sans-serif;padding:40px">
      <h1 style="color:#0A84FF">Proposta · Plano anual</h1>
      <p>Para: Juliana Costa</p>
      <p>Plano anual com suporte incluso: R$ 79 por mês (documento de exemplo).</p>
    </body>`);
  await tmp.pdf({ path: PDF, format: "A4" });
  await tmp.close();
};

/** Clica numa opção do menu do clipe e escolhe o arquivo */
const attach = async (page, d, option, file) => {
  await d.click(page.getByRole("button", { name: "Anexar" }).last(), { after: 900 });
  const chooser = page.waitForEvent("filechooser");
  await d.click(page.getByRole("button", { name: new RegExp(option) }).last(), { before: 700, after: 200 });
  await (await chooser).setFiles(file);
  await d.wait(1200);
};

export async function run(page, d) {
  await page.route("**/functions/v1/media-urls", async (route) => {
    const urls = route.request().postDataJSON()?.urls ?? [];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ urls: Object.fromEntries(urls.map((u) => [u, u])) }),
    });
  });
  await makeFiles(page);
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como enviar áudio, imagem e arquivo", "Tutorial Unxet · Atendimento no dia a dia", 3200);
  await page.getByText(/^Abertas/).first().waitFor();
  await opening;

  await openJuliana(page, d, { caption: { text: "Abra a conversa com o cliente", step: 1 } });
  const input = page.getByPlaceholder("Digite uma mensagem...").last();
  await input.waitFor();

  // 1. Imagem
  await d.caption("Clique no clipe: dá para mandar imagens, áudios e documentos", { step: 2, hold: 300 });
  await attach(page, d, "Imagens", IMAGE);
  await d.caption("Confira a prévia e, se quiser, escreva uma legenda", { step: 3, hold: 300 });
  await d.type(input, "Segue a nossa tabela de planos", { delay: 45 });
  await d.click(page.getByRole("button", { name: "Enviar" }).last(), { before: 700, after: 2400 });

  // 2. Documento
  await d.caption("Para PDF, planilha ou outro documento, use Documentos", { step: 4, hold: 300 });
  await attach(page, d, "Documentos", PDF);
  await d.click(page.getByRole("button", { name: "Enviar" }).last(), { before: 900, after: 2400 });
  await d.caption("Também dá para arrastar o arquivo direto para a conversa", { hold: 2200 });

  // 3. Áudio
  await d.caption("Com o campo vazio, o botão vira o microfone: toque para gravar um áudio", {
    step: 5,
    hold: 300,
  });
  await d.point(page.getByRole("button", { name: "Gravar áudio" }).last(), 2400);
  await d.caption("Toque de novo para enviar. O áudio chega no WhatsApp do cliente como mensagem de voz", {
    hold: 3000,
  });
  await d.hideCaption();

  await d.title("Pronto!", "Muito além do texto", 3000, { keep: true });
}
