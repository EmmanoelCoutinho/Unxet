// Fecha a próxima versão do sino de novidades.
//
// Move o que está em NEXT_RELEASE para uma entrada nova no topo de
// RELEASE_ENTRIES, com a data de hoje (horário de Brasília), e deixa
// NEXT_RELEASE vazia. O número da versão é calculado pelo app.
//
// Uso: npm run release            (correções sobem o patch, o resto o minor)
//      npm run release -- --major (versão grande)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(
  new URL("../src/modules/changelog/releases.ts", import.meta.url),
);
const major = process.argv.includes("--major");

let source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const nextPattern =
  /(export const NEXT_RELEASE: ReleaseChange\[\] = \[\n)([\s\S]*?)(\n?\];)/;
const match = source.match(nextPattern);
if (!match) {
  console.error("Não encontrei NEXT_RELEASE em releases.ts.");
  process.exit(1);
}

const items = match[2].replace(/^\s*\n/, "").replace(/\s+$/, "");
if (!items) {
  console.error("NEXT_RELEASE está vazia: não há nada para lançar.");
  process.exit(1);
}

const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
}).format(new Date());

// Os itens ficam 4 espaços mais para dentro dentro de `changes`
const indented = items
  .split("\n")
  .map((line) => (line.trim() ? `    ${line}` : line))
  .join("\n");

const entry = [
  "  {",
  `    date: "${date}",`,
  ...(major ? ["    major: true,"] : []),
  "    changes: [",
  indented,
  "    ],",
  "  },",
].join("\n");

const entriesHeader = "const RELEASE_ENTRIES: ReleaseEntry[] = [\n";
if (!source.includes(entriesHeader)) {
  console.error("Não encontrei RELEASE_ENTRIES em releases.ts.");
  process.exit(1);
}

source = source
  .replace(nextPattern, "$1];")
  .replace(entriesHeader, `${entriesHeader}${entry}\n`);

writeFileSync(file, source);
console.log(
  `Versão de ${date} fechada${major ? " (versão grande)" : ""}. ` +
    "Confira o número no sino e faça o commit de releases.ts.",
);
