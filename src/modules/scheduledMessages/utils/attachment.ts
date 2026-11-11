import { supabase } from "../../../lib/supabaseClient";
import { classifyLibraryFile, type FileKind } from "../../../services/fileLibrary";

// Anexo de uma mensagem agendada (Carteira e cartão do Funil). Migration
// 20261114000000_scheduled_message_media.

export type ScheduledAttachment = {
  url: string;
  kind: FileKind;
  mimeType: string | null;
  filename: string;
};

// Na tela: arquivo já salvo (do Banco de arquivos ou de uma edição) ou um
// arquivo do computador que só sobe ao salvar
export type AttachmentDraft =
  | { source: "saved"; attachment: ScheduledAttachment }
  | { source: "local"; file: File; kind: FileKind; mimeType: string; extension: string };

const BUCKET = "whatsapp-media";

/** Confere o arquivo escolhido no computador (mesmos formatos e limites do Banco de arquivos). */
export const draftFromFile = (file: File): { ok: true; draft: AttachmentDraft } | { ok: false; reason: string } => {
  const check = classifyLibraryFile(file);
  if (!check.ok) return check;
  return {
    ok: true,
    draft: { source: "local", file, kind: check.kind, mimeType: check.mimeType, extension: check.extension },
  };
};

export const draftLabel = (draft: AttachmentDraft) =>
  draft.source === "saved" ? draft.attachment.filename : draft.file.name;

export const draftKind = (draft: AttachmentDraft) =>
  draft.source === "saved" ? draft.attachment.kind : draft.kind;

/** Sobe o arquivo do computador (se for o caso) e devolve o anexo para salvar. */
export const resolveAttachment = async (
  clinicId: string | null,
  draft: AttachmentDraft | null,
): Promise<ScheduledAttachment | null> => {
  if (!draft) return null;
  if (draft.source === "saved") return draft.attachment;
  if (!clinicId) throw new Error("Empresa não identificada para enviar o arquivo.");

  const random = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${clinicId}/scheduled/${random}.${draft.extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, draft.file, {
    cacheControl: "3600",
    upsert: false,
    contentType: draft.mimeType,
  });
  if (error) throw new Error("Não foi possível enviar o arquivo. Tente de novo.");

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return {
    url: data.publicUrl,
    kind: draft.kind,
    mimeType: draft.mimeType,
    filename: draft.file.name.slice(0, 200),
  };
};

/** Parâmetros do anexo nas funções do banco (todos nulos sem anexo). */
export const attachmentParams = (attachment: ScheduledAttachment | null) => ({
  p_media_url: attachment?.url ?? null,
  p_media_mime_type: attachment?.mimeType ?? null,
  p_media_filename: attachment?.filename ?? null,
  p_media_kind: attachment?.kind ?? null,
});

/** Anexo gravado no banco (colunas media_*), ou null. */
export const attachmentFromRow = (row: {
  media_url?: string | null;
  media_kind?: string | null;
  media_mime_type?: string | null;
  media_filename?: string | null;
}): ScheduledAttachment | null => {
  if (!row.media_url || !row.media_kind) return null;
  return {
    url: row.media_url,
    kind: row.media_kind as FileKind,
    mimeType: row.media_mime_type ?? null,
    filename: row.media_filename ?? "Arquivo",
  };
};
