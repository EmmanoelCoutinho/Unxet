import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DownloadIcon,
  FilmIcon,
  Loader2Icon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";

// Só um vídeo toca por vez: dar play em outro pausa o anterior
let playingVideo: HTMLVideoElement | null = null;

const SPEEDS = [1, 1.5, 2] as const;
// Tocando sem avançar por este tempo: recarrega do ponto onde parou
const STALL_RETRY_MS = 6000;
const MAX_STALL_RETRIES = 2;
const HIDE_CONTROLS_MS = 2500;

const formatClock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

type VideoPlayerProps = {
  src: string;
  /** Mensagem enviada pela empresa (balão azul) ou recebida do cliente. */
  outgoing: boolean;
  /** Nome do arquivo ao baixar. */
  filename?: string;
};

type Status = "loading" | "ready" | "failed" | "noPicture";

/** Player de vídeo das mensagens, no lugar do player padrão do navegador. */
export const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, outgoing, filename }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | null>(null);
  const lastProgress = useRef({ time: 0, at: 0 });
  const stallRetries = useRef(0);
  const resumeAtRef = useRef(0);

  const [status, setStatus] = useState<Status>("loading");
  const [playing, setPlaying] = useState(false);
  // Atendente quer assistir (deu play e não pausou): a vigilância de travada segue isto
  const [wantsToPlay, setWantsToPlay] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [started, setStarted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [ratio, setRatio] = useState(16 / 9);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // Arquivo novo (link renovado, outra mensagem): começa do zero
  useEffect(() => {
    setStatus("loading");
    setPlaying(false);
    setWantsToPlay(false);
    setBuffering(false);
    setStarted(false);
    setCurrent(0);
    setDuration(0);
    setBuffered(0);
    stallRetries.current = 0;
    resumeAtRef.current = 0;
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const readBuffered = () => {
      const ranges = video.buffered;
      if (!ranges.length || !Number.isFinite(video.duration)) return;
      // Trecho carregado que contém a posição atual
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= video.currentTime + 0.5 && ranges.end(i) >= video.currentTime) {
          setBuffered(ranges.end(i));
          return;
        }
      }
      setBuffered(ranges.end(ranges.length - 1));
    };
    const onMeta = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      if (video.videoWidth && video.videoHeight) {
        setRatio(video.videoWidth / video.videoHeight);
        setStatus("ready");
      } else {
        // Tem duração mas não tem imagem: codec que o navegador não abre (ex.: HEVC)
        setStatus(video.duration > 0 ? "noPicture" : "ready");
      }
    };
    const onTime = () => {
      setCurrent(video.currentTime);
      if (video.currentTime > 0) resumeAtRef.current = video.currentTime;
      lastProgress.current = { time: video.currentTime, at: Date.now() };
      readBuffered();
    };
    const onPlay = () => {
      if (playingVideo && playingVideo !== video) playingVideo.pause();
      playingVideo = video;
      lastProgress.current = { time: video.currentTime, at: Date.now() };
      setPlaying(true);
      setStarted(true);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onCanPlay = () => {
      setBuffering(false);
      setStatus((s) => (s === "loading" ? "ready" : s));
    };
    const onEnded = () => {
      setPlaying(false);
      setWantsToPlay(false);
      setControlsVisible(true);
    };
    const onError = () => {
      setBuffering(false);
      setStatus("failed");
    };

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("durationchange", onMeta);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("progress", readBuffered);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onWaiting);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("playing", onCanPlay);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);

    // Arquivo que respondeu antes de os eventos acima estarem ligados
    if (video.error) onError();
    else {
      if (video.readyState >= 1) onMeta();
      if (video.readyState >= 3) onCanPlay();
    }

    return () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("progress", readBuffered);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onWaiting);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("playing", onCanPlay);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      if (playingVideo === video) playingVideo = null;
    };
  }, [src]);

  // Travou (a conexão caiu no meio): recarrega do mesmo ponto. Segue a
  // vontade de assistir, não o "tocando": ao recarregar o vídeo fica pausado
  // até os dados voltarem.
  useEffect(() => {
    if (!wantsToPlay) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.ended) return;
      const stuck = Date.now() - lastProgress.current.at > STALL_RETRY_MS;
      if (!stuck || (video.readyState >= 3 && !video.paused)) return;
      if (stallRetries.current >= MAX_STALL_RETRIES) {
        video.pause();
        setWantsToPlay(false);
        setBuffering(false);
        setStatus("failed");
        return;
      }
      stallRetries.current += 1;
      const resumeAt = video.currentTime > 0 ? video.currentTime : resumeAtRef.current;
      lastProgress.current = { time: resumeAt, at: Date.now() };
      setStatus("loading");
      video.load();
      const resume = () => {
        video.removeEventListener("loadedmetadata", resume);
        video.currentTime = resumeAt;
        void video.play().catch(() => undefined);
      };
      video.addEventListener("loadedmetadata", resume);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [wantsToPlay]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === boxRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  }, []);

  // Controles somem sozinhos enquanto toca; aparecem ao mexer o mouse ou tocar
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, HIDE_CONTROLS_MS);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || status === "failed") return;
    if (video.paused || video.ended) {
      if (video.ended) video.currentTime = 0;
      stallRetries.current = 0;
      lastProgress.current = { time: video.currentTime, at: Date.now() };
      setWantsToPlay(true);
      void video.play().catch(() => setStatus("failed"));
      showControls();
    } else {
      video.pause();
      setWantsToPlay(false);
      setControlsVisible(true);
    }
  };

  const seek = (value: number) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    video.currentTime = value;
    setCurrent(value);
    showControls();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const cycleSpeed = () => {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (videoRef.current) videoRef.current.playbackRate = SPEEDS[next];
  };

  const toggleFullscreen = () => {
    const box = boxRef.current;
    if (!box) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (box.requestFullscreen) {
      void box.requestFullscreen().catch(() => undefined);
    } else {
      // iPhone: só o próprio vídeo abre em tela cheia
      (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })
        ?.webkitEnterFullscreen?.();
    }
  };

  const retry = () => {
    const video = videoRef.current;
    if (!video) return;
    stallRetries.current = 0;
    setWantsToPlay(false);
    setStatus("loading");
    video.load();
  };

  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;
  const bufferedPct = duration ? Math.min(100, (buffered / duration) * 100) : 0;
  const showOverlayControls = controlsVisible || !playing;
  // Retrato fica mais estreito para não ocupar a tela toda
  const boxWidth = ratio < 1 ? "w-56" : "w-72";
  const unavailable = status === "failed" || status === "noPicture";

  return (
    <div
      ref={boxRef}
      className={`group/video relative max-w-full overflow-hidden ${
        fullscreen ? "flex h-full w-full items-center justify-center bg-black" : `${boxWidth} rounded-xl`
      } ${outgoing ? "bg-[#fff]/15" : "bg-gray-200"}`}
      style={fullscreen ? undefined : { aspectRatio: String(Math.min(Math.max(ratio, 9 / 16), 16 / 9)) }}
      onMouseMove={playing ? showControls : undefined}
      onMouseLeave={() => playing && setControlsVisible(false)}
      onTouchStart={showControls}
    >
      <video
        ref={videoRef}
        // #t: o navegador desenha o primeiro quadro como capa
        src={`${src}#t=0.1`}
        preload="metadata"
        playsInline
        muted={muted}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        className={`h-full w-full cursor-pointer object-contain transition-opacity duration-300 ${
          status === "ready" ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Carregando: fundo claro com brilho, sem tela preta */}
      {status === "loading" && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-2 ${
            outgoing ? "text-white/90" : "text-gray-500"
          }`}
          aria-label="Carregando vídeo"
        >
          <div
            className={`absolute inset-0 animate-pulse ${outgoing ? "bg-[#fff]/10" : "bg-gray-300/60"}`}
          />
          <FilmIcon className="relative h-8 w-8" aria-hidden />
          <span className="relative text-xs font-medium">Carregando vídeo...</span>
        </div>
      )}

      {unavailable && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center ${
            outgoing ? "text-white" : "text-gray-700"
          }`}
        >
          <FilmIcon className="h-7 w-7 opacity-80" aria-hidden />
          <p className="text-xs">
            {status === "noPicture"
              ? "O navegador não mostra a imagem deste vídeo. Baixe para assistir."
              : "Não foi possível tocar o vídeo aqui."}
          </p>
          <div className="flex gap-2">
            {status === "failed" && (
              <button
                type="button"
                onClick={retry}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  outgoing ? "bg-white/20 hover:bg-white/30" : "bg-white hover:bg-gray-50 border border-gray-300"
                }`}
              >
                Tentar de novo
              </button>
            )}
            <a
              href={src}
              download={filename || true}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                outgoing ? "bg-white text-[#0A84FF] hover:bg-blue-50" : "bg-[#0A84FF] text-white hover:bg-[#0066d6]"
              }`}
            >
              <DownloadIcon className="h-3.5 w-3.5" aria-hidden />
              Baixar
            </a>
          </div>
        </div>
      )}

      {/* Botão grande no meio: parado, ou carregando um trecho */}
      {status === "ready" && (!playing || buffering) && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={buffering ? "Carregando" : "Assistir vídeo"}
          className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-105"
        >
          {buffering ? (
            <Loader2Icon className="h-7 w-7 animate-spin" aria-hidden />
          ) : (
            <PlayIcon className="ml-1 h-7 w-7" fill="currentColor" aria-hidden />
          )}
        </button>
      )}

      {/* Antes do primeiro play: duração no canto, como no WhatsApp */}
      {status === "ready" && !started && duration > 0 && (
        <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
          <FilmIcon className="h-3 w-3" aria-hidden />
          {formatClock(duration)}
        </span>
      )}

      {/* Barra de controles: depois do primeiro play */}
      {status === "ready" && started && (
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2.5 pb-2 pt-6 text-white transition-opacity duration-200 ${
            showOverlayControls ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div className="relative flex h-4 items-center">
            <div className="absolute inset-x-0 h-1 rounded-full bg-white/25" />
            <div className="absolute left-0 h-1 rounded-full bg-white/40" style={{ width: `${bufferedPct}%` }} />
            <div className="absolute left-0 h-1 rounded-full bg-[#0A84FF]" style={{ width: `${progress}%` }} />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={Math.min(current, duration || 0)}
              onChange={(event) => seek(Number(event.target.value))}
              disabled={!duration}
              aria-label="Posição do vídeo"
              className="relative h-4 w-full cursor-pointer appearance-none bg-transparent
                [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow
                [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
            />
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pausar vídeo" : "Assistir vídeo"}
              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15"
            >
              {playing ? (
                <PauseIcon className="h-4 w-4" fill="currentColor" aria-hidden />
              ) : (
                <PlayIcon className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden />
              )}
            </button>
            <span className="text-[11px] tabular-nums">
              {formatClock(current)} / {formatClock(duration)}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={cycleSpeed}
                aria-label="Velocidade do vídeo"
                title="Velocidade"
                className="h-6 min-w-[2.25rem] rounded-full px-1.5 text-[11px] font-semibold tabular-nums hover:bg-white/15"
              >
                {SPEEDS[speedIndex]}x
              </button>
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? "Ativar som" : "Tirar som"}
                title={muted ? "Ativar som" : "Tirar som"}
                className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15"
              >
                {muted ? <VolumeXIcon className="h-4 w-4" aria-hidden /> : <Volume2Icon className="h-4 w-4" aria-hidden />}
              </button>
              <a
                href={src}
                download={filename || true}
                target="_blank"
                rel="noreferrer"
                aria-label="Baixar vídeo"
                title="Baixar vídeo"
                className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15"
              >
                <DownloadIcon className="h-4 w-4" aria-hidden />
              </a>
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
                title={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
                className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15"
              >
                {fullscreen ? <MinimizeIcon className="h-4 w-4" aria-hidden /> : <MaximizeIcon className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
