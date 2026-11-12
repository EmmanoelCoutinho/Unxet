import { supabase } from "../lib/supabaseClient";

// Banco de arquivos: biblioteca da empresa (file_library) e arquivos das
// conversas (list_conversation_files). Migration 20261113000000_file_library.

export type FileKind = "image" | "audio" | "video" | "document";

export type LibraryFile = {
  id: string;
  clinicId: string;
  name: string;
  description: string | null;
  folder: string | null;
  storagePath: string;
  url: string;
  mimeType: string | null;
  kind: FileKind;
  fileSize: number | null;
  sourceMessageId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationFile = {
  id: string;
  conversationId: string;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  direction: "inbound" | "outbound";
  kind: FileKind;
  url: string;
  mimeType: string | null;
  filename: string | null;
  fileSize: number | null;
  createdAt: string;
};

const BUCKET = "whatsapp-media";
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

// Limites do WhatsApp
export const MAX_LIBRARY_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_LIBRARY_AUDIO_BYTES = 16 * 1024 * 1024;
export const MAX_LIBRARY_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSION_MIME: Record<string, { mime: string; kind: FileKind }> = {
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  png: { mime: "image/png", kind: "image" },
  mp3: { mime: "audio/mpeg", kind: "audio" },
  m4a: { mime: "audio/mp4", kind: "audio" },
  aac: { mime: "audio/aac", kind: "audio" },
  amr: { mime: "audio/amr", kind: "audio" },
  ogg: { mime: "audio/ogg", kind: "audio" },
  mp4: { mime: "video/mp4", kind: "video" },
  "3gp": { mime: "video/3gpp", kind: "video" },
  txt: { mime: "text/plain", kind: "document" },
  pdf: { mime: "application/pdf", kind: "document" },
  xml: { mime: "application/xml", kind: "document" },
  doc: { mime: "application/msword", kind: "document" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
  },
  xls: { mime: "application/vnd.ms-excel", kind: "document" },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "document",
  },
  ppt: { mime: "application/vnd.ms-powerpoint", kind: "document" },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "document",
  },
};

/** Valor do atributo accept do campo de arquivo. */
export const LIBRARY_ACCEPT = Object.keys(EXTENSION_MIME)
  .map((ext) => `.${ext}`)
  .join(",");

export const LIBRARY_ACCEPTED_LABEL =
  "imagens JPG ou PNG (até 5 MB), áudios MP3, M4A, AAC, AMR ou OGG (até 16 MB), vídeos MP4 e documentos PDF, TXT, XML, Word, Excel ou PowerPoint (até 100 MB)";

/**
 * Content-Type gravado no Storage. XML fica como texto puro: a API oficial
 * do WhatsApp só baixa documentos de tipos que ela conhece (texto é um
 * deles) e o navegador não interpreta o arquivo ao abrir o link. O cliente
 * recebe o arquivo com o nome e a extensão .xml normalmente.
 */
export const storageContentType = (mime: string) => {
  const base = mime.toLowerCase().split(";")[0].trim();
  return base === "application/xml" || base === "text/xml" ? "text/plain" : mime;
};

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** Tipo e mime de um arquivo que a empresa quer subir (ou o motivo de recusar). */
export const classifyLibraryFile = (
  file: File,
): { ok: true; kind: FileKind; mimeType: string; extension: string } | { ok: false; reason: string } => {
  const extension = extensionOf(file.name);
  const known = EXTENSION_MIME[extension];
  if (!known) {
    return { ok: false, reason: `Formato não aceito. Aceitamos ${LIBRARY_ACCEPTED_LABEL}.` };
  }
  const limit =
    known.kind === "image"
      ? MAX_LIBRARY_IMAGE_BYTES
      : known.kind === "audio"
        ? MAX_LIBRARY_AUDIO_BYTES
        : MAX_LIBRARY_FILE_BYTES;
  if (file.size > limit) {
    return { ok: false, reason: `Arquivo maior que ${formatBytes(limit)}.` };
  }
  if (file.size === 0) return { ok: false, reason: "O arquivo está vazio." };
  return { ok: true, kind: known.kind, mimeType: file.type || known.mime, extension };
};

export const kindFromMime = (mime: string | null | undefined, fallback: FileKind = "document"): FileKind => {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return fallback;
};

export const formatBytes = (bytes: number | null | undefined) => {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace(".", ",") : Math.round(mb)} MB`;
};

export const KIND_LABEL: Record<FileKind, string> = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
};

/** Caminho no bucket a partir da URL gravada no banco (ou null se não for nosso). */
export const storagePathFromUrl = (url: string | null | undefined): string | null => {
  if (!url || !SUPABASE_URL || !url.startsWith(PUBLIC_PREFIX)) return null;
  const path = decodeURIComponent(url.slice(PUBLIC_PREFIX.length).split("?")[0]);
  if (!path || path.split("/").some((part) => part === ".." || part === "")) return null;
  return path;
};

/** Nome sem a extensão, para sugerir o nome do arquivo na biblioteca. */
export const nameWithoutExtension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim();
};

type LibraryRow = {
  id: string;
  clinic_id: string;
  name: string;
  description: string | null;
  folder: string | null;
  storage_path: string;
  url: string;
  mime_type: string | null;
  kind: FileKind;
  file_size: number | null;
  source_message_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const LIBRARY_COLUMNS =
  "id, clinic_id, name, description, folder, storage_path, url, mime_type, kind, file_size, source_message_id, created_by, created_at, updated_at";

const mapLibrary = (row: LibraryRow): LibraryFile => ({
  id: row.id,
  clinicId: row.clinic_id,
  name: row.name,
  description: row.description,
  folder: row.folder,
  storagePath: row.storage_path,
  url: row.url,
  mimeType: row.mime_type,
  kind: row.kind,
  fileSize: row.file_size,
  sourceMessageId: row.source_message_id,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const friendlyError = (error: { code?: string; message?: string } | null) => {
  if (!error) return new Error("Não foi possível concluir.");
  if (error.code === "23505") return new Error("Este arquivo já está no Banco de arquivos.");
  if (error.code === "42501") return new Error("Você não tem permissão para esta ação.");
  return new Error(error.message || "Não foi possível concluir.");
};

export const listLibraryFiles = async (clinicId: string) => {
  const { data, error } = await supabase
    .from("file_library")
    .select(LIBRARY_COLUMNS)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw friendlyError(error);
  return ((data ?? []) as LibraryRow[]).map(mapLibrary);
};

/** Sobe o arquivo para a pasta da empresa e cadastra na biblioteca. */
export const uploadLibraryFile = async (params: {
  clinicId: string;
  file: File;
  name: string;
  description?: string;
  folder?: string;
}) => {
  const check = classifyLibraryFile(params.file);
  if (!check.ok) throw new Error(check.reason);

  const random = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${params.clinicId}/library/${random}.${check.extension}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, params.file, {
    cacheControl: "3600",
    upsert: false,
    contentType: storageContentType(check.mimeType),
  });
  if (uploadError) throw new Error("Não foi possível enviar o arquivo. Tente de novo.");

  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  const { data, error } = await supabase
    .from("file_library")
    .insert({
      clinic_id: params.clinicId,
      name: params.name.trim(),
      description: params.description?.trim() || null,
      folder: params.folder?.trim() || null,
      storage_path: path,
      url: publicData.publicUrl,
      mime_type: check.mimeType,
      kind: check.kind,
      file_size: params.file.size,
    })
    .select(LIBRARY_COLUMNS)
    .single();
  if (error) throw friendlyError(error);
  return mapLibrary(data as LibraryRow);
};

/** Guarda na biblioteca um arquivo que já veio de uma conversa (sem copiar). */
export const saveConversationFileToLibrary = async (params: {
  clinicId: string;
  file: ConversationFile;
  name: string;
  description?: string;
  folder?: string;
}) => {
  const path = storagePathFromUrl(params.file.url);
  if (!path) throw new Error("Este arquivo não pode ser salvo na biblioteca.");

  const { data, error } = await supabase
    .from("file_library")
    .insert({
      clinic_id: params.clinicId,
      name: params.name.trim(),
      description: params.description?.trim() || null,
      folder: params.folder?.trim() || null,
      storage_path: path,
      url: params.file.url,
      mime_type: params.file.mimeType,
      kind: params.file.kind,
      file_size: params.file.fileSize,
      source_message_id: params.file.id,
    })
    .select(LIBRARY_COLUMNS)
    .single();
  if (error) throw friendlyError(error);
  return mapLibrary(data as LibraryRow);
};

export const updateLibraryFile = async (params: {
  clinicId: string;
  id: string;
  name: string;
  description?: string;
  folder?: string;
}) => {
  const { data, error } = await supabase
    .from("file_library")
    .update({
      name: params.name.trim(),
      description: params.description?.trim() || null,
      folder: params.folder?.trim() || null,
    })
    .eq("id", params.id)
    .eq("clinic_id", params.clinicId)
    .select(LIBRARY_COLUMNS)
    .single();
  if (error) throw friendlyError(error);
  return mapLibrary(data as LibraryRow);
};

export const deleteLibraryFile = async (params: { clinicId: string; id: string }) => {
  const { error } = await supabase
    .from("file_library")
    .delete()
    .eq("id", params.id)
    .eq("clinic_id", params.clinicId);
  if (error) throw friendlyError(error);
};

type ConversationFileRow = {
  id: string;
  conversation_id: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  direction: "inbound" | "outbound";
  kind: FileKind;
  url: string;
  mime_type: string | null;
  filename: string | null;
  file_size: number | null;
  created_at: string;
};

export type ConversationFilesFilters = {
  kind?: FileKind | null;
  direction?: "inbound" | "outbound" | null;
  search?: string;
  from?: string | null;
  to?: string | null;
  /** Só os arquivos deste cliente */
  contactId?: string | null;
};

export const CONVERSATION_FILES_PAGE = 50;

export const listConversationFiles = async (
  filters: ConversationFilesFilters,
  cursor?: { createdAt: string; id: string } | null,
  limit: number = CONVERSATION_FILES_PAGE,
) => {
  const { data, error } = await supabase.rpc("list_conversation_files", {
    p_kind: filters.kind ?? null,
    p_direction: filters.direction ?? null,
    p_search: filters.search?.trim() || null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: limit,
    // Só manda quando filtra por cliente (migration 20261114100000)
    ...(filters.contactId ? { p_contact_id: filters.contactId } : {}),
  });
  if (error) throw friendlyError(error);
  return ((data ?? []) as ConversationFileRow[]).map(
    (row): ConversationFile => ({
      id: row.id,
      conversationId: row.conversation_id,
      contactId: row.contact_id,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      direction: row.direction,
      kind: row.kind,
      url: row.url,
      mimeType: row.mime_type,
      filename: row.filename,
      fileSize: row.file_size,
      createdAt: row.created_at,
    }),
  );
};
