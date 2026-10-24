import React, { useEffect, useRef, useState } from "react";
import { DownloadIcon, PauseIcon, PlayIcon } from "lucide-react";

// Só um áudio toca por vez: dar play em outro pausa o anterior
let playingAudio: HTMLAudioElement | null = null;

const SPEEDS = [1, 1.5, 2] as const;

const formatClock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

type AudioPlayerProps = {
  src: string;
  /** Mensagem enviada pela empresa (balão azul) ou recebida do cliente. */
  outgoing: boolean;
};

/** Player de áudio das mensagens, no lugar do player padrão do navegador. */
export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, outgoing }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const readDuration = () => {
      if (Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
        return;
      }
      // Áudio gravado no navegador (webm/ogg) chega sem duração: pular para o
      // fim força o navegador a calculá-la, depois volta para o início
      if (audio.duration === Infinity) {
        const restore = () => {
          audio.removeEventListener("durationchange", restore);
          audio.currentTime = 0;
          if (Number.isFinite(audio.duration)) setDuration(audio.duration);
        };
        audio.addEventListener("durationchange", restore);
        audio.currentTime = 1e101;
      }
    };
    const onTime = () => setCurrent(audio.currentTime);
    const onPlay = () => {
      if (playingAudio && playingAudio !== audio) playingAudio.pause();
      playingAudio = audio;
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
      audio.currentTime = 0;
    };
    const onError = () => setFailed(true);

    audio.addEventListener("loadedmetadata", readDuration);
    audio.addEventListener("durationchange", readDuration);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("loadedmetadata", readDuration);
      audio.removeEventListener("durationchange", readDuration);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      if (playingAudio === audio) playingAudio = null;
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setFailed(true));
    } else {
      audio.pause();
    }
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = value;
    setCurrent(value);
  };

  const cycleSpeed = () => {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  };

  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;
  // Parado no início mostra a duração; tocando, o tempo decorrido
  const clock = playing || current > 0 ? formatClock(current) : formatClock(duration);

  const tone = outgoing
    ? {
        box: "bg-[#0A84FF] text-white",
        play: "bg-white text-[#0A84FF] hover:bg-blue-50",
        track: "bg-white/30",
        fill: "bg-white",
        thumb: "[&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:bg-white",
        muted: "text-blue-100",
        chip: "bg-white/20 text-white hover:bg-white/30",
      }
    : {
        box: "bg-[#F3F4F6] text-[#1E1E1E] border border-[#E5E7EB]",
        play: "bg-[#0A84FF] text-white hover:bg-[#0066d6]",
        track: "bg-[#D1D5DB]",
        fill: "bg-[#0A84FF]",
        thumb:
          "[&::-webkit-slider-thumb]:bg-[#0A84FF] [&::-moz-range-thumb]:bg-[#0A84FF]",
        muted: "text-[#6B7280]",
        chip: "bg-white text-[#374151] hover:bg-[#E5E7EB] border border-[#E5E7EB]",
      };

  return (
    <div
      className={`flex w-64 max-w-full items-center gap-2.5 rounded-2xl py-2 pl-2 pr-3 ${tone.box}`}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        type="button"
        onClick={togglePlay}
        disabled={failed}
        aria-label={playing ? "Pausar áudio" : "Ouvir áudio"}
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full shadow-sm transition-colors disabled:opacity-50 ${tone.play}`}
      >
        {playing ? (
          <PauseIcon className="h-4 w-4" fill="currentColor" />
        ) : (
          <PlayIcon className="ml-0.5 h-4 w-4" fill="currentColor" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="relative flex h-4 items-center">
          <div className={`absolute inset-x-0 h-1 rounded-full ${tone.track}`} />
          <div
            className={`absolute left-0 h-1 rounded-full ${tone.fill}`}
            style={{ width: `${progress}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={Math.min(current, duration || 0)}
            onChange={(event) => seek(Number(event.target.value))}
            disabled={!duration || failed}
            aria-label="Posição do áudio"
            className={`relative h-4 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default
              [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow
              [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0
              ${tone.thumb}`}
          />
        </div>
        <div className={`mt-0.5 flex items-center justify-between text-[11px] ${tone.muted}`}>
          <span className="tabular-nums">
            {failed ? "Áudio indisponível" : clock}
          </span>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            download
            aria-label="Baixar áudio"
            title="Baixar áudio"
            className="rounded p-0.5 opacity-80 transition-opacity hover:opacity-100"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        disabled={failed}
        aria-label="Velocidade do áudio"
        title="Velocidade"
        className={`h-6 min-w-[2.25rem] flex-shrink-0 rounded-full px-1.5 text-[11px] font-semibold tabular-nums transition-colors disabled:opacity-50 ${tone.chip}`}
      >
        {SPEEDS[speedIndex]}x
      </button>
    </div>
  );
};
