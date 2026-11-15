// Tutorial: duas opções do número de QR Code, em Configurações > Integrações:
// "Receber mensagens de grupos" (cada grupo vira uma conversa, com o nome de
// quem escreveu) e "Mostrar mensagens enviadas pelo celular" (o que a equipe
// responde direto no celular aparece na conversa como "Pelo celular").
// O grupo e as mensagens são inseridos pelo roteiro, como o webhook faria;
// o envio para o grupo passa pela Evolution de mentira. Tudo é desfeito no fim.

import { CLINIC, ADMIN, RECEPCAO, CONVERSATION, PHONE, createJuliana, wipeJuliana } from "./_juliana.mjs";

const WHATSAPP = "00000000-0000-0000-0000-0000000000e1";
const GROUP = "7a700000-0000-4000-8000-000000000021";
const GROUP_CONVERSATION = "7a700000-0000-4000-8000-000000000022";
const GROUP_JID = "120363000000000021@g.us";

export const meta = {
  id: "grupos-e-celular",
  title: "Grupos e mensagens enviadas pelo celular",
  mockEvolution: [8787],
};

const wipeGroup = (db) =>
  db.sql(`
    do $$
    declare r record;
    begin
      for r in
        select c.conrelid::regclass as tbl, a.attname as col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.confrelid = 'public.conversations'::regclass
      loop
        execute format('delete from %s where %I = %L', r.tbl, r.col, '${GROUP_CONVERSATION}');
      end loop;
    end $$;
    delete from conversations where id = '${GROUP_CONVERSATION}';
    delete from whatsapp_groups where id = '${GROUP}';
  `);

export async function prepare(db) {
  const [flags] = db.sql(
    `select groups_enabled, phone_messages_enabled from channel_connections where id = '${WHATSAPP}';`,
  );
  db.sql(`update channel_connections set groups_enabled = false, phone_messages_enabled = false
          where id = '${WHATSAPP}';`);
  wipeGroup(db);
  createJuliana(db, { assignee: ADMIN });
  const [groups, phone] = (flags ?? "f|f").split("|");
  return { groups: groups === "t", phone: phone === "t" };
}

export async function restore(db, state) {
  wipeGroup(db);
  wipeJuliana(db);
  db.sql(`update channel_connections
             set groups_enabled = ${state?.groups ? "true" : "false"},
                 phone_messages_enabled = ${state?.phone ? "true" : "false"}
           where id = '${WHATSAPP}';`);
}

/** Chega uma mensagem num grupo (como o webhook faria com a opção ligada) */
const groupMessages = (db) =>
  db.sql(`
    insert into whatsapp_groups (id, clinic_id, channel_connection_id, jid, name)
    values ('${GROUP}', '${CLINIC}', '${WHATSAPP}', '${GROUP_JID}', 'Clientes VIP');

    insert into conversations (
      id, clinic_id, contact_id, group_id, channel, status, department_id, channel_connection_id,
      last_message_at, first_inbound_at, last_inbound_at, first_unanswered_inbound_at,
      status_changed_at, in_bot_flow, created_at, updated_at)
    values ('${GROUP_CONVERSATION}', '${CLINIC}', null, '${GROUP}', 'whatsapp', 'pending',
      '${RECEPCAO}', '${WHATSAPP}', now(), now() - interval '40 seconds', now(),
      now() - interval '40 seconds', now(), false, now() - interval '40 seconds', now());

    insert into messages (conversation_id, direction, type, sender, sender_name, text, payload, sent_at, created_at)
    values
      ('${GROUP_CONVERSATION}', 'inbound', 'text', '5511955550301', 'Marcos Lima',
        'Bom dia! A loja abre no feriado?', '{}', now() - interval '40 seconds', now() - interval '40 seconds'),
      ('${GROUP_CONVERSATION}', 'inbound', 'text', '5511955550302', 'Paula Rocha',
        'Também queria saber 🙂', '{}', now(), now());
  `);

/** A equipe responde a Juliana direto no celular */
const phoneMessage = (db) =>
  db.sql(`
    insert into messages (conversation_id, direction, type, sender, receiver, sender_name, text, payload,
                          is_automated, sent_at, created_at)
    values ('${CONVERSATION}', 'outbound', 'text', 'clinic_tutorial', '${PHONE}', 'Pelo celular',
      'Juliana, acabei de te mandar o boleto por e-mail 😉', '{}', false, now(), now());
    update conversations set last_message_at = now(), last_outbound_at = now() where id = '${CONVERSATION}';
  `);

export async function run(page, d, db) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title(
    "Grupos e mensagens enviadas pelo celular",
    "Tutorial Unxet · Primeiros passos",
    3200,
  );
  const settingsItem = page.getByRole("button", { name: "Configurações" }).first();
  await settingsItem.waitFor();
  await opening;

  // 1. Integrações
  await d.caption("Abra Configurações e a aba Integrações", { step: 1, hold: 600, top: true });
  await d.click(settingsItem, { before: 1500, after: 1200 });
  await d.click(page.getByRole("link", { name: "Integrações" }).or(page.getByRole("tab", { name: "Integrações" })).or(page.getByRole("button", { name: "Integrações", exact: true })).first(), { after: 1600 });
  await page.mouse.move(900, 380, { steps: 20 });

  // 2. Grupos
  const groups = page.getByRole("switch", { name: "Receber mensagens de grupos" }).first();
  await groups.waitFor();
  await groups.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(900);
  await d.caption("No número de QR Code, ligue Receber mensagens de grupos", { step: 2, hold: 300, top: true });
  await d.click(groups, { before: 900, after: 1400 });
  await d.caption("Cada grupo vira uma conversa. Bot, IA e pesquisa não atuam em grupos", { hold: 3000, top: true });

  // 3. Celular
  const phone = page.getByRole("switch", { name: "Mostrar mensagens enviadas pelo celular" }).first();
  await phone.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await d.wait(900);
  await d.caption("Ligue também Mostrar mensagens enviadas pelo celular", { step: 3, hold: 300, top: true });
  await d.click(phone, { before: 900, after: 1400 });
  await d.caption("O que a equipe responder no celular ou no WhatsApp Web aparece na conversa", { hold: 3000, top: true });
  await d.hideCaption();

  // 4. Conversa do grupo
  groupMessages(db);
  const pendingTab = page.getByText(/^Pendentes/).first();
  await d.caption("Quando alguém escreve no grupo, a conversa chega em Pendentes", { step: 4, hold: 300 });
  await d.click(pendingTab, { after: 1200 });
  const item = page.getByText("Clientes VIP", { exact: true }).first();
  await item.waitFor({ timeout: 15000 });
  await d.click(item, { after: 1400 });
  await d.click(page.getByRole("button", { name: "Abrir em tela cheia" }).last(), { after: 1400 });
  await d.caption("Cada mensagem mostra o nome de quem escreveu", { hold: 2800, top: true });

  await d.caption("Aceite e responda: a mensagem vai para o grupo", { step: 5, hold: 300, top: true });
  await d.click(page.getByRole("button", { name: "Aceitar conversa" }).last(), { before: 900, after: 1600 });
  const input = page.getByPlaceholder("Digite uma mensagem...").last();
  await d.type(input, "Bom dia! No feriado abrimos das 9h às 13h.", { delay: 45 });
  await input.press("Enter");
  await page.getByText("No feriado abrimos").last().waitFor({ timeout: 10000 });
  await d.wait(1800);

  // 5. Mensagem do celular
  await d.caption("E as mensagens enviadas pelo celular?", { step: 6, hold: 300, top: true });
  await d.click(page.getByRole("button", { name: "Voltar para conversas" }).last(), { after: 1000 }).catch(() => {});
  await d.click(page.getByText(/^Abertas/).first(), { after: 1000 });
  const juliana = page.getByText("Juliana Costa", { exact: true }).first();
  await juliana.waitFor();
  await d.click(juliana, { after: 1400 });
  const full = page.getByRole("button", { name: "Abrir em tela cheia" });
  if (await full.count()) await d.click(full.last(), { after: 1400 });
  phoneMessage(db);
  await page.getByText("acabei de te mandar o boleto").last().waitFor({ timeout: 10000 });
  await d.wait(800);
  await d.caption("A resposta dada no celular aparece aqui, marcada como Pelo celular", { hold: 3200, top: true });
  await d.caption("Assim a equipe vê o histórico completo, sem perguntar de novo ao cliente", { hold: 2800, top: true });
  await d.hideCaption();

  await d.title("Pronto!", "Grupos e celular, tudo na mesma tela", 3000, { keep: true });
}
