import defaultColors from "tailwindcss/colors";
import plugin from "tailwindcss/plugin";

// Modo escuro sem reescrever as telas: as classes de cor de sempre
// (bg-white, text-slate-700, border-gray-200, bg-blue-50...) apontam para
// variáveis CSS. No tema claro elas têm as cores originais do Tailwind; com a
// classe "dark" no <html> recebem a versão escura.
// Fundo, texto e borda mudam de jeitos diferentes: text-slate-900 vira quase
// branco, mas bg-slate-900 (botão escuro com texto branco) continua escuro.

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

const NEUTRALS = ["slate", "gray", "zinc", "neutral", "stone"];
const HUES = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];

// Fundo dos cartões (o antigo bg-white) no tema escuro
const DARK_SURFACE = "#151d2c";

const NEUTRAL_DARK = {
  // bordas, anéis, divisórias, ícones (fill/stroke), gradientes
  base: {
    50: "#111827", 100: "#1c2536", 200: "#273145", 300: "#364257", 400: "#56647b",
    500: "#7b889d", 600: "#a0acbe", 700: "#c3ccd8", 800: "#dde3eb", 900: "#eef2f6", 950: "#f8fafc",
  },
  bg: {
    50: "#0e1421", 100: "#1c2536", 200: "#273145", 300: "#364257", 400: "#4a576d",
    500: "#5f6c83", 600: "#4b586e", 700: "#3e4a5f", 800: "#344156", 900: "#2b374b", 950: "#202b3d",
  },
  // 50–200 são usados sobre fundos escuros, então continuam claros
  text: {
    50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#5d6a80", 400: "#7d8a9e",
    500: "#96a3b5", 600: "#acb7c6", 700: "#c9d2dd", 800: "#e1e7ee", 900: "#f1f5f9", 950: "#f8fafc",
  },
};

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function mix(hex, withHex, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(withHex);
  const out = a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount)));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Tons claros das cores viram tons escuros "tingidos" no tema escuro
function hueDark(name) {
  const c = defaultColors[name];
  const tint = (amount) => mix(c[500], DARK_SURFACE, amount);
  return {
    base: { ...c, 50: tint(0.14), 100: tint(0.22), 200: tint(0.32), 300: tint(0.45) },
    bg: { ...c, 50: tint(0.12), 100: tint(0.18), 200: tint(0.28), 300: tint(0.4) },
    text: { ...c, 500: c[400], 600: c[400], 700: c[300], 800: c[200], 900: c[200], 950: c[100] },
  };
}

const rgb = (hex) => hexToRgb(hex).join(" ");
const ref = (name) => `rgb(var(${name}) / <alpha-value>)`;

const light = {};
const dark = {};
const palettes = { base: {}, bg: {}, text: {} };

function addPalette(name, darkSets) {
  for (const kind of ["base", "bg", "text"]) {
    palettes[kind][name] = {};
    for (const shade of SHADES) {
      const varName = `--c-${kind}-${name}-${shade}`;
      light[varName] = rgb(defaultColors[name][shade]);
      dark[varName] = rgb(darkSets[kind][shade]);
      palettes[kind][name][shade] = ref(varName);
    }
  }
}

NEUTRALS.forEach((name) => addPalette(name, NEUTRAL_DARK));
HUES.forEach((name) => addPalette(name, hueDark(name)));

// bg-white é o fundo dos cartões; text-white continua branco
light["--c-bg-white"] = "255 255 255";
dark["--c-bg-white"] = rgb(DARK_SURFACE);

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: palettes.base,
      backgroundColor: { ...palettes.bg, white: ref("--c-bg-white") },
      textColor: palettes.text,
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ":root": light,
        ":root.dark": { ...dark, "color-scheme": "dark" },
      });
    }),
  ],
};
