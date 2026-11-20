import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlusIcon, Loader2Icon, StickerIcon } from "lucide-react";
import { toast } from "react-toastify";
import { supabase } from "../../lib/supabaseClient";
import { CloseButton } from "../ui/CloseButton";
import {
  MAX_STICKER_SOURCE_BYTES,
  STICKER_SOURCE_ACCEPT,
  imageToSticker,
  sha256Hex,
} from "../../lib/stickerImage";

type LibrarySticker = { url: string; previewUrl: string };

// Lista da empresa guardada por alguns minutos (abrir e fechar não recarrega)
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; stickers: LibrarySticker[] }>();

/**
 * Figurinhas para enviar: as que a empresa já recebeu, enviou ou criou
 * (pasta <empresa>/stickers, pela edge function sticker-library), e a opção
 * de criar uma a partir de uma imagem.
 */
export const StickerPicker: React.FC<{
  open: boolean;
  onClose: () => void;
  onSelect: (stickerUrl: string) => void;
  clinicId: string | null;
}> = ({ open, onClose, onSelect, clinicId }) => {
  const [stickers, setStickers] = useState<LibrarySticker[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (force = false) => {
      if (!clinicId) return;
      const cached = cache.get(clinicId);
      if (!force && cached && Date.now() - cached.at < CACHE_MS) {
        setStickers(cached.stickers);
        return;
      }
      setLoading(true);
      setLoadError(false);
      const { data, error } = await supabase.functions.invoke("sticker-library", {
        body: { clinicId },
      });
      setLoading(false);
      if (error) {
        console.error("Erro ao carregar figurinhas:", error);
        setLoadError(true);
        return;
      }
      const list = ((data?.stickers ?? []) as LibrarySticker[]).filter((s) => s?.url && s?.previewUrl);
      cache.set(clinicId, { at: Date.now(), stickers: list });
      setStickers(list);
    },
    [clinicId],
  );

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creating) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, creating]);

  const choose = (url: string) => {
    onSelect(url);
  };

  const createFromImage = async (file: File) => {
    if (!clinicId) return;
    if (!file.type.startsWith("image/")) {
      toast.info("Escolha uma imagem JPG, PNG, WebP ou GIF.");
      return;
    }
    if (file.size > MAX_STICKER_SOURCE_BYTES) {
      toast.info("A imagem deve ter no máximo 10 MB.");
      return;
    }
    setCreating(true);
    try {
      const sticker = await imageToSticker(file);
      const hash = await sha256Hex(sticker.blob);
      const path = `${clinicId}/stickers/${hash}.${sticker.extension}`;
      const { error } = await supabase.storage
        .from("whatsapp-media")
        .upload(path, sticker.blob, { contentType: sticker.mimeType, upsert: false, cacheControl: "3600" });
      // A mesma imagem já virou figurinha antes: usa o arquivo que existe
      const alreadyThere = error && /exist|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ""}`);
      if (error && !alreadyThere) throw error;
      const url = supabase.storage.from("whatsapp-media").getPublicUrl(path).data.publicUrl;
      cache.delete(clinicId);
      choose(url);
    } catch (err) {
      console.error("Erro ao criar figurinha:", err);
      toast.error("Não foi possível criar a figurinha com essa imagem.");
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/40" onClick={creating ? undefined : onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sticker-picker-title"
        className="absolute left-1/2 top-1/2 flex max-h-[90dvh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-5">
          <div>
            <h3 id="sticker-picker-title" className="text-base font-semibold text-gray-900">
              Figurinhas
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              As que a empresa já recebeu ou enviou. Clique para enviar.
            </p>
          </div>
          <CloseButton onClick={() => !creating && onClose()} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={creating}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-[#0A84FF] transition-colors hover:bg-blue-50 disabled:opacity-60"
          >
            {creating ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden />
                Criando figurinha...
              </>
            ) : (
              <>
                <ImagePlusIcon className="h-4 w-4" aria-hidden />
                Criar figurinha com uma imagem
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={STICKER_SOURCE_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void createFromImage(file);
            }}
          />

          {loading && stickers.length === 0 ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5" aria-label="Carregando figurinhas">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-gray-100" />
              ))}
            </div>
          ) : loadError ? (
            <div className="py-6 text-center text-sm text-gray-500">
              Não foi possível carregar as figurinhas.{" "}
              <button type="button" onClick={() => void load(true)} className="font-medium text-[#0A84FF] hover:underline">
                Tentar de novo
              </button>
            </div>
          ) : stickers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-gray-500">
              <StickerIcon className="h-8 w-8 text-gray-300" aria-hidden />
              Nenhuma figurinha ainda. As que os clientes mandarem aparecem aqui, ou crie uma com uma imagem.
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {stickers.map((sticker) => (
                <button
                  key={sticker.url}
                  type="button"
                  disabled={creating}
                  onClick={() => choose(sticker.url)}
                  className="flex aspect-square items-center justify-center rounded-xl p-1.5 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#0A84FF] disabled:opacity-50"
                  aria-label="Enviar figurinha"
                  title="Enviar figurinha"
                >
                  <img src={sticker.previewUrl} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
