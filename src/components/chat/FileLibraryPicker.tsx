import React, { useEffect, useMemo, useState } from "react";
import { FolderOpenIcon, SearchIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { CloseButton } from "../ui/CloseButton";
import { FileThumb } from "../files/FileThumb";
import { useFileLibrary } from "../../hooks/useFileLibrary";
import { formatBytes, KIND_LABEL, type LibraryFile } from "../../services/fileLibrary";

type Props = {
  open: boolean;
  clinicId: string | null | undefined;
  onClose: () => void;
  onSelect: (file: LibraryFile) => void;
  contentRef?: React.RefObject<HTMLDivElement>;
};

const ALL = "";

/** Escolhe um arquivo do Banco de arquivos para enviar na conversa. */
export const FileLibraryPicker: React.FC<Props> = ({ open, clinicId, onClose, onSelect, contentRef }) => {
  // Só carrega quando abre; reabrir busca de novo para trazer arquivos novos
  const { files, loading, error, refetch } = useFileLibrary(clinicId, open);
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState(ALL);

  useEffect(() => {
    if (open) {
      setSearch("");
      setFolder(ALL);
    }
  }, [open]);

  const folders = useMemo(
    () =>
      Array.from(new Set(files.map((f) => f.folder).filter((f): f is string => !!f))).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [files],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return files.filter((file) => {
      if (folder && file.folder !== folder) return false;
      if (!term) return true;
      return [file.name, file.folder, file.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [files, search, folder]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        ref={contentRef}
        className="absolute left-1/2 top-1/2 flex max-h-[90dvh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Banco de arquivos</h3>
            <p className="mt-1 text-sm text-slate-500">Escolha um arquivo para enviar nesta conversa.</p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="space-y-2 border-b border-slate-100 px-4 py-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar arquivo"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {folders.length > 0 && (
            <div className="flex gap-1 overflow-x-auto pb-1">
              {[ALL, ...folders].map((item) => (
                <button
                  key={item || "all"}
                  type="button"
                  onClick={() => setFolder(item)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    folder === item
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {item || "Todas"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 max-h-[360px] flex-1 overflow-y-auto px-3 py-3">
          {error ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-600">{error}</p>
              <button type="button" onClick={refetch} className="mt-2 text-sm font-medium text-blue-600">
                Tentar novamente
              </button>
            </div>
          ) : loading && files.length === 0 ? (
            <div className="space-y-2 p-1">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-14 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <FolderOpenIcon className="h-6 w-6 text-slate-500" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-800">Nenhum arquivo na biblioteca</p>
              <p className="mt-1 text-sm text-slate-500">
                Adicione arquivos na tela{" "}
                <Link to="/inbox/files" onClick={onClose} className="font-medium text-blue-600 hover:underline">
                  Banco de arquivos
                </Link>
                .
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Nenhum arquivo encontrado.</p>
          ) : (
            <div className="space-y-1">
              {filtered.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => {
                    onSelect(file);
                    onClose();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-blue-50"
                >
                  <FileThumb kind={file.kind} url={file.url} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{file.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[file.folder, KIND_LABEL[file.kind], formatBytes(file.fileSize)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
