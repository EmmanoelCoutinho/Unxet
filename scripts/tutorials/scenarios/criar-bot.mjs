// Tutorial: criar um bot com menu. O bot do vídeo nasce desligado e é
// apagado no fim; o bot que já atende a Empresa Teste (Triagem) não é tocado.

const CLINIC = "00000000-0000-0000-0000-0000000000c1";
const NAME = "Menu de atendimento";

export const meta = {
  id: "criar-bot",
  title: "Como criar um bot com menu",
};

const wipe = (db) =>
  db.sql(`
    do $$
    declare r record; b record;
    begin
      for b in select id from bots where clinic_id = '${CLINIC}' and name = ${db.lit(NAME)} loop
        for r in
          select k.conrelid::regclass as tbl, a.attname as col
          from pg_constraint k
          join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
          where k.contype = 'f' and k.confrelid = 'public.bots'::regclass
        loop
          execute format('delete from %s where %I = %L', r.tbl, r.col, b.id);
        end loop;
        delete from bots where id = b.id;
      end loop;
    end $$;
  `);

export async function prepare(db) {
  wipe(db);
}

export async function restore(db) {
  wipe(db);
}

/** O campo logo depois de um rótulo (o componente não liga rótulo e campo) */
const fieldAfter = (page, label, tag = "input") =>
  page.locator(`xpath=//label[normalize-space()='${label}']/following::${tag}[1]`);

/** Adiciona um botão ao menu com o que acontece ao tocar */
const addButton = async (page, d, text, action, detail) => {
  await d.click(page.getByRole("button", { name: "Adicionar botão" }).last(), { after: 700 });
  const label = page.getByPlaceholder("Ex.: Agendar horário").last();
  await d.type(label, text, { delay: 40 });
  await d.click(page.getByRole("button", { name: action, exact: true }).last(), { before: 500, after: 700 });
  if (action === "Responder") {
    const reply = page.getByPlaceholder("Ex.: Atendemos de segunda a sexta, das 8h às 18h.").last();
    await d.type(reply, detail, { delay: 18 });
  } else if (action === "Atendente") {
    const dept = page.locator("select").filter({ hasText: "Qualquer atendente disponível" }).last();
    await d.select(dept, detail, { after: 500 });
  }
  await d.click(page.getByRole("button", { name: "Pronto" }).last(), { before: 300, after: 600 });
};

export async function run(page, d) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title("Como criar um bot com menu", "Tutorial Unxet · Automação", 3200);
  const menuItem = page.getByRole("button", { name: "Bots" }).first();
  await menuItem.waitFor();
  await opening;

  // 1. Abrir
  await d.caption("No menu lateral, abra Bots", { step: 1, hold: 500 });
  await page.mouse.move(32, 300, { steps: 18 });
  await d.wait(450);
  await d.click(menuItem, { before: 1200, after: 1200 });
  await page.mouse.move(900, 420, { steps: 20 });
  await d.caption("O bot responde na hora e manda cada cliente para o lugar certo", { hold: 2000 });

  // 2. Criar
  await d.caption("Clique em Novo bot", { step: 2, hold: 300 });
  await d.click(page.getByRole("button", { name: "Novo bot" }).first(), { after: 1200 });
  await d.caption("Dê um nome e escreva a mensagem de boas-vindas", { step: 3, hold: 300 });
  await d.type(fieldAfter(page, "Nome"), NAME, { delay: 70 });
  const welcome = page.getByPlaceholder("Ex: Olá! Bem-vindo. Escolha uma opção:");
  await welcome.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(500);
  await d.type(welcome, "Olá! Que bom falar com você. Escolha uma opção:", { delay: 22 });
  await d.caption("E o que o bot diz quando o cliente responde algo fora do menu", { hold: 300 });
  await d.type(
    page.getByPlaceholder("Ex: Não entendi. Responda com o número de uma opção."),
    "Não entendi. Toque em uma opção ou digite o número.",
    { delay: 18 },
  );
  await d.caption("Clique em Criar bot", { hold: 300 });
  await d.click(page.getByRole("button", { name: "Criar bot" }).first(), { before: 700, after: 1800 });

  // 3. Menu
  await d.caption("Em Fluxo da conversa, monte o menu", { step: 4, hold: 300 });
  await d.click(page.getByRole("button", { name: "Fluxo da conversa" }).first(), { after: 1200 });
  await d.caption("Cada botão é uma opção. Este responde sozinho", { step: 5, hold: 300 });
  await addButton(page, d, "Horário de funcionamento", "Responder", "Atendemos de segunda a sexta, das 8h às 18h.");
  await d.caption("Este passa o cliente para o Financeiro", { step: 6, hold: 300 });
  await addButton(page, d, "Segunda via de boleto", "Atendente", "Financeiro");
  await d.caption("E este, para a Recepção", { hold: 300 });
  await addButton(page, d, "Falar com a recepção", "Atendente", "Recepção");
  await d.caption("Clique em Salvar", { step: 7, hold: 300 });
  const save = page.getByRole("button", { name: "Salvar", exact: true }).first();
  await save.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(500);
  await d.click(save, { before: 700, after: 1600 });

  // 4. Testar na prévia
  const preview = page.getByText("Como o cliente vê", { exact: true }).first();
  await preview.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
  await d.wait(900);
  await d.caption("Teste do jeito que o cliente vê: toque em uma opção", { step: 8, hold: 600 });
  await d.click(page.getByRole("button", { name: "Horário de funcionamento" }).last(), { before: 900, after: 2400 });

  // 5. Canais
  await d.caption("Para colocar no ar, ligue o bot ao número na aba Canais", { step: 9, hold: 300 });
  const tab = page.getByRole("button", { name: "Canais", exact: true }).first();
  await tab.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(500);
  await d.click(tab, { after: 1400 });
  const whatsapp = page.getByText("WhatsApp · QR Code").first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await d.point(whatsapp, 2400);
  await d.caption("Cada número atende com um bot por vez. Depois, deixe o bot como Ativo em Geral", {
    hold: 3000,
  });
  await d.hideCaption();

  await d.title("Pronto!", "Seu bot atende na hora, a qualquer hora", 3000, { keep: true });
}
