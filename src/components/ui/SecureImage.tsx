import React, { useEffect, useState } from "react";
import { useMediaUrl } from "../../lib/mediaUrls";

type SecureImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | null | undefined;
  // Exibido enquanto o link assinado é obtido, se o acesso for negado ou se a
  // imagem não carregar (ex.: link expirado da foto de perfil do WhatsApp/Instagram)
  fallback?: React.ReactNode;
};

/** <img> para arquivos do bucket privado (troca a URL por um link assinado). */
export const SecureImage: React.FC<SecureImageProps> = ({
  src,
  fallback = null,
  alt = "",
  onError,
  ...props
}) => {
  const resolved = useMediaUrl(src);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [resolved]);

  if (!resolved || failed) return <>{fallback}</>;
  return (
    <img
      src={resolved}
      alt={alt}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
      {...props}
    />
  );
};
