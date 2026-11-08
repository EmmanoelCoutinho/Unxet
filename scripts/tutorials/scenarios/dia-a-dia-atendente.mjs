// Tutorial: um atendimento do início ao fim, visto pela atendente
// (Mariana Souza, setor Recepção, na Empresa Teste).
//
// O roteiro cria uma cliente nova com uma conversa pendente, uma mensagem
// rápida e uma etiqueta, e apaga tudo no fim. O envio passa pela Evolution
// de mentira (porta 8787, a URL gravada no número da Empresa Teste).

const CLINIC = "00000000-0000-0000-0000-0000000000c1";
const RECEPCAO = "00000000-0000-0000-0000-0000000000d1";
const WHATSAPP = "00000000-0000-0000-0000-0000000000e1";
const CONTACT = "7a700000-0000-4000-8000-000000000001";
const CONVERSATION = "7a700000-0000-4000-8000-000000000002";
const QUICK = "7a700000-0000-4000-8000-000000000003";
const TAG = "7a700000-0000-4000-8000-000000000004";
const PHONE = "5511955550101";

const QUICK_TEXT =
  "Temos sim! O plano mensal sai por R$ 99 e já inclui suporte. Quer que eu envie os detalhes?";

export const meta = {
  id: "dia-a-dia-atendente",
  title: "Um atendimento do início ao fim",
  login: "mariana@teste.local",
  mockEvolution: [8787],
};

/** Apaga tudo que o roteiro cria (inclusive o que o sistema gera ao finalizar) */
const wipe = (db) =>
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
        execute format('delete from %s where %I = %L', r.tbl, r.col, '${CONVERSATION}');
      end loop;
    end $$;
    delete from conversations where id = '${CONVERSATION}';
    delete from contacts where id = '${CONTACT}';
    delete from quick_messages where id = '${QUICK}';
    delete from tags where id = '${TAG}';
  `);

export async function prepare(db) {
  wipe(db);
  db.sql(`
    insert into contacts (id, clinic_id, name, phone, first_seen_at, last_seen_at)
    values ('${CONTACT}', '${CLINIC}', 'Juliana Costa', '${PHONE}', now(), now());

    insert into conversations (
      id, clinic_id, contact_id, channel, status, department_id, channel_connection_id,
      last_message_at, first_inbound_at, last_inbound_at, first_unanswered_inbound_at,
      status_changed_at, in_bot_flow, created_at, updated_at)
    values ('${CONVERSATION}', '${CLINIC}', '${CONTACT}', 'whatsapp', 'pending', '${RECEPCAO}',
      '${WHATSAPP}', now(), now() - interval '50 seconds', now(), now() - interval '50 seconds',
      now(), false, now() - interval '50 seconds', now());

    insert into messages (conversation_id, direction, type, sender, text, payload, sent_at, created_at)
    values
      ('${CONVERSATION}', 'inbound', 'text', '${PHONE}', 'Oi, boa tarde!', '{}',
        now() - interval '50 seconds', now() - interval '50 seconds'),
      ('${CONVERSATION}', 'inbound', 'text', '${PHONE}',
        'Vocês têm plano mensal? Queria saber o valor 😊', '{}',
        now() - interval '30 seconds', now() - interval '30 seconds');

    insert into quick_messages (id, clinic_id, message, created_at, updated_at)
    values ('${QUICK}', '${CLINIC}', ${db.lit(QUICK_TEXT)}, now(), now());

    insert into tags (id, clinic_id, name, color, created_at)
    values ('${TAG}', '${CLINIC}', 'Orçamento', '#FF9500', now());
  `);
}

export async function restore(db) {
  wipe(db);
}

export async function run(page, d, db) {
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#__tut-title").waitFor({ state: "attached" });
  const opening = d.title(
    "Um atendimento do início ao fim",
    "Tutorial Unxet · Atendimento no dia a dia",
    3200,
  );
  const pendingTab = page.getByText(/^Pendentes/).first();
  await pendingTab.waitFor();
  await opening;

  // 1. Fila
  await d.caption("Clientes novos chegam na aba Pendentes", { step: 1, hold: 400 });
  await d.click(pendingTab, { after: 1200 });
  const item = page.getByText("Juliana Costa").first();
  await item.waitFor();
  await d.caption("Clique na conversa para ver o que o cliente escreveu", { step: 2, hold: 400 });
  await d.click(item, { after: 1600 });

  // 2. Aceitar
  const accept = page.getByRole("button", { name: "Aceitar" }).last();
  await accept.waitFor();
  await d.caption("Clique em Aceitar: a conversa passa a ser sua", { step: 3, hold: 500 });
  await d.click(accept, { before: 1200, after: 1600 });

  // 3. Responder com mensagem rápida
  const input = page.getByPlaceholder("Digite uma mensagem...").last();
  await input.waitFor();
  await d.caption("Digite / para usar uma mensagem rápida", { step: 4, hold: 300 });
  await d.type(input, "/plano", { delay: 140 });
  const option = page.getByRole("option").filter({ hasText: "plano mensal" }).first();
  await option.waitFor();
  await d.wait(600);
  await d.click(option, { before: 900, after: 900 });
  await d.caption("Confira o texto e aperte Enter para enviar", { step: 5, hold: 900 });
  await input.press("Enter");
  await page.getByText("Temos sim! O plano mensal").last().waitFor();
  await d.wait(1600);

  // A cliente responde (como chegaria pelo WhatsApp)
  db.sql(`
    insert into messages (conversation_id, direction, type, sender, text, payload, sent_at, created_at)
    values ('${CONVERSATION}', 'inbound', 'text', '${PHONE}', 'Pode mandar, sim! Obrigada 🙏', '{}', now(), now());
    update conversations set last_message_at = now(), last_inbound_at = now() where id = '${CONVERSATION}';
  `);
  await page.getByText("Pode mandar, sim!").last().waitFor({ timeout: 10000 });
  await d.caption("A resposta do cliente aparece na hora", { hold: 1800 });

  // 4. Etiqueta
  await d.caption("Marque a conversa com uma etiqueta para achar depois", { step: 6, hold: 400 });
  await d.click(page.getByRole("button", { name: "Mais ações" }).last(), { after: 700 });
  await d.click(page.getByRole("button", { name: /Gerenciar etiquetas/i }).last(), {
    after: 900,
  });
  await d.click(page.getByRole("button", { name: "Orçamento" }).last(), { after: 1300 });
  await d.click(page.getByRole("button", { name: "Fechar" }).last(), { after: 900 });

  // 5. Finalizar
  await d.caption("Terminou? Finalize a conversa", { step: 7, hold: 400 });
  await d.click(page.getByRole("button", { name: "Mais ações" }).last(), { after: 700 });
  await d.click(page.getByRole("button", { name: /Finalizar conversa/i }).last(), {
    after: 900,
  });
  await d.click(page.getByRole("button", { name: "Finalizar", exact: true }).last(), {
    after: 1800,
  });
  await d.caption("Se o cliente escrever de novo, a conversa volta para a fila", { hold: 2800 });
  await d.hideCaption();

  await d.title("Pronto!", "Esse é o caminho de cada atendimento", 3000, { keep: true });
}
