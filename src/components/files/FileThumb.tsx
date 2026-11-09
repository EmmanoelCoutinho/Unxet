import React from "react";
import { FileAudioIcon, FileTextIcon, FileVideoIcon, ImageIcon } from "lucide-react";
import { useMediaUrl } from "../../lib/mediaUrls";
import type { FileKind } from "../../services/fileLibrary";

const ICONS: Record<FileKind, React.ElementType> = {
  image: ImageIcon,
  audio: FileAudioIcon,
  video: FileVideoIcon,
  document: FileTextIcon,
};

const COLORS: Record<FileKind, string> = {
  image: "bg-violet-50 text-violet-600",
  audio: "bg-amber-50 text-amber-600",
  video: "bg-rose-50 text-rose-600",
  document: "bg-blue-50 text-blue-600",
};

const ImagePreview: React.FC<{ url: string; className: string }> = ({ url, className }) => {
  const src = useMediaUrl(url);
  if (!src) return <div className={`${className} animate-pulse bg-slate-100`} />;
  return <img src={src} alt="" loading="lazy" className={`${className} object-cover`} />;
};

/** Miniatura do arquivo: a própria imagem ou um ícone pelo tipo. */
export const FileThumb: React.FC<{
  kind: FileKind;
  url?: string | null;
  size?: "sm" | "md";
}> = ({ kind, url, size = "md" }) => {
  const box = size === "sm" ? "h-10 w-10 rounded-lg" : "h-12 w-12 rounded-xl";
  if (kind === "image" && url) {
    return <ImagePreview url={url} className={`${box} shrink-0`} />;
  }
  const Icon = ICONS[kind];
  return (
    <div className={`${box} flex shrink-0 items-center justify-center ${COLORS[kind]}`}>
      <Icon className={size === "sm" ? "h-5 w-5" : "h-6 w-6"} />
    </div>
  );
};
