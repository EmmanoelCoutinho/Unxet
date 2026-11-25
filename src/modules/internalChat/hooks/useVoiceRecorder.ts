import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

// Gravações maiores que isso param sozinhas e são enviadas
const MAX_RECORDING_SECONDS = 10 * 60;

const pickMimeType = () => {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(
      (type) => MediaRecorder.isTypeSupported(type),
    ) ?? ""
  );
};

const EXTENSION: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

/**
 * Gravação de áudio pelo microfone. `stop` entrega o arquivo para enviar;
 * `cancel` descarta.
 */
export function useVoiceRecorder(onRecorded: (file: File) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    if (recorderRef.current?.state === "recording") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Seu navegador não permite gravar áudio.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      console.error("Erro ao acessar o microfone:", error);
      toast.error("Não foi possível acessar o microfone. Confira a permissão do navegador.");
      return;
    }

    const mimeType = pickMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    discardRef.current = false;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      releaseMic();
      setRecording(false);
      recorderRef.current = null;
      if (discardRef.current) return;

      const type = (recorder.mimeType || mimeType || "audio/webm")
        .split(";")[0]
        .trim();
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (blob.size === 0) return;
      const file = new File(
        [blob],
        `audio-${Date.now()}.${EXTENSION[type] ?? "webm"}`,
        { type },
      );
      onRecordedRef.current(file);
    };

    recorder.start();
    setSeconds(0);
    setRecording(true);
  }, []);

  // Cronômetro e limite de duração
  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (current + 1 >= MAX_RECORDING_SECONDS) stop();
        return current + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording, stop]);

  // Sair da conversa no meio da gravação descarta o áudio e libera o microfone
  useEffect(
    () => () => {
      discardRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseMic();
    },
    [],
  );

  return { recording, seconds, start, stop, cancel };
}
