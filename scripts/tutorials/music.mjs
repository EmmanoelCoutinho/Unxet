// Trilha de fundo padrão dos tutoriais, composta aqui mesmo (sem direitos
// autorais de terceiros). Sempre sai igual: mesma sequência de acordes,
// mesmo arpejo, e só a duração muda para acompanhar o vídeo.
//
// Estilo: piano elétrico suave em arpejo, acordes de fundo e baixo leve,
// em Dó maior, 88 BPM. Começa e termina com fade.

import { writeFileSync } from "node:fs";

const RATE = 44100;
const BPM = 88;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

// Cmaj7 · Am7 · Fmaj7 · G6sus (um compasso cada)
const CHORDS = [
  { root: 36, notes: [60, 64, 67, 71] },
  { root: 45, notes: [57, 60, 64, 67] },
  { root: 41, notes: [57, 60, 64, 65] },
  { root: 43, notes: [55, 59, 62, 64] },
];

// Ordem do arpejo em colcheias (índices das notas do acorde, +12 = oitava acima)
const ARP = [0, 2, 1, 3, 2 + 12, 3, 1, 2];

// Gerador pseudoaleatório com semente fixa (variação de dinâmica igual sempre)
const rng = (() => {
  let s = 20261103;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
})();

/** Piano elétrico por FM: brilho no ataque que some rápido */
function addEpiano(buf, start, hz, dur, amp, pan) {
  const i0 = Math.floor(start * RATE);
  const n = Math.floor((dur + 1.2) * RATE);
  const left = Math.cos(((pan + 1) * Math.PI) / 4);
  const right = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let k = 0; k < n && i0 + k < buf.L.length; k++) {
    const t = k / RATE;
    const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.9);
    const index = 1.6 * Math.exp(-t / 0.18);
    const v =
      amp * env * Math.sin(2 * Math.PI * hz * t + index * Math.sin(2 * Math.PI * hz * t));
    buf.L[i0 + k] += v * left;
    buf.R[i0 + k] += v * right;
  }
}

/** Acorde de fundo (pad): ataque lento, levemente desafinado entre L e R */
function addPad(buf, start, notes, dur, amp) {
  const i0 = Math.floor(start * RATE);
  const n = Math.floor((dur + 0.8) * RATE);
  for (let k = 0; k < n && i0 + k < buf.L.length; k++) {
    const t = k / RATE;
    const env =
      Math.min(1, t / 0.7) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.8) : 1);
    let l = 0;
    let r = 0;
    for (const m of notes) {
      const hz = midiToHz(m);
      l += Math.sin(2 * Math.PI * hz * 0.998 * t) + 0.25 * Math.sin(4 * Math.PI * hz * t);
      r += Math.sin(2 * Math.PI * hz * 1.002 * t) + 0.25 * Math.sin(4 * Math.PI * hz * t);
    }
    buf.L[i0 + k] += (amp * env * l) / notes.length;
    buf.R[i0 + k] += (amp * env * r) / notes.length;
  }
}

/** Baixo redondo */
function addBass(buf, start, hz, dur, amp) {
  const i0 = Math.floor(start * RATE);
  const n = Math.floor((dur + 0.15) * RATE);
  for (let k = 0; k < n && i0 + k < buf.L.length; k++) {
    const t = k / RATE;
    const env = Math.min(1, t / 0.02) * Math.exp(-t / 1.1) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.15) : 1);
    const v = amp * env * Math.tanh(1.4 * Math.sin(2 * Math.PI * hz * t));
    buf.L[i0 + k] += v;
    buf.R[i0 + k] += v;
  }
}

/** Eco suave (cruzado entre os lados) para dar espaço */
function addEcho(buf, delaySec, feedback, mix) {
  const d = Math.floor(delaySec * RATE);
  const L = Float32Array.from(buf.L);
  const R = Float32Array.from(buf.R);
  for (let i = d; i < L.length; i++) {
    L[i] += R[i - d] * feedback;
    R[i] += L[i - d] * feedback;
  }
  for (let i = 0; i < L.length; i++) {
    buf.L[i] = buf.L[i] * (1 - mix) + L[i] * mix;
    buf.R[i] = buf.R[i] * (1 - mix) + R[i] * mix;
  }
}

/** Gera a trilha com `seconds` de duração e grava um WAV estéreo 16 bits */
export function writeMusic(path, seconds) {
  const total = Math.ceil(seconds * RATE);
  const buf = { L: new Float32Array(total), R: new Float32Array(total) };
  const bars = Math.ceil(seconds / BAR) + 1;

  for (let b = 0; b < bars; b++) {
    const chord = CHORDS[b % CHORDS.length];
    const t0 = b * BAR;
    addPad(buf, t0, chord.notes.map((m) => m - 12), BAR, 0.11);
    addBass(buf, t0, midiToHz(chord.root), BEAT * 1.8, 0.16);
    addBass(buf, t0 + BEAT * 2, midiToHz(chord.root), BEAT * 1.6, 0.12);
    ARP.forEach((idx, i) => {
      const note = chord.notes[idx % 4] + (idx >= 12 ? 12 : 0);
      const accent = i % 4 === 0 ? 1 : 0.75;
      const amp = 0.085 * accent * (0.9 + 0.2 * rng());
      const pan = i % 2 === 0 ? -0.35 : 0.35;
      addEpiano(buf, t0 + (i * BEAT) / 2, midiToHz(note), BEAT / 2, amp, pan);
    });
  }

  addEcho(buf, BEAT * 0.75, 0.32, 0.3);

  // Fade de entrada e de saída, depois normaliza
  const fadeIn = 1.5 * RATE;
  const fadeOut = 2.5 * RATE;
  let peak = 0;
  for (let i = 0; i < total; i++) {
    const g = Math.min(1, i / fadeIn, (total - i) / fadeOut);
    buf.L[i] *= g;
    buf.R[i] *= g;
    peak = Math.max(peak, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  }
  const norm = peak > 0 ? 0.7 / peak : 1;

  const data = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf.L[i] * norm)) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf.R[i] * norm)) * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

// `node music.mjs 30` gera trilha-previa.wav para ouvir
if (process.argv[1]?.endsWith("music.mjs")) {
  const secs = Number(process.argv[2] ?? 30);
  writeMusic("trilha-previa.wav", secs);
  console.log(`trilha-previa.wav (${secs}s)`);
}
