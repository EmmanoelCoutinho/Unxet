// Conversa de exemplo usada pelos tutoriais de atendimento: a cliente
// Juliana Costa, já em atendimento com a Mariana Souza (Recepção), pedindo a
// segunda via do boleto. Tudo é apagado no fim (wipeJuliana).

export const CLINIC = "00000000-0000-0000-0000-0000000000c1";
export const RECEPCAO = "00000000-0000-0000-0000-0000000000d1";
export const FINANCEIRO = "00000000-0000-0000-0000-0000000000d2";
export const MARIANA = "00000000-0000-0000-0000-0000000000a4";
export const CARLOS = "00000000-0000-0000-0000-0000000000a5";
export const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const WHATSAPP = "00000000-0000-0000-0000-0000000000e1";
export const CONTACT = "7a700000-0000-4000-8000-000000000011";
export const CONVERSATION = "7a700000-0000-4000-8000-000000000012";
export const PHONE = "5511955550102";

/** Apaga a conversa (e tudo que aponta para ela) e a cliente */
export const wipeJuliana = (db) =>
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
  `);

/** Cria a conversa já aberta (com a Mariana, ou com quem for passado) */
export const createJuliana = (db, { assignee = MARIANA } = {}) => {
  wipeJuliana(db);
  db.sql(`
    insert into contacts (id, clinic_id, name, phone, first_seen_at, last_seen_at)
    values ('${CONTACT}', '${CLINIC}', 'Juliana Costa', '${PHONE}', now(), now());

    insert into conversations (
      id, clinic_id, contact_id, channel, status, department_id, channel_connection_id,
      assigned_user_id, last_message_at, first_inbound_at, last_inbound_at, first_outbound_at,
      last_outbound_at, status_changed_at, in_bot_flow, created_at, updated_at)
    values ('${CONVERSATION}', '${CLINIC}', '${CONTACT}', 'whatsapp', 'open', '${RECEPCAO}',
      '${WHATSAPP}', '${assignee}', now(), now() - interval '4 minutes', now(),
      now() - interval '3 minutes', now() - interval '3 minutes', now() - interval '3 minutes',
      false, now() - interval '4 minutes', now());

    insert into messages (conversation_id, direction, type, sender, text, payload, sent_at, created_at)
    values
      ('${CONVERSATION}', 'inbound', 'text', '${PHONE}', 'Oi, boa tarde!', '{}',
        now() - interval '4 minutes', now() - interval '4 minutes'),
      ('${CONVERSATION}', 'outbound', 'text', null, 'Oi, Juliana! Tudo bem? Como posso ajudar?', '{}',
        now() - interval '3 minutes', now() - interval '3 minutes'),
      ('${CONVERSATION}', 'inbound', 'text', '${PHONE}',
        'Preciso da segunda via do boleto deste mês, por favor.', '{}', now(), now());
  `);
};

/** Abre a conversa da Juliana pela aba Abertas (visão da atendente) */
export const openJuliana = async (page, d, { caption } = {}) => {
  const openTab = page.getByText(/^Abertas/).first();
  await openTab.waitFor();
  if (caption) await d.caption(caption.text, { step: caption.step, hold: 300 });
  await d.click(openTab, { after: 900 });
  const item = page.getByText("Juliana Costa", { exact: true }).first();
  await item.waitFor();
  await d.click(item, { after: 1400 });
};
