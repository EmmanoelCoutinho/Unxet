// Envia os vídeos gravados (scripts/tutorials/out/<id>.mp4) para o bucket
// público `tutorials` do Supabase Storage. Substitui o arquivo se já existir.
//
// Uso (de qualquer pasta; funciona no PowerShell e no bash):
//   node scripts/tutorials/upload.mjs --project <ref> criar-atendente
//   node scripts/tutorials/upload.mjs --project <ref> --all   (todos os .mp4 de out/)
//
// --project busca a service role pelo CLI do Supabase (precisa do login do
// CLI) e cria o bucket se ele ainda não existir. Sem --project, usa as
// variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
//
// Rode uma vez para o develop (ketolvqnptmdczkzrqba) e outra para a
// produção (karmtrldanuxqisgzlhk).

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const outDir = path.join(here, "out");
const BUCKET = "tutorials";

const args = process.argv.slice(2);
const projectAt = args.indexOf("--project");
const project = projectAt >= 0 ? args[projectAt + 1] : undefined;
if (projectAt >= 0) args.splice(projectAt, 2);

let url = String(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (project) {
  url = `https://${project}.supabase.co`;
  const cli = path.join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "supabase.cmd" : "supabase",
  );
  const keys = JSON.parse(
    execSync(`"${cli}" projects api-keys --project-ref ${project} -o json`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  key = keys.find((k) => k.name === "service_role")?.api_key;
}
if (!url || !key) {
  console.error("Use --project <ref> ou defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const auth = { Authorization: `Bearer ${key}`, apikey: key };

// Cria o bucket se faltar (a migration 20261124000000 faz o mesmo no deploy)
const bucket = await fetch(`${url}/storage/v1/bucket/${BUCKET}`, { headers: auth });
if (!bucket.ok) {
  const created = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: 50 * 1024 * 1024,
      allowed_mime_types: ["video/mp4"],
    }),
  });
  if (!created.ok) {
    console.error(`Não consegui criar o bucket: ${created.status} ${await created.text()}`);
    process.exit(1);
  }
  console.log(`Bucket ${BUCKET} criado.`);
}

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
      ...auth,
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
