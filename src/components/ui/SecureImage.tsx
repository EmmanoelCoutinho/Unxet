import React from "react";
import { useMediaUrl } from "../../lib/mediaUrls";

type SecureImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | null | undefined;
  // Exibido enquanto o link assinado é obtido ou se o acesso for negado
  fallback?: React.ReactNode;
};

/** <img> para arquivos do bucket privado (troca a URL por um link assinado). */
export const SecureImage: React.FC<SecureImageProps> = ({
  src,
  fallback = null,
  alt = "",
  ...props
}) => {
  const resolved = useMediaUrl(src);
  if (!resolved) return <>{fallback}</>;
  return <img src={resolved} alt={alt} {...props} />;
};
