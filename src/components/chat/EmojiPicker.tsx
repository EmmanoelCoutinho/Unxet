import { useEffect, useMemo, useRef, useState } from "react";
import type { EmojiCategory, EmojiCategoryKey } from "../../constants/emojis";
import { EMOJI_CATEGORIES } from "../../constants/emojis";

type EmojiPickerProps = {
  open: boolean;
  disabled?: boolean;
  pickerRef?: React.RefObject<HTMLDivElement>;
  onPick: (emoji: string) => void;
};

// Termos de busca (pt/en) para os emojis mais usados em atendimento
const EMOJI_NAME_HINTS: Record<string, string[]> = {
  "😀": ["feliz", "sorriso", "alegre", "smile", "happy"],
  "😃": ["feliz", "sorriso", "alegre", "smile"],
  "😄": ["feliz", "sorriso", "risada", "smile"],
  "😁": ["sorriso", "dentes", "grin"],
  "😆": ["risada", "rindo", "haha"],
  "😅": ["alivio", "ufa", "suor", "nervoso"],
  "🤣": ["risada", "rolando", "kkk", "haha", "rofl"],
  "😂": ["risada", "haha", "rindo", "kkk", "laugh"],
  "🙂": ["sorriso", "ok", "simpatico"],
  "😉": ["piscadela", "piscar", "wink"],
  "😊": ["feliz", "timido", "sorriso", "blush"],
  "😇": ["anjo", "inocente", "angel"],
  "🥰": ["apaixonado", "amor", "carinho"],
  "😍": ["apaixonado", "amei", "olhos de coracao", "love"],
  "🤩": ["incrivel", "estrela", "uau", "wow"],
  "😘": ["beijo", "kiss"],
  "😋": ["delicia", "gostoso", "yum"],
  "😜": ["brincadeira", "lingua", "zoeira"],
  "🤗": ["abraco", "hug"],
  "🤭": ["ops", "risadinha"],
  "🤫": ["silencio", "segredo", "shh"],
  "🤔": ["pensando", "duvida", "hmm", "think"],
  "😐": ["neutro", "serio", "sem expressao"],
  "😏": ["malicioso", "sorriso de lado"],
  "😒": ["entediado", "chateado"],
  "🙄": ["revirar olhos", "aff", "tedio"],
  "😬": ["constrangido", "eita", "nervoso"],
  "😌": ["aliviado", "tranquilo", "calmo"],
  "😔": ["pensativo", "triste", "desanimado"],
  "😴": ["sono", "dormindo", "sleep"],
  "😷": ["doente", "mascara", "gripe", "sick"],
  "🤒": ["febre", "doente", "termometro"],
  "🤕": ["machucado", "ferido", "dor"],
  "🤢": ["enjoo", "nausea"],
  "🥳": ["festa", "comemorar", "parabens", "aniversario"],
  "😎": ["oculos", "estiloso", "cool"],
  "🤓": ["nerd", "estudioso"],
  "😕": ["confuso", "duvida"],
  "😟": ["preocupado", "worried"],
  "😮": ["surpreso", "uau", "wow"],
  "😲": ["chocado", "surpreso", "espanto"],
  "🥺": ["por favor", "pidao", "fofo"],
  "😢": ["triste", "choro", "lagrima", "sad", "cry"],
  "😭": ["chorando", "choro", "triste", "cry"],
  "😱": ["medo", "susto", "grito", "scream"],
  "😤": ["bravo", "irritado", "bufando"],
  "😡": ["raiva", "bravo", "angry"],
  "🤬": ["xingando", "raiva", "palavrao"],
  "👋": ["oi", "ola", "tchau", "acenar", "hi", "bye"],
  "👌": ["ok", "perfeito", "certo"],
  "✌️": ["paz", "vitoria", "peace"],
  "🤞": ["sorte", "dedos cruzados", "torcendo"],
  "👍": ["like", "ok", "boa", "joinha", "positivo", "thumb"],
  "👎": ["dislike", "negativo", "ruim"],
  "👏": ["palmas", "parabens", "aplausos", "clap"],
  "🙌": ["comemorar", "aleluia", "maos para cima"],
  "🤝": ["acordo", "aperto de mao", "parceria", "deal"],
  "🙏": ["obrigado", "por favor", "gratidao", "rezar", "pray"],
  "💪": ["forca", "forte", "musculo", "strong"],
  "👀": ["olhos", "olhando", "vendo"],
  "❤️": ["coracao", "amor", "love", "heart"],
  "🧡": ["coracao laranja", "amor"],
  "💛": ["coracao amarelo", "amor"],
  "💚": ["coracao verde", "amor"],
  "💙": ["coracao azul", "amor"],
  "💜": ["coracao roxo", "amor"],
  "🖤": ["coracao preto"],
  "💔": ["coracao partido", "triste", "broken"],
  "💯": ["cem", "perfeito", "100"],
  "✅": ["check", "feito", "confirmado", "ok", "certo"],
  "❌": ["erro", "cancelado", "nao", "x"],
  "⚠️": ["atencao", "aviso", "alerta", "warning"],
  "❓": ["pergunta", "duvida", "interrogacao"],
  "❗": ["exclamacao", "importante"],
  "⭐": ["estrela", "favorito", "star"],
  "✨": ["brilho", "novidade", "magica"],
  "🔥": ["fogo", "top", "hype", "fire"],
  "🎉": ["festa", "parabens", "comemorar", "party"],
  "🎁": ["presente", "gift"],
  "🎂": ["bolo", "aniversario", "birthday"],
  "📅": ["calendario", "agenda", "data", "agendamento"],
  "⏰": ["alarme", "horario", "despertador"],
  "⏳": ["aguarde", "espera", "ampulheta"],
  "📞": ["telefone", "ligacao", "ligar", "phone"],
  "📱": ["celular", "telefone", "whatsapp"],
  "💻": ["computador", "notebook"],
  "📧": ["email", "e-mail"],
  "📍": ["local", "endereco", "localizacao", "pin"],
  "📎": ["anexo", "clipe"],
  "📄": ["documento", "arquivo", "pagina"],
  "📝": ["anotacao", "formulario", "escrever", "nota"],
  "💰": ["dinheiro", "pagamento", "money"],
  "💳": ["cartao", "pagamento", "credito"],
  "🏥": ["hospital", "clinica", "saude"],
  "💊": ["remedio", "medicamento", "pilula"],
  "🩺": ["estetoscopio", "medico", "consulta"],
  "🦷": ["dente", "dentista"],
  "🚗": ["carro", "transporte"],
  "🏠": ["casa", "home"],
  "☀️": ["sol", "bom dia", "sun"],
  "🌙": ["lua", "boa noite", "moon"],
  "☕": ["cafe", "coffee"],
};

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

export function EmojiPicker({
  open,
  disabled,
  pickerRef,
  onPick,
}: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] =
    useState<EmojiCategoryKey>("face_and_people");

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Foca a busca ao abrir e limpa ao fechar
  useEffect(() => {
    if (open && !disabled) {
      inputRef.current?.focus();
    } else {
      setQuery("");
    }
  }, [open, disabled]);

  const q = normalize(query);

  const filteredCategories: EmojiCategory[] = useMemo(() => {
    if (!q) return EMOJI_CATEGORIES;

    return EMOJI_CATEGORIES.map((cat) => {
      const emojis = cat.emojis.filter((emoji) => {
        if (emoji === query.trim()) return true;

        const hints = EMOJI_NAME_HINTS[emoji] ?? [];
        const inHints = hints.some((h) => normalize(h).includes(q));

        const inCat = (cat.keywords ?? []).some((k) =>
          normalize(k).includes(q),
        );

        return inHints || inCat;
      });

      return { ...cat, emojis };
    }).filter((cat) => cat.emojis.length > 0);
  }, [q, query]);

  const activeCategoryData = useMemo(() => {
    const found =
      filteredCategories.find((c) => c.key === activeCat) ??
      filteredCategories[0];
    return found ?? null;
  }, [filteredCategories, activeCat]);

  if (!open || disabled) return null;

  return (
    <div
      ref={pickerRef as any}
      className="absolute bottom-full left-16 mb-2 w-[360px] max-h-[420px] overflow-hidden rounded-lg border border-[#E5E7EB] bg-white shadow-lg"
    >
      {/* Header: busca */}
      <div className="p-2 border-b border-[#E5E7EB]">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar emoji (ex: coração, risada, ok)…"
          className="w-full h-9 px-3 rounded-md border border-[#E5E7EB] outline-none focus:ring-2 focus:ring-black/10"
        />
      </div>

      {/* Tabs de categoria */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-[#E5E7EB] overflow-x-auto">
        {(q ? filteredCategories : EMOJI_CATEGORIES).map((cat) => {
          const isActive = activeCategoryData?.key === cat.key;
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveCat(cat.key)}
              className={[
                "shrink-0 px-2 py-1 rounded-md text-sm border transition-colors",
                isActive
                  ? "bg-blue-500 text-white border-blue-500"
                  : "bg-white text-[#111827] border-[#E5E7EB] hover:bg-[#F3F4F6]",
              ].join(" ")}
              title={cat.label}
            >
              <span className="mr-1">{cat.icon}</span>
              <span className="hidden sm:inline">{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Conteúdo */}
      <div className="max-h-[260px] overflow-y-auto overflow-x-hidden p-2 pb-8">
        {!activeCategoryData ? (
          <div className="text-sm text-[#6B7280] p-2">
            Nenhum emoji encontrado.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="text-sm font-medium text-[#111827]">
                {activeCategoryData.icon} {activeCategoryData.label}
              </div>
              <div className="text-xs text-[#6B7280]">
                {activeCategoryData.emojis.length} itens
              </div>
            </div>

            <div className="grid grid-cols-10 gap-2">
              {activeCategoryData.emojis.map((emoji) => (
                <button
                  key={`${activeCategoryData.key}-${emoji}`}
                  type="button"
                  onClick={() => onPick(emoji)}
                  className="text-xl hover:bg-[#E5E7EB] rounded-lg p-1 leading-none"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer (opcional): quando está buscando, mostrar “todas categorias” em lista */}
      {q && filteredCategories.length > 1 && (
        <div className="border-t border-[#E5E7EB] px-2 py-2 text-xs text-[#6B7280]">
          Mostrando resultados filtrados em {filteredCategories.length}{" "}
          categorias.
        </div>
      )}
    </div>
  );
}
