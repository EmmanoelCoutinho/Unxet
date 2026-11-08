import React, { useEffect, useRef, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "../ui/Button";

type Props = {
  src: string;
  alt: string;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
};

// Só é imagem se vier como data URL ou link; o texto cru do QR não abre no <img>
const looksLikeImage = (value: string) =>
  /^data:image\//i.test(value) || /^https?:\/\//i.test(value);

// Mostra o QR Code do WhatsApp; se a imagem não abrir, oferece gerar outro
export const WhatsAppQrCode: React.FC<Props> = ({
  src,
  alt,
  onRetry,
  retrying = false,
  className = "h-72 w-72",
}) => {
  const [failed, setFailed] = useState(() => !looksLikeImage(src));
  const imgRef = useRef<HTMLImageElement>(null);

  // QR novo chegou: tenta mostrar de novo
  useEffect(() => {
    setFailed(!looksLikeImage(src));
  }, [src]);

  // Imagem inválida pode falhar antes do onError ser ligado: confere ao montar
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src, failed]);

  if (failed) {
    return (
      <div
        className={`flex max-w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gray-300 bg-white px-4 text-center ${className}`}
      >
        <p className="text-sm text-gray-600">
          Não foi possível carregar o QR Code.
        </p>
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700"
          onClick={onRetry}
          disabled={retrying}
        >
          <span className="flex items-center gap-2">
            <RefreshCwIcon
              className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`}
            />
            {retrying ? "Gerando QR Code..." : "Tentar novamente"}
          </span>
        </Button>
      </div>
    );
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      className={`max-w-full ${className}`}
      onError={() => setFailed(true)}
    />
  );
};
