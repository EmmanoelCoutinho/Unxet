import React, { useState, useRef, useEffect } from "react";
import {
  SendIcon,
  PaperclipIcon,
  SmileIcon,
  ImageIcon,
  FileIcon,
  LockIcon,
  MicIcon,
  MessageSquareTextIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "../ui/Button";
import { supabase } from "../../lib/supabaseClient";
import { useClinic } from "../../contexts/ClinicContext";
import { EmojiPicker } from "./EmojiPicker";
import { QuickMessagesPicker } from "./QuickMessagesPicker";
import type { QuickMessage } from "../../services/quickMessages";
import { compressImageFile } from "../../lib/imageUtils";

const MAX_AUDIO_FILE_BYTES = 16 * 1024 * 1024;

type SendableInput =
  | string
  | {
      type: "text" | "image" | "audio" | "document";
      text?: string;
      mediaUrl?: string;
      mediaMimeType?: string;
      filename?: string;
      fileSize?: number;
    };

interface MessageInputProps {
  onSend: (input: SendableInput) => void;
  disabled?: boolean;
  disabledReason?: string;
  draft?: string;
  onDraftChange?: (value: string) => void;
  quickMessages?: QuickMessage[];
  quickMessagesLoading?: boolean;
  onRecordingStateChange?: (state: {
    isRecording: boolean;
    isSendingAudio: boolean;
    recordSeconds: number;
  }) => void;
}

type AllowedImageMime = "image/jpeg" | "image/png";
type AllowedAudioMime =
  | "audio/aac"
  | "audio/amr"
  | "audio/mpeg"
  | "audio/mp4"
  | "audio/ogg";
type AllowedDocumentMime =
  | "text/plain"
  | "application/pdf"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.ms-excel"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/vnd.ms-powerpoint"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const MessageInput: React.FC<MessageInputProps> = ({
  onSend,
  disabled = false,
  disabledReason,
  draft,
  onDraftChange,
  quickMessages = [],
  quickMessagesLoading = false,
  onRecordingStateChange,
}) => {
  const [internalMessage, setInternalMessage] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showQuickMessages, setShowQuickMessages] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSendingAudio, setIsSendingAudio] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const pickerRef = useRef<HTMLDivElement | null>(null);
  const attachmentsRef = useRef<HTMLDivElement | null>(null);
  const quickMessagesRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { clinicId } = useClinic();
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const message = draft ?? internalMessage;
  const setMessage = onDraftChange ?? setInternalMessage;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      if (pickerRef.current && pickerRef.current.contains(target)) return;
      if (attachmentsRef.current && attachmentsRef.current.contains(target))
        return;
      if (
        quickMessagesRef.current &&
        quickMessagesRef.current.contains(target)
      ) {
        return;
      }

      setShowEmojis(false);
      setShowAttachments(false);
      setShowQuickMessages(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!disabled) return;

    setShowEmojis(false);
    setShowAttachments(false);
    setShowQuickMessages(false);

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // gravador já encerrado: nada a fazer
      }
    }
    stopStreamTracks();
    setIsRecording(false);
    setIsSendingAudio(false);
  }, [disabled]);

  useEffect(
    () => () => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
      stopStreamTracks();
    },
    [],
  );

  useEffect(() => {
    if (!isRecording) {
      setRecordSeconds(0);
      return undefined;
    }
    const id = window.setInterval(
      () => setRecordSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => window.clearInterval(id);
  }, [isRecording]);

  useEffect(() => {
    onRecordingStateChange?.({
      isRecording,
      isSendingAudio,
      recordSeconds,
    });
  }, [isRecording, isSendingAudio, onRecordingStateChange, recordSeconds]);

  const stopStreamTracks = () => {
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordStreamRef.current = null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;

    if (message.trim()) {
      onSend(message.trim());
      setMessage("");
      setShowEmojis(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleEmojiClick = (emoji: string) => {
    if (disabled) return;

    setMessage(`${message}${emoji}`);
  };

  const normalizeMimeType = (value?: string | null) =>
    (value || "").toLowerCase().trim();

  const getExtension = (filename: string) =>
    filename.split(".").pop()?.toLowerCase() || "";

  const isZipSignature = (bytes: Uint8Array) =>
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;

  const isOleSignature = (bytes: Uint8Array) =>
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1;

  const detectRealImageMimeType = async (
    file: File,
  ): Promise<AllowedImageMime | null> => {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());

    const isJpeg =
      header.length >= 3 &&
      header[0] === 0xff &&
      header[1] === 0xd8 &&
      header[2] === 0xff;

    if (isJpeg) return "image/jpeg";

    const isPng =
      header.length >= 8 &&
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47 &&
      header[4] === 0x0d &&
      header[5] === 0x0a &&
      header[6] === 0x1a &&
      header[7] === 0x0a;

    if (isPng) return "image/png";

    return null;
  };

  const validateAudioFile = async (
    file: File,
  ): Promise<{ mimeType: AllowedAudioMime; extension: string } | null> => {
    const mimeType = normalizeMimeType(file.type);
    const extension = getExtension(file.name);
    const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());

    const isOgg =
      header.length >= 4 &&
      header[0] === 0x4f &&
      header[1] === 0x67 &&
      header[2] === 0x67 &&
      header[3] === 0x53;

    if (
      isOgg &&
      extension === "ogg" &&
      (mimeType === "audio/ogg" || mimeType === "application/ogg")
    ) {
      return { mimeType: "audio/ogg", extension: "ogg" };
    }

    const isAmr =
      header.length >= 6 &&
      header[0] === 0x23 &&
      header[1] === 0x21 &&
      header[2] === 0x41 &&
      header[3] === 0x4d &&
      header[4] === 0x52 &&
      header[5] === 0x0a;

    if (isAmr && extension === "amr" && mimeType === "audio/amr") {
      return { mimeType: "audio/amr", extension: "amr" };
    }

    const isAacAdts =
      header.length >= 2 &&
      header[0] === 0xff &&
      (header[1] === 0xf1 || header[1] === 0xf9);

    if (
      isAacAdts &&
      extension === "aac" &&
      (mimeType === "audio/aac" || mimeType === "audio/x-aac")
    ) {
      return { mimeType: "audio/aac", extension: "aac" };
    }

    const isMp3 =
      (header.length >= 3 &&
        header[0] === 0x49 &&
        header[1] === 0x44 &&
        header[2] === 0x33) ||
      (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0);

    if (
      isMp3 &&
      extension === "mp3" &&
      (mimeType === "audio/mpeg" || mimeType === "audio/mp3")
    ) {
      return { mimeType: "audio/mpeg", extension: "mp3" };
    }

    const box = new TextDecoder().decode(header.slice(4, 12));
    const isM4a =
      header.length >= 12 &&
      box.startsWith("ftyp") &&
      extension === "m4a" &&
      (mimeType === "audio/mp4" ||
        mimeType === "audio/x-m4a" ||
        mimeType === "audio/m4a");

    if (isM4a) {
      return { mimeType: "audio/mp4", extension: "m4a" };
    }

    return null;
  };

  const validateDocumentFile = async (
    file: File,
  ): Promise<{ mimeType: AllowedDocumentMime; extension: string } | null> => {
    const mimeType = normalizeMimeType(file.type);
    const extension = getExtension(file.name);
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());

    const isPdf =
      header.length >= 5 &&
      header[0] === 0x25 &&
      header[1] === 0x50 &&
      header[2] === 0x44 &&
      header[3] === 0x46 &&
      header[4] === 0x2d;

    if (isPdf && extension === "pdf" && mimeType === "application/pdf") {
      return { mimeType: "application/pdf", extension: "pdf" };
    }

    const isTxt = extension === "txt" && mimeType === "text/plain";
    if (isTxt) {
      return { mimeType: "text/plain", extension: "txt" };
    }

    const isOle = isOleSignature(header);
    if (isOle) {
      if (extension === "doc" && mimeType === "application/msword") {
        return { mimeType: "application/msword", extension: "doc" };
      }

      if (extension === "xls" && mimeType === "application/vnd.ms-excel") {
        return { mimeType: "application/vnd.ms-excel", extension: "xls" };
      }

      if (extension === "ppt" && mimeType === "application/vnd.ms-powerpoint") {
        return { mimeType: "application/vnd.ms-powerpoint", extension: "ppt" };
      }
    }

    const isZip = isZipSignature(header);
    if (isZip) {
      if (
        extension === "docx" &&
        mimeType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        return {
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          extension: "docx",
        };
      }

      if (
        extension === "xlsx" &&
        mimeType ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ) {
        return {
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          extension: "xlsx",
        };
      }

      if (
        extension === "pptx" &&
        mimeType ===
          "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      ) {
        return {
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          extension: "pptx",
        };
      }
    }

    return null;
  };

  const convertWebmToOgg = async (webmBlob: Blob): Promise<Blob> => {
    const fd = new FormData();
    fd.append("file", webmBlob, `voice-${Date.now()}.webm`);

    // A conversão passa pela edge function para não expor a chave do conversor
    const { data, error } = await supabase.functions.invoke("convert-audio", {
      body: fd,
    });

    if (error) {
      const response = (error as { context?: Response }).context;
      const maybeJson = await response?.json?.().catch(() => null);
      const msg =
        maybeJson?.error ||
        `Falha ao converter áudio${response?.status ? ` (HTTP ${response.status})` : ""}`;
      throw new Error(msg);
    }

    const oggBlob = data instanceof Blob ? data : null;

    if (!oggBlob || oggBlob.size === 0) {
      throw new Error("Conversão retornou arquivo vazio");
    }

    return oggBlob;
  };

  const uploadFileToSupabase = async (
    file: File,
    kind: "image" | "audio" | "document",
    options?: {
      contentType?: string;
      extension?: string;
    },
  ) => {
    const extFromName = file.name.split(".").pop();
    const defaultExt =
      kind === "image" ? "jpg" : kind === "audio" ? "mp3" : "bin";

    const fileExt = (
      options?.extension ||
      extFromName ||
      defaultExt
    ).toLowerCase();
    const fileName = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${fileExt}`;

    const folder =
      kind === "image"
        ? "outbound-images"
        : kind === "audio"
          ? "outbound-audios"
          : "outbound-documents";

    // O Storage só aceita upload na pasta da clínica do usuário
    if (!clinicId) {
      throw new Error("Clínica não identificada para o upload.");
    }
    const filePath = `${clinicId}/${folder}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("whatsapp-media")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType:
          options?.contentType ||
          file.type ||
          (kind === "image"
            ? "image/jpeg"
            : kind === "audio"
              ? "audio/mpeg"
              : "application/octet-stream"),
      });

    if (uploadError) {
      console.error("Erro ao fazer upload no Storage:", uploadError);
      throw uploadError;
    }

    const { data: publicData } = supabase.storage
      .from("whatsapp-media")
      .getPublicUrl(filePath);

    const publicUrl = publicData.publicUrl;

    return { publicUrl, path: filePath };
  };

  const sendAudioBlob = async (blob: Blob) => {
    if (disabled) return;
    if (!blob || blob.size === 0) return;

    const oggBlob = await convertWebmToOgg(blob);

    const oggFile = new File([oggBlob], `audio-${Date.now()}.ogg`, {
      type: "audio/ogg",
    });

    const { publicUrl } = await uploadFileToSupabase(oggFile, "audio", {
      contentType: "audio/ogg",
      extension: "ogg",
    });

    onSend({
      type: "audio",
      mediaUrl: publicUrl,
      mediaMimeType: "audio/ogg",
    });
  };

  const startRecording = async () => {
    if (disabled) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Seu navegador não permite gravação de áudio.");
      return;
    }

    try {
      setShowAttachments(false);
      setShowEmojis(false);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;

      const preferredMime = MediaRecorder.isTypeSupported(
        "audio/webm;codecs=opus",
      )
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        try {
          setIsSendingAudio(true);

          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });

          await sendAudioBlob(blob);
        } catch (err) {
          console.error("Erro ao finalizar gravação:", err);
          toast.error("Não foi possível enviar o áudio.");
        } finally {
          setIsRecording(false);
          setIsSendingAudio(false);
          stopStreamTracks();
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);
    } catch (err) {
      console.error("Erro ao iniciar gravação:", err);
      toast.error("Não foi possível acessar o microfone.");
      stopStreamTracks();
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setIsRecording(false);
    recorder.stop();
  };

  const handlePrimaryClick = () => {
    if (disabled) return;

    const hasText = Boolean(message.trim());

    if (hasText) {
      onSend(message.trim());
      setMessage("");
      setShowEmojis(false);
      return;
    }

    if (isRecording) {
      stopRecording();
      return;
    }

    startRecording();
  };

  const handleAttachmentClick = () => {
    if (disabled) return;

    setShowAttachments((prev) => !prev);
    setShowEmojis(false);
    setShowQuickMessages(false);
  };

  const handleImageOption = () => {
    if (disabled) return;

    setShowAttachments(false);
    fileInputRef.current?.click();
  };

  const handleAudioOption = () => {
    if (disabled) return;

    setShowAttachments(false);
    audioInputRef.current?.click();
  };

  const openQuickMessagesPicker = (
    event?: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (disabled) return;

    event?.preventDefault();
    event?.stopPropagation();

    setShowEmojis(false);
    setShowAttachments(false);

    requestAnimationFrame(() => {
      setShowQuickMessages(true);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      e.target.value = "";
      return;
    }

    setShowAttachments(false);

    const files = e.target.files;
    if (!files || files.length === 0) return;

    const allFiles = Array.from(files);
    const validImages: Array<{
      file: File;
      mimeType: AllowedImageMime;
      extension: "jpg" | "png";
      originalSize: number;
      compressedSize: number;
      wasCompressed: boolean;
    }> = [];

    for (const file of allFiles) {
      const realMimeType = await detectRealImageMimeType(file);

      if (!realMimeType) continue;

      const compressedImage = await compressImageFile(file, realMimeType);

      validImages.push({
        file: compressedImage.file,
        mimeType: compressedImage.mimeType,
        extension: compressedImage.extension,
        originalSize: compressedImage.originalSize,
        compressedSize: compressedImage.compressedSize,
        wasCompressed: compressedImage.wasCompressed,
      });
    }

    const compressedImagesCount = validImages.filter(
      (image) => image.wasCompressed,
    ).length;

    if (compressedImagesCount > 0) {
      const originalTotal = validImages.reduce(
        (total, image) => total + image.originalSize,
        0,
      );
      const compressedTotal = validImages.reduce(
        (total, image) => total + image.compressedSize,
        0,
      );

      console.info("[MessageInput] Imagens comprimidas antes do upload:", {
        count: compressedImagesCount,
        originalTotal,
        compressedTotal,
      });
    }

    if (validImages.length === 0) {
      toast.info("Por enquanto só aceitamos imagens JPG ou PNG válidas.");
      e.target.value = "";
      return;
    }

    if (validImages.length < allFiles.length) {
      console.warn("Alguns arquivos foram ignorados por não serem JPG/PNG.");
      toast.info("Algumas imagens foram ignoradas por não serem JPG ou PNG.");
    }

    try {
      for (const image of validImages) {
        const { publicUrl } = await uploadFileToSupabase(image.file, "image", {
          contentType: image.mimeType,
          extension: image.extension,
        });

        onSend({
          type: "image",
          mediaUrl: publicUrl,
          mediaMimeType: image.mimeType,
        });
      }
    } catch (err) {
      console.error("Erro ao enviar imagens:", err);
      toast.error("Ocorreu um erro ao enviar a imagem. Tente novamente.");
    } finally {
      e.target.value = "";
    }
  };

  const handleAudioChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      e.target.value = "";
      return;
    }

    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // Limite de áudio do WhatsApp
    if (file.size > MAX_AUDIO_FILE_BYTES) {
      toast.info("O áudio deve ter no máximo 16 MB.");
      e.target.value = "";
      return;
    }

    const validAudio = await validateAudioFile(file);

    if (!validAudio) {
      console.warn("Arquivo selecionado não é um áudio suportado");
      toast.info("Por enquanto só aceitamos áudios AAC, AMR, MP3, M4A ou OGG.");
      e.target.value = "";
      return;
    }

    try {
      const { publicUrl } = await uploadFileToSupabase(file, "audio", {
        contentType: validAudio.mimeType,
        extension: validAudio.extension,
      });

      onSend({
        type: "audio",
        mediaUrl: publicUrl,
        mediaMimeType: validAudio.mimeType,
      });
    } catch (err) {
      console.error("Erro ao enviar áudio:", err);
      toast.error("Não foi possível enviar o áudio.");
    } finally {
      e.target.value = "";
    }
  };

  const handleDocumentChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (disabled) {
      e.target.value = "";
      return;
    }

    setShowAttachments(false);

    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const validDocument = await validateDocumentFile(file);

    if (!validDocument) {
      toast.info(
        "Por enquanto só aceitamos documentos TXT, PDF, DOC, DOCX, XLS, XLSX, PPT ou PPTX.",
      );
      e.target.value = "";
      return;
    }

    try {
      const { publicUrl } = await uploadFileToSupabase(file, "document", {
        contentType: validDocument.mimeType,
        extension: validDocument.extension,
      });

      onSend({
        type: "document",
        mediaUrl: publicUrl,
        mediaMimeType: validDocument.mimeType,
        filename: file.name,
        fileSize: file.size,
        text: message.trim() || undefined,
      });

      setMessage("");
    } catch (err) {
      console.error("Erro ao enviar documento:", err);
      toast.error("Não foi possível enviar o documento.");
    } finally {
      e.target.value = "";
    }
  };

  const formatRecordTime = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
      2,
      "0",
    )}`;
  };

  const placeholderText = disabled
    ? disabledReason || "Você não tem permissão para responder esta conversa."
    : "Digite uma mensagem...";

  return (
    <div className="sticky bottom-0 shrink-0 border-t border-[#E5E7EB] bg-white p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] z-20 shadow-sm sm:p-4">
      {disabled && (
        <div className="mb-2 flex items-center gap-2 text-xs text-[#6B7280]">
          <LockIcon className="w-4 h-4" />
          <span>
            {disabledReason || "Apenas o atendente responsável pode responder."}
          </span>
        </div>
      )}

      {false && isRecording && !disabled && (
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-[#1F2937]">
          <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="font-medium">Gravando...</span>
          <span className="text-[#6B7280]">
            {formatRecordTime(recordSeconds)}
          </span>
          <span className="text-[#9CA3AF] text-xs">
            Toque no botão para concluir e enviar
          </span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="relative flex items-end gap-1 sm:items-stretch sm:gap-2"
      >
        <div className="flex shrink-0 gap-0.5 sm:gap-2">
          <button
            type="button"
            onClick={handleAttachmentClick}
            disabled={disabled}
            aria-label="Anexar"
            className="relative flex h-11 w-10 items-center justify-center rounded-lg hover:bg-[#E5E7EB] transition-colors disabled:opacity-50 disabled:hover:bg-transparent sm:h-12 sm:w-12"
          >
            <PaperclipIcon className="w-5 h-5 text-gray-500" />

            {showAttachments && !disabled && (
              <div
                ref={attachmentsRef}
                className="absolute bottom-full left-0 z-30 mb-2 w-56 rounded-lg border border-[#E5E7EB] bg-white shadow-lg overflow-hidden"
              >
                <button
                  type="button"
                  onMouseDown={openQuickMessagesPicker}
                  onClick={openQuickMessagesPicker}
                  className="w-full flex items-center justify-between px-3 py-3 text-sm hover:bg-[#F3F4F6] transition-colors sm:py-2"
                >
                  <span className="flex items-center gap-2 text-[#1F2937]">
                    <MessageSquareTextIcon className="w-4 h-4" />
                    Mensagens rápidas
                  </span>
                  <span className="text-xs text-[#6B7280]">Abrir</span>
                </button>

                <button
                  type="button"
                  onClick={handleImageOption}
                  className="w-full flex items-center justify-between px-3 py-3 text-sm hover:bg-[#F3F4F6] transition-colors sm:py-2"
                >
                  <span className="flex items-center gap-2 text-[#1F2937]">
                    <ImageIcon className="w-4 h-4" />
                    Imagem
                  </span>
                  <span className="text-xs text-[#6B7280]">Selecionar</span>
                </button>

                <button
                  type="button"
                  onClick={handleAudioOption}
                  className="w-full flex items-center justify-between px-3 py-3 text-sm hover:bg-[#F3F4F6] transition-colors sm:py-2"
                >
                  <span className="flex items-center gap-2 text-[#1F2937]">
                    <MicIcon className="w-4 h-4" />
                    Áudio
                  </span>
                  <span className="text-xs text-[#6B7280]">Selecionar</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (disabled) return;
                    setShowAttachments(false);
                    docInputRef.current?.click();
                  }}
                  className="w-full flex items-center justify-between px-3 py-3 text-sm hover:bg-[#F3F4F6] transition-colors sm:py-2"
                >
                  <span className="flex items-center gap-2 text-[#1F2937]">
                    <FileIcon className="w-4 h-4" />
                    Documento
                  </span>
                  <span className="text-xs text-[#6B7280]">Selecionar</span>
                </button>
              </div>
            )}
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              setShowEmojis((v) => !v);
              setShowAttachments(false);
            }}
            aria-label="Emojis"
            className="flex h-11 w-10 items-center justify-center rounded-lg hover:bg-[#E5E7EB] transition-colors disabled:opacity-50 disabled:hover:bg-transparent sm:h-12 sm:w-12"
          >
            <SmileIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          rows={1}
          disabled={disabled}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#E5E7EB] px-3 py-2.5 resize-none sm:min-h-12 sm:px-4 sm:py-3 max-h-32 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF] disabled:cursor-not-allowed disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF]"
        />

        <Button
          type="button"
          variant="primary"
          aria-label={message.trim() || isRecording ? "Enviar" : "Gravar áudio"}
          className={`flex h-11 min-w-11 shrink-0 items-center justify-center !px-0 sm:h-12 sm:w-auto sm:min-h-12 sm:!px-4 ${
            isRecording ? "bg-red-500 hover:bg-red-600 focus:ring-red-500" : ""
          }`}
          disabled={disabled || isSendingAudio}
          onClick={handlePrimaryClick}
        >
          {disabled ? (
            <LockIcon className="w-4 h-4" />
          ) : message.trim() || isRecording ? (
            <SendIcon className="w-4 h-4" />
          ) : (
            <MicIcon className="w-4 h-4" />
          )}
        </Button>

        <EmojiPicker
          open={showEmojis && !disabled}
          disabled={disabled}
          pickerRef={pickerRef}
          onPick={handleEmojiClick}
        />
      </form>

      <input
        style={{ display: "none" }}
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="invisible"
        onChange={handleFileChange}
      />

      <input
        style={{ display: "none" }}
        ref={audioInputRef}
        type="file"
        accept=".aac,.amr,.mp3,.m4a,.ogg,audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg"
        className="invisible"
        onChange={handleAudioChange}
      />

      <input
        style={{ display: "none" }}
        ref={docInputRef}
        type="file"
        accept=".txt,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="invisible"
        onChange={handleDocumentChange}
      />

      <QuickMessagesPicker
        open={showQuickMessages && !disabled}
        loading={quickMessagesLoading}
        quickMessages={quickMessages}
        onClose={() => setShowQuickMessages(false)}
        contentRef={quickMessagesRef}
        onSelect={(selectedMessage) => {
          setMessage(selectedMessage);
        }}
      />
    </div>
  );
};
