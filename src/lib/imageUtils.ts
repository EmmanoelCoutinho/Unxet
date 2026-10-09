type CompressImageOptions = {
  maxDimension?: number;
  quality?: number;
  minBytesToCompress?: number;
};

type CompressImageResult = {
  file: File;
  mimeType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
};

type SupabaseImageTransformOptions = {
  width?: number;
  height?: number;
  quality?: number;
  resize?: "cover" | "contain" | "fill";
};

const DEFAULT_MAX_IMAGE_DIMENSION = 1920;
const DEFAULT_IMAGE_QUALITY = 0.86;
const DEFAULT_MIN_BYTES_TO_COMPRESS = 350 * 1024;
const SUPABASE_PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";
const SUPABASE_PUBLIC_RENDER_PATH = "/storage/v1/render/image/public/";

const loadImageFromFile = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Não foi possível carregar a imagem."));
    };

    image.src = objectUrl;
  });

const canvasHasTransparency = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) => {
  const { data } = context.getImageData(0, 0, width, height);

  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }

  return false;
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mimeType: "image/jpeg" | "image/png",
  quality: number,
) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Não foi possível comprimir a imagem."));
      },
      mimeType,
      quality,
    );
  });

export const compressImageFile = async (
  file: File,
  detectedMimeType: "image/jpeg" | "image/png",
  options: CompressImageOptions = {},
): Promise<CompressImageResult> => {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_IMAGE_DIMENSION;
  const quality = options.quality ?? DEFAULT_IMAGE_QUALITY;
  const minBytesToCompress =
    options.minBytesToCompress ?? DEFAULT_MIN_BYTES_TO_COMPRESS;
  const image = await loadImageFromFile(file);
  const scale = Math.min(
    1,
    maxDimension / Math.max(image.naturalWidth, image.naturalHeight),
  );

  if (scale === 1 && file.size < minBytesToCompress) {
    return {
      file,
      mimeType: detectedMimeType,
      extension: detectedMimeType === "image/png" ? "png" : "jpg",
      originalSize: file.size,
      compressedSize: file.size,
      wasCompressed: false,
    };
  }

  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas não suportado pelo navegador.");
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  const hasTransparency =
    detectedMimeType === "image/png" && canvasHasTransparency(context, width, height);
  const outputMimeType = hasTransparency ? "image/png" : "image/jpeg";

  if (outputMimeType === "image/jpeg") {
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);
  }

  const blob = await canvasToBlob(canvas, outputMimeType, quality);

  if (blob.size >= file.size) {
    return {
      file,
      mimeType: detectedMimeType,
      extension: detectedMimeType === "image/png" ? "png" : "jpg",
      originalSize: file.size,
      compressedSize: file.size,
      wasCompressed: false,
    };
  }

  const extension = outputMimeType === "image/png" ? "png" : "jpg";
  const basename = file.name.replace(/\.[^.]+$/, "") || "image";
  const compressedFile = new File([blob], `${basename}.${extension}`, {
    type: outputMimeType,
    lastModified: Date.now(),
  });

  return {
    file: compressedFile,
    mimeType: outputMimeType,
    extension,
    originalSize: file.size,
    compressedSize: compressedFile.size,
    wasCompressed: true,
  };
};

export const getSupabaseTransformedImageUrl = (
  publicUrl: string,
  options: SupabaseImageTransformOptions,
) => {
  try {
    const url = new URL(publicUrl);
    const objectPathIndex = url.pathname.indexOf(SUPABASE_PUBLIC_OBJECT_PATH);

    if (objectPathIndex === -1) return publicUrl;

    const storagePath = url.pathname.slice(
      objectPathIndex + SUPABASE_PUBLIC_OBJECT_PATH.length,
    );

    url.pathname = `${SUPABASE_PUBLIC_RENDER_PATH}${storagePath}`;
    url.search = "";

    if (options.width) url.searchParams.set("width", String(options.width));
    if (options.height) url.searchParams.set("height", String(options.height));
    if (options.quality) url.searchParams.set("quality", String(options.quality));
    if (options.resize) url.searchParams.set("resize", options.resize);

    return url.toString();
  } catch {
    return publicUrl;
  }
};
