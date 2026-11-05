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
