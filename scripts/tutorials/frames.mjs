// Prévia de um vídeo gravado: uma folha com quadros a cada N segundos
// (out/<id>-quadros.jpg), para revisar sem assistir o vídeo inteiro.
//   node frames.mjs banco-de-arquivos [segundos=4] [início=0]

import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [id, every = "4", start = "0"] = process.argv.slice(2);
if (!id) {
  console.error("Uso: node frames.mjs <id> [segundos] [início]");
  process.exit(1);
}
const input = path.join(here, "out", `${id}.mp4`);
const output = path.join(here, "out", `${id}-quadros-${start}.jpg`);
execFileSync(ffmpeg, [
  "-y", "-loglevel", "error", "-ss", start, "-i", input,
  "-vf", `fps=1/${every},scale=640:-1,tile=3x4:padding=6:color=white`,
  "-frames:v", "1", "-q:v", "4", output,
]);
console.log(output);
