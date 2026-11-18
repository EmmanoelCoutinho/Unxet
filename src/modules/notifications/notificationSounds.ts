const TRANSFER_SOUND_URL = "/sounds/transferencia.wav";
const MESSAGE_SOUND_URL = "/sounds/mensagem.wav";

// Tempo em que a aba que tocou segura a vez, para as outras abas não repetirem
const TRANSFER_LOCK_MS = 4000;
// Várias mensagens em sequência tocam uma vez só a cada intervalo
const MESSAGE_LOCK_MS = 1500;

const players = new Map<string, HTMLAudioElement>();

const play = (url: string) => {
  const audio = players.get(url) ?? new Audio(url);
  players.set(url, audio);
  audio.currentTime = 0;
  // O navegador bloqueia som antes do primeiro clique na página
  void audio.play().catch(() => undefined);
};

const playOnce = (url: string, lockName: string, holdMs: number) => {
  if (!navigator.locks) {
    play(url);
    return;
  }
  void navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    play(url);
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  });
};

/** Conversa transferida: toca uma vez por aviso, mesmo com várias abas abertas. */
export const playTransferSound = (notificationId: string) =>
  playOnce(TRANSFER_SOUND_URL, `unxet:transfer-sound:${notificationId}`, TRANSFER_LOCK_MS);

/** Mensagem nova de cliente: uma vez entre as abas e sem repetir em rajadas. */
export const playMessageSound = () =>
  playOnce(MESSAGE_SOUND_URL, "unxet:message-sound", MESSAGE_LOCK_MS);
