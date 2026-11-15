// Envia os vídeos gravados (scripts/tutorials/out/<id>.mp4) para o bucket
// público `tutorials` do Supabase Storage. Substitui o arquivo se já existir.
//
// Uso (na pasta scripts/tutorials):
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node upload.mjs criar-atendente
//   ... node upload.mjs --all          (todos os .mp4 de out/)
//
// Rode uma vez para o develop e outra para a produção.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");
const BUCKET = "tutorials";

const url = String(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const args = process.argv.slice(2);
const ids = args.includes("--all")
  ? readdirSync(outDir).filter((f) => f.endsWith(".mp4")).map((f) => f.slice(0, -4))
  : args;
if (ids.length === 0) {
  console.error("Informe os ids (ex.: node upload.mjs criar-atendente) ou --all.");
  process.exit(1);
}

let failed = 0;
for (const id of ids) {
  const file = path.join(outDir, `${id}.mp4`);
  if (!existsSync(file)) {
    console.error(`✗ ${id}: não achei ${path.relative(here, file)}`);
    failed++;
    continue;
  }
  const body = readFileSync(file);
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${id}.mp4`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "video/mp4",
      "x-upsert": "true",
      // Regravou? O navegador pega o novo em até 1 hora.
      "Cache-Control": "max-age=3600",
    },
    body,
  });
  if (res.ok) {
    console.log(`✓ ${id} (${(body.length / 1048576).toFixed(1)} MB)`);
  } else {
    console.error(`✗ ${id}: ${res.status} ${await res.text()}`);
    failed++;
  }
}
if (failed) process.exit(1);
