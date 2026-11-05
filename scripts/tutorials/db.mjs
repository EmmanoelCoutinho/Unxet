// SQL no banco LOCAL do Docker (só para preparar e desfazer o cenário de
// um tutorial). Nunca aponta para develop ou produção.

import { execFileSync } from "node:child_process";

const DB_CONTAINER = "supabase_db_mensageria_service_ia";

/** Roda o SQL e devolve as linhas (colunas separadas por "|") */
export function sql(query) {
  const out = execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-q", "-At", "-v", "ON_ERROR_STOP=1"],
    { input: query, stdio: ["pipe", "pipe", "pipe"] },
  ).toString();
  return out.split("\n").filter(Boolean);
}

/** Texto como literal SQL */
export const lit = (value) =>
  value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;

// Tabelas de atividade e as colunas de data de cada uma (dados de demonstração)
const ACTIVITY = {
  conversations: { by: "clinic", cols: ["auto_closed_at", "closed_at", "created_at", "first_inbound_at", "first_outbound_at", "first_unanswered_inbound_at", "last_inbound_at", "last_message_at", "last_outbound_at", "pending_returned_at", "sla_breached_at", "status_changed_at", "updated_at"] },
  messages: { by: "conversation", cols: ["created_at", "deleted_at", "delivered_at", "read_at", "sent_at"] },
  conversation_events: { by: "conversation", cols: ["created_at"] },
  conversation_reads: { by: "clinic", cols: ["last_read_at", "updated_at"] },
  satisfaction_surveys: { by: "clinic", cols: ["answered_at", "created_at", "expires_at", "sent_at"] },
};

const moveActivity = (clinicId, days) => {
  const tables = Object.keys(ACTIVITY);
  const updates = Object.entries(ACTIVITY)
    .map(([table, { by, cols }]) => {
      const set = cols.map((c) => `${c} = ${c} + interval '${days} days'`).join(", ");
      const where =
        by === "clinic"
          ? `clinic_id = ${lit(clinicId)}`
          : `conversation_id in (select id from conversations where clinic_id = ${lit(clinicId)})`;
      return `update ${table} set ${set} where ${where};`;
    })
    .join("\n");
  sql(`begin;
${tables.map((t) => `alter table ${t} disable trigger user;`).join("\n")}
${updates}
${tables.map((t) => `alter table ${t} enable trigger user;`).join("\n")}
commit;`);
};

/**
 * Adianta em dias inteiros as datas da atividade de demonstração da empresa,
 * para a conversa mais recente cair hoje (Painel e Relatórios cheios).
 * Devolve quantos dias andou; desfaça com restoreActivity.
 */
export function bringActivityToToday(clinicId) {
  const [days] = sql(
    // Diferença de calendário no horário de Brasília (o "hoje" do Painel);
    // um dia a menos se a hora cairia no futuro
    `with x as (
       select max(last_message_at) as last,
              ((now() at time zone 'America/Sao_Paulo')::date
                - (max(last_message_at) at time zone 'America/Sao_Paulo')::date) as diff
       from conversations where clinic_id = ${lit(clinicId)})
     select greatest(0, diff - case when last + diff * interval '1 day' > now() then 1 else 0 end) from x;`,
  );
  const n = Number(days) || 0;
  if (n > 0) moveActivity(clinicId, n);
  return n;
}

export function restoreActivity(clinicId, days) {
  if (days > 0) moveActivity(clinicId, -days);
}
