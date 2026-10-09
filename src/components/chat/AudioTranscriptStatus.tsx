import React, { useMemo, useState } from "react";
import {
  CheckCircle2Icon,
  CopyIcon,
  Loader2Icon,
  RefreshCwIcon,
  AlertCircleIcon,
  ChevronDownIcon,
} from "lucide-react";
import type { TranscriptStatus } from "../../types";

interface AudioTranscriptStatusProps {
  status?: TranscriptStatus;
  transcriptText?: string;
  onRetry?: () => Promise<void> | void;
}

export const AudioTranscriptStatus: React.FC<AudioTranscriptStatusProps> =
  React.memo(({ status, transcriptText, onRetry }) => {
    const [expanded, setExpanded] = useState(false);
    const [expandedLongText, setExpandedLongText] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied">("idle");
    const [retrying, setRetrying] = useState(false);

    const normalizedStatus = status ?? undefined;
    const hasTranscript = Boolean(transcriptText?.trim());
    const isPending =
      normalizedStatus === "PENDING" || normalizedStatus === "PROCESSING";
    const isDone = normalizedStatus === "DONE";
    const isFailed = normalizedStatus === "FAILED";
    const isLongTranscript = (transcriptText?.trim().length ?? 0) > 280;

    const transcriptBlockStyle = useMemo(() => {
      if (expandedLongText) return undefined;
      return {
        display: "-webkit-box",
        WebkitLineClamp: 4,
        WebkitBoxOrient: "vertical" as const,
        overflow: "hidden",
      };
    }, [expandedLongText]);

    const handleCopy = async () => {
      const value = transcriptText?.trim();
      if (!value) return;

      try {
        await navigator.clipboard.writeText(value);
        setCopyFeedback("copied");
        window.setTimeout(() => setCopyFeedback("idle"), 1500);
      } catch (error) {
        console.error("copy transcript error:", error);
      }
    };

    const handleRetry = async () => {
      if (!onRetry || retrying) return;
      setRetrying(true);
      try {
        await onRetry();
      } finally {
        setRetrying(false);
      }
    };

    if (!normalizedStatus) return null;

    if (isPending) {
      return (
        <div className="mt-2 rounded-xl bg-white/70 p-3 ring-1 ring-black/5 min-h-[82px]">
          <div className="flex items-center gap-2 text-xs text-[#4B5563]">
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            <span>Transcrevendo...</span>
          </div>
          <div className="mt-2 space-y-2" aria-hidden>
            <div className="h-3 w-[92%] rounded bg-[#E5E7EB] animate-pulse" />
            <div className="h-3 w-[72%] rounded bg-[#E5E7EB] animate-pulse" />
          </div>
        </div>
      );
    }

    if (isDone) {
      return (
        <div className="mt-2 rounded-xl bg-white/75 p-2.5 ring-1 ring-black/5">
          <div className="flex items-center gap-2 text-xs text-[#4B5563]">
            <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500" />
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]/40"
              aria-label={expanded ? "Ocultar transcrição" : "Ver transcrição"}
              aria-expanded={expanded}
            >
              {expanded ? "Ocultar" : "Ver transcrição"}
              <ChevronDownIcon
                className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!hasTranscript}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-black/5 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]/40"
              aria-label="Copiar transcrição"
            >
              <CopyIcon className="h-3.5 w-3.5" />
              {copyFeedback === "copied" ? "Copiado" : "Copiar"}
            </button>
          </div>

          <div
            className={`grid transition-all duration-200 ${expanded ? "grid-rows-[1fr] mt-2" : "grid-rows-[0fr]"}`}
          >
            <div className="overflow-hidden">
              <p className="text-xs leading-relaxed text-[#1F2937]" style={transcriptBlockStyle}>
                {hasTranscript
                  ? transcriptText?.trim()
                  : "Transcrição indisponível para este áudio."}
              </p>
              {isLongTranscript && (
                <button
                  type="button"
                  onClick={() => setExpandedLongText((prev) => !prev)}
                  className="mt-1 text-xs text-[#0A84FF] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]/40 rounded-sm"
                  aria-label={expandedLongText ? "Mostrar menos texto" : "Ver mais texto"}
                >
                  {expandedLongText ? "Ver menos" : "Ver mais"}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (isFailed) {
      return (
        <div className="mt-2 rounded-xl bg-white/75 px-3 py-2 ring-1 ring-black/5">
          <div className="flex items-center gap-2 text-xs text-[#6B7280]">
            <AlertCircleIcon className="h-3.5 w-3.5 text-amber-500" />
            <span>Falha ao transcrever</span>
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[#0A84FF] hover:bg-black/5 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]/40"
              aria-label="Tentar novamente a transcrição"
            >
              <RefreshCwIcon
                className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`}
              />
              {retrying ? "Tentando..." : "Tentar novamente"}
            </button>
          </div>
        </div>
      );
    }

    return null;
  });

AudioTranscriptStatus.displayName = "AudioTranscriptStatus";
