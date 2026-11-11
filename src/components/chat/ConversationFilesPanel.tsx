import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeftIcon, ArrowUpRightIcon, BookmarkPlusIcon, ExternalLinkIcon, PaperclipIcon } from "lucide-react";
import { toast } from "react-toastify";
import { CloseButton } from "../ui/CloseButton";
import { FileThumb } from "../files/FileThumb";
import { LibraryFileFormModal, type LibraryFileFormValues } from "../files/LibraryFileFormModal";
import { useClinic } from "../../contexts/ClinicContext";
import { useFileLibrary } from "../../hooks/useFileLibrary";
import { openMediaFile } from "../../lib/openMediaFile";
import {
  CONVERSATION_FILES_PAGE,
  formatBytes,
  KIND_LABEL,
  listConversationFiles,
  nameWithoutExtension,
  saveConversationFileToLibrary,
  storagePathFromUrl,
  type ConversationFile,
  type FileKind,
} from "../../services/fileLibrary";

type KindFilter = FileKind | "";

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "image", label: "Imagens" },
  { value: "document", label: "Documentos" },
  { value: "audio", label: "Áudios" },
  { value: "video", label: "Vídeos" },
];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Tudo o que foi enviado e recebido com este cliente (em qualquer conversa
 * dele que a pessoa consegue abrir), com atalho para salvar no Banco de arquivos.
 */
export const ConversationFilesPanel: React.FC<{
  open: boolean;
  contactId: string;
  contactName: string;
  onClose: () => void;
}> = ({ open, contactId, contactName, onClose }) => {
  const { clinicId, can } = useClinic();
  const canManage = can("file_library.manage");
  const library = useFileLibrary(clinicId, open);

  const [kind, setKind] = useState<KindFilter>("");
  const [files, setFiles] = useState<ConversationFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveTarget, setSaveTarget] = useState<ConversationFile | null>(null);
  const [saving, setSaving] = useState(false);

  const filters = useMemo(() => ({ kind: kind || null, contactId }), [kind, contactId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listConversationFiles(filters);
      setFiles(rows);
      setHasMore(rows.length === CONVERSATION_FILES_PAGE);
    } catch (err: any) {
      setError(err?.message ?? "Não foi possível carregar os arquivos.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) setKind("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saveTarget) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, saveTarget]);

  const loadMore = async () => {
    const last = files[files.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const rows = await listConversationFiles(filters, { createdAt: last.createdAt, id: last.id });
      setFiles((current) => [...current, ...rows]);
      setHasMore(rows.length === CONVERSATION_FILES_PAGE);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível carregar mais arquivos.");
    } finally {
      setLoadingMore(false);
    }
  };

  const libraryUrls = useMemo(() => new Set(library.files.map((file) => file.url)), [library.files]);
  const folders = useMemo(
    () =>
      Array.from(new Set(library.files.map((f) => f.folder).filter((f): f is string => !!f))).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [library.files],
  );

  const handleSave = async (values: LibraryFileFormValues) => {
    if (!clinicId || !saveTarget) return;
    setSaving(true);
    try {
      library.upsertLocal(
        await saveConversationFileToLibrary({
          clinicId,
          file: saveTarget,
          name: values.name,
          folder: values.folder,
          description: values.description,
        }),
      );
      toast.success("Arquivo salvo no Banco de arquivos.");
      setSaveTarget(null);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-files-title"
        className="absolute left-1/2 top-1/2 flex max-h-[90dvh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            <h3 id="conversation-files-title" className="text-base font-semibold text-slate-900">
              Arquivos da conversa
            </h3>
            <p className="mt-1 truncate text-sm text-slate-500">
              Enviados e recebidos com {contactName || "este cliente"}.
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* shrink-0: com muitos arquivos a lista rola, os filtros não encolhem */}
        <div className="mt-3 flex shrink-0 gap-1.5 overflow-x-auto px-5 pb-2">
          {KIND_FILTERS.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              onClick={() => setKind(option.value)}
              aria-pressed={kind === option.value}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                kind === option.value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-1 min-h-[120px] flex-1 overflow-y-auto border-t border-slate-100 px-3 py-3">
          {error ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-600">{error}</p>
              <button
                type="button"
                onClick={load}
                className="mt-3 text-sm font-medium text-blue-600 hover:underline"
              >
                Tentar novamente
              </button>
            </div>
          ) : loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-14 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <PaperclipIcon className="h-6 w-6 text-slate-500" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-800">
                {kind ? `Nenhum ${KIND_LABEL[kind].toLowerCase()} nesta conversa` : "Nenhum arquivo nesta conversa"}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Fotos, documentos, áudios e vídeos trocados com o cliente aparecem aqui.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {files.map((file) => {
                const inbound = file.direction === "inbound";
                const saved = libraryUrls.has(file.url);
                const canSave = canManage && !saved && !!storagePathFromUrl(file.url);
                return (
                  <li key={file.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50">
                    <button
                      type="button"
                      onClick={() => openMediaFile(file.url)}
                      className="shrink-0"
                      aria-label="Abrir arquivo"
                    >
                      <FileThumb kind={file.kind} url={file.url} size="sm" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {file.filename || KIND_LABEL[file.kind]}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                        <span
                          className={`inline-flex items-center gap-0.5 ${inbound ? "text-emerald-600" : "text-blue-600"}`}
                        >
                          {inbound ? <ArrowDownLeftIcon className="h-3 w-3" /> : <ArrowUpRightIcon className="h-3 w-3" />}
                          {inbound ? "Recebido" : "Enviado"}
                        </span>
                        <span>· {formatDate(file.createdAt)}</span>
                        {file.fileSize ? <span>· {formatBytes(file.fileSize)}</span> : null}
                        {saved && <span className="text-slate-400">· Na biblioteca</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        onClick={() => openMediaFile(file.url)}
                        title="Abrir"
                        aria-label="Abrir"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                      >
                        <ExternalLinkIcon className="h-4 w-4" />
                      </button>
                      {canSave && (
                        <button
                          type="button"
                          onClick={() => setSaveTarget(file)}
                          title="Salvar no Banco de arquivos"
                          aria-label="Salvar no Banco de arquivos"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                        >
                          <BookmarkPlusIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
              {hasMore && (
                <li className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="rounded-full px-4 py-1.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50 disabled:opacity-60"
                  >
                    {loadingMore ? "Carregando..." : "Carregar mais"}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      <LibraryFileFormModal
        open={!!saveTarget}
        mode="save"
        initial={
          saveTarget
            ? {
                name: (saveTarget.filename
                  ? nameWithoutExtension(saveTarget.filename)
                  : `${KIND_LABEL[saveTarget.kind]} de ${contactName || "cliente"}`
                ).slice(0, 120),
                folder: "",
                description: "",
              }
            : undefined
        }
        existing={
          saveTarget
            ? {
                kind: saveTarget.kind,
                url: saveTarget.url,
                label: saveTarget.filename || KIND_LABEL[saveTarget.kind],
              }
            : null
        }
        folders={folders}
        saving={saving}
        onClose={() => !saving && setSaveTarget(null)}
        onSubmit={handleSave}
      />
    </div>
  );
};
