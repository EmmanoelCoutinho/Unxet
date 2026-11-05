// Grava um tutorial da tela "Tutoriais" no ambiente LOCAL (banco do Docker).
//
// Uso (na pasta scripts/tutorials, depois de `npm install`):
//   node record.mjs criar-atendente --url http://localhost:5173
//
// - Entra com admin@teste.local (ou meta.login) usando LOCAL_TEST_PASSWORD (do .env.local
//   na raiz do projeto ou da variável de ambiente). Só o banco local.
// - O login acontece fora do vídeo; a gravação começa já dentro do sistema.
// - Junta a trilha padrão (music.mjs) e salva em public/tutorials/<id>.mp4
//   (H.264 + AAC, toca em qualquer navegador, inclusive no iPhone).
// - O roteiro pode exportar prepare()/restore() para arrumar o banco local
//   antes e desfazer depois (restore roda mesmo se a gravação falhar), e
//   pedir meta.mockEvolution para usar a Evolution de mentira.

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import ffmpeg from "ffmpeg-static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDirector } from "./director.mjs";
import { writeMusic } from "./music.mjs";
import { lit, sql } from "./db.mjs";
import { startMockEvolution } from "./mock-evolution.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const VIEWPORT = { width: 1280, height: 720 };

const args = process.argv.slice(2);
const scenarioId = args.find((a) => !a.startsWith("--"));
const urlFlag = args.indexOf("--url");
const baseURL = urlFlag >= 0 ? args[urlFlag + 1] : "http://localhost:5173";
const headed = args.includes("--headed");

if (!scenarioId) {
  console.error("Informe o tutorial: node record.mjs criar-atendente");
  process.exit(1);
}

const readPassword = () => {
  if (process.env.LOCAL_TEST_PASSWORD) return process.env.LOCAL_TEST_PASSWORD;
  const envFile = path.join(root, ".env.local");
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, "utf8").match(/^LOCAL_TEST_PASSWORD=(.*)$/m);
    if (match) return match[1].trim();
  }
  throw new Error("Defina LOCAL_TEST_PASSWORD (senha do admin@teste.local local)");
};

// Garante que não está apontando para develop/produção
const assertLocal = () => {
  const envFile = path.join(root, ".env.local");
  const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const url = env.match(/^VITE_SUPABASE_URL=(.*)$/m)?.[1] ?? "";
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    throw new Error("O .env.local precisa apontar para o Supabase local (127.0.0.1)");
  }
};

const cleanup = (emails) => {
  if (!emails?.length) return;
  sql(`delete from auth.users where email in (${emails.map(lit).join(",")});`);
};

const main = async () => {
  assertLocal();
  const scenario = await import(`./scenarios/${scenarioId}.mjs`);
  cleanup(scenario.meta.cleanupEmails);
  const db = { sql, lit };
  // mockEvolution: true (porta 8080) ou a lista de portas
  const mockPorts =
    scenario.meta.mockEvolution === true ? [8080] : scenario.meta.mockEvolution || [];
  const stops = [];
  for (const port of mockPorts) stops.push(await startMockEvolution(port));
  const stopMock = stops.length ? () => Promise.all(stops.map((stop) => stop())) : null;
  const state = scenario.prepare ? await scenario.prepare(db) : undefined;
  try {
    await record(scenario, db);
  } finally {
    if (scenario.restore) await scenario.restore(db, state);
    if (stopMock) await stopMock();
  }
};

const record = async (scenario, db) => {
  const browser = await chromium.launch({ headless: !headed });

  // Login fora do vídeo
  const loginContext = await browser.newContext({ baseURL, viewport: VIEWPORT });
  const loginPage = await loginContext.newPage();
  await loginPage.goto("/login");
  // Quem aparece no vídeo: admin (padrão) ou atendente (meta.login)
  await loginPage.locator('input[type="email"]').fill(scenario.meta.login ?? "admin@teste.local");
  await loginPage.locator('input[type="password"]').fill(readPassword());
  await loginPage.locator('button[type="submit"]').click();
  await loginPage.waitForURL(/\/inbox/, { timeout: 20000 });
  const storageState = await loginContext.storageState();
  await loginContext.close();

  const videoDir = path.join(here, ".videos");
  rmSync(videoDir, { recursive: true, force: true });
  const context = await browser.newContext({
    baseURL,
    viewport: VIEWPORT,
    storageState,
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  const page = await context.newPage();
  const startedAt = Date.now();
  const director = createDirector(page);
  await director.install();

  try {
    await scenario.run(page, director, db);
  } catch (err) {
    await page.screenshot({ path: path.join(here, "erro.png") }).catch(() => {});
    console.error("Falhou; a tela no momento do erro está em scripts/tutorials/erro.png");
    throw err;
  } finally {
    await context.close();
    await browser.close();
  }
  const seconds = (Date.now() - startedAt) / 1000;

  const recorded = await page.video().path();
  const outDir = path.join(root, "public", "tutorials");
  mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, `${scenario.meta.id}.mp4`);
  const music = path.join(videoDir, "trilha.wav");
  writeMusic(music, seconds);
  execFileSync(
    ffmpeg,
    [
      "-y", "-loglevel", "error",
      "-i", recorded,
      "-i", music,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-af", "volume=0.55",
      "-shortest", "-movflags", "+faststart",
      target,
    ],
    { stdio: "inherit" },
  );
  rmSync(videoDir, { recursive: true, force: true });
  cleanup(scenario.meta.cleanupEmails);
  console.log(`Vídeo salvo em ${path.relative(root, target)}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
