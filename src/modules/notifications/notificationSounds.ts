const TRANSFER_SOUND_URL = "/sounds/transferencia.wav";
const MESSAGE_SOUND_URL = "/sounds/mensagem.wav";

// Tempo em que a aba que tocou segura a vez, para as outras abas não repetirem
const TRANSFER_LOCK_MS = 4000;
// Várias mensagens em sequência tocam uma vez só a cada intervalo
const MESSAGE_LOCK_MS = 1500;

// A escolha fica salva neste aparelho; sem nada salvo, os sons ficam ligados
const SOUNDS_STORAGE_KEY = "unxet-notification-sounds";

export const readSoundsEnabled = () => {
  try {
    return localStorage.getItem(SOUNDS_STORAGE_KEY) !== "off";
  } catch {
    // navegação privada ou armazenamento bloqueado
    return true;
  }
};

export const saveSoundsEnabled = (enabled: boolean) => {
  try {
    if (enabled) localStorage.removeItem(SOUNDS_STORAGE_KEY);
    else localStorage.setItem(SOUNDS_STORAGE_KEY, "off");
  } catch {
    // navegação privada ou armazenamento bloqueado
  }
};

const players = new Map<string, HTMLAudioElement>();

const play = (url: string) => {
  const audio = players.get(url) ?? new Audio(url);
  players.set(url, audio);
  audio.currentTime = 0;
  // O navegador bloqueia som antes do primeiro clique na página
  void audio.play().catch(() => undefined);
};

const playOnce = (
  sound: string | (() => void),
  lockName: string,
  holdMs: number,
) => {
  // Lido a cada som para a escolha valer na hora em todas as abas
  if (!readSoundsEnabled()) return;
  const run = typeof sound === "string" ? () => play(sound) : sound;
  if (!navigator.locks) {
    run();
    return;
  }
  void navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    run();
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  });
};

/** Conversa transferida: toca uma vez por aviso, mesmo com várias abas abertas. */
export const playTransferSound = (notificationId: string) =>
  playOnce(TRANSFER_SOUND_URL, `unxet:transfer-sound:${notificationId}`, TRANSFER_LOCK_MS);

/** Mensagem nova de cliente: uma vez entre as abas e sem repetir em rajadas. */
export const playMessageSound = () =>
  playOnce(MESSAGE_SOUND_URL, "unxet:message-sound", MESSAGE_LOCK_MS);

// Chat interno: som próprio (duas notas curtas), diferente do de cliente, e
// que pode ser silenciado à parte na janela do chat
const INTERNAL_SOUND_STORAGE_KEY = "unxet-internal-chat-sound";
const INTERNAL_LOCK_MS = 1500;

export const readInternalChatSoundEnabled = () => {
  try {
    return localStorage.getItem(INTERNAL_SOUND_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
};

export const saveInternalChatSoundEnabled = (enabled: boolean) => {
  try {
    if (enabled) localStorage.removeItem(INTERNAL_SOUND_STORAGE_KEY);
    else localStorage.setItem(INTERNAL_SOUND_STORAGE_KEY, "off");
  } catch {
    // navegação privada ou armazenamento bloqueado
  }
};

let audioContext: AudioContext | null = null;

const playChime = () => {
  try {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Context) return;
    audioContext ??= new Context();
    const ctx = audioContext;
    // O navegador deixa o áudio suspenso até o primeiro clique na página
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);

    const start = ctx.currentTime + 0.01;
    [
      { freq: 880, at: 0 },
      { freq: 1318.5, at: 0.11 },
    ].forEach(({ freq, at }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start + at);
      gain.gain.linearRampToValueAtTime(0.18, start + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + at);
      osc.stop(start + at + 0.25);
    });
  } catch {
    // sem Web Audio: fica só o aviso visual
  }
};

/** Mensagem nova no chat interno: uma vez entre as abas e sem repetir em rajadas. */
export const playInternalChatSound = () => {
  if (!readInternalChatSoundEnabled()) return;
  playOnce(playChime, "unxet:internal-chat-sound", INTERNAL_LOCK_MS);
};
