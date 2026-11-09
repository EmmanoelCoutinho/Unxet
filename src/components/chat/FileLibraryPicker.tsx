import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpenIcon, SearchIcon, SendIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { CloseButton } from "../ui/CloseButton";
import { FileThumb } from "../files/FileThumb";
import { useFileLibrary } from "../../hooks/useFileLibrary";
import {
  formatBytes,
  KIND_LABEL,
  listConversationFiles,
  type ConversationFile,
  type FileKind,
} from "../../services/fileLibrary";

/** Arquivo escolhido no seletor, pronto para enviar. */
export type PickedFile = {
  kind: FileKind;
  url: string;
  mimeType: string | null;
  /** Nome com extensão que o cliente vê no documento */
  filename: string;
  fileSize: number | null;
};

type Props = {
  open: boolean;
  clinicId: string | null | undefined;
  onClose: () => void;
  onSelect: (file: PickedFile) => void;
};

type Tab = "library" | "sent";

const ALL = "";
// Quantos envios recentes buscar (antes de juntar arquivos repetidos)
const RECENT_FETCH = 100;

const extensionOf = (value: string) => {
  const clean = value.split("?")[0];
  const dot = clean.lastIndexOf(".");
  const slash = clean.lastIndexOf("/");
  return dot > slash ? clean.slice(dot + 1).toLowerCase() : "";
};

const sentLabel = (file: ConversationFile) => file.filename || KIND_LABEL[file.kind];

/**
 * Enviados pela equipe nas conversas que a pessoa pode abrir. O mesmo arquivo
 * enviado várias vezes aparece uma vez só (o envio mais recente). Áudios ficam
 * de fora: quase sempre são mensagens de voz gravadas para um cliente.
 */
const useRecentSent = (open: boolean, enabled: boolean) => {
  const [files, setFiles] = useState<ConversationFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listConversationFiles({ direction: "outbound" }, null, RECENT_FETCH);
      const seen = new Set<string>();
      setFiles(
        rows.filter((row) => {
          if (row.kind === "audio" || seen.has(row.url)) return false;
          seen.add(row.url);
          return true;
        }),
      );
      setLoaded(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os arquivos.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Busca de novo a cada vez que o seletor abre na aba
  useEffect(() => {
    if (!open) {
      setLoaded(false);
      setError(null);
    }
  }, [open]);

  // Com erro, só tenta de novo pelo botão
  useEffect(() => {
    if (open && enabled && !loaded && !loading && !error) void load();
  }, [open, enabled, loaded, loading, error, load]);

  return { files, loading: loading || (open && enabled && !loaded && !error), error, reload: load };
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
      active
        ? "border-blue-600 text-blue-600"
        : "border-transparent text-slate-500 hover:text-slate-800"
    }`}
  >
    {children}
  </button>
);

/** Escolhe um arquivo da biblioteca ou um enviado recentemente para mandar na conversa. */
export const FileLibraryPicker: React.FC<Props> = ({ open, clinicId, onClose, onSelect }) => {
  const [tab, setTab] = useState<Tab>("library");
  // Só carrega quando abre; reabrir busca de novo para trazer arquivos novos
  const library = useFileLibrary(clinicId, open);
  const recent = useRecentSent(open, tab === "sent");
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState(ALL);

  useEffect(() => {
    if (open) {
      setTab("library");
      setSearch("");
      setFolder(ALL);
    }
  }, [open]);

  const folders = useMemo(
    () =>
      Array.from(new Set(library.files.map((f) => f.folder).filter((f): f is string => !!f))).sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [library.files],
  );

  const term = search.trim().toLowerCase();

  const filteredLibrary = useMemo(
    () =>
      library.files.filter((file) => {
        if (folder && file.folder !== folder) return false;
        if (!term) return true;
        return [file.name, file.folder, file.description]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      }),
    [library.files, folder, term],
  );

  const filteredSent = useMemo(
    () =>
      recent.files.filter((file) => {
        if (!term) return true;
        return [file.filename, file.contactName, file.contactPhone]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      }),
    [recent.files, term],
  );

  if (!open) return null;

  const pick = (file: PickedFile) => {
    onSelect(file);
    onClose();
  };

  const skeleton = (
    <div className="space-y-2 p-1">
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-14 animate-pulse rounded-xl bg-slate-100" />
      ))}
    </div>
  );

  const errorBox = (message: string, retry: () => void) => (
    <div className="px-4 py-8 text-center">
      <p className="text-sm text-slate-600">{message}</p>
      <button type="button" onClick={retry} className="mt-2 text-sm font-medium text-blue-600">
        Tentar novamente
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 flex max-h-[90dvh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Banco de arquivos</h3>
            <p className="mt-1 text-sm text-slate-500">Escolha um arquivo para enviar nesta conversa.</p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="mt-2 flex border-b border-slate-100 px-3">
          <TabButton active={tab === "library"} onClick={() => setTab("library")}>
            Biblioteca
          </TabButton>
          <TabButton active={tab === "sent"} onClick={() => setTab("sent")}>
            Enviados recentemente
          </TabButton>
        </div>

        <div className="space-y-2 border-b border-slate-100 px-4 py-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tab === "library" ? "Buscar arquivo" : "Buscar por arquivo ou cliente"}
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {tab === "library" && folders.length > 0 && (
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
          {tab === "sent" && (
            <p className="text-xs text-slate-500">
              Imagens e documentos que a equipe já mandou nas conversas que você pode abrir.
            </p>
          )}
        </div>

        <div className="min-h-0 max-h-[360px] flex-1 overflow-y-auto px-3 py-3">
          {tab === "library" ? (
            library.error ? (
              errorBox(library.error, library.refetch)
            ) : library.loading && library.files.length === 0 ? (
              skeleton
            ) : library.files.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                  <FolderOpenIcon className="h-6 w-6 text-slate-500" />
                </div>
                <p className="mt-4 text-sm font-medium text-slate-800">Nenhum arquivo na biblioteca</p>
                <p className="mt-1 text-sm text-slate-500">
                  Adicione arquivos na tela{" "}
                  <Link to="/inbox/files" onClick={onClose} className="font-medium text-blue-600 hover:underline">
                    Banco de arquivos
                  </Link>{" "}
                  ou veja os enviados recentemente.
                </p>
              </div>
            ) : filteredLibrary.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Nenhum arquivo encontrado.</p>
            ) : (
              <div className="space-y-1">
                {filteredLibrary.map((file) => {
                  const extension = extensionOf(file.storagePath);
                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() =>
                        pick({
                          kind: file.kind,
                          url: file.url,
                          mimeType: file.mimeType,
                          filename: extension ? `${file.name}.${extension}` : file.name,
                          fileSize: file.fileSize,
                        })
                      }
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-blue-50"
                    >
                      <FileThumb kind={file.kind} url={file.url} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{file.name}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {[file.folder, KIND_LABEL[file.kind], formatBytes(file.fileSize)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )
          ) : recent.error ? (
            errorBox(recent.error, recent.reload)
          ) : recent.loading ? (
            skeleton
          ) : recent.files.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <SendIcon className="h-6 w-6 text-slate-500" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-800">Nenhum arquivo enviado ainda</p>
              <p className="mt-1 text-sm text-slate-500">
                Imagens e documentos enviados nas conversas aparecem aqui.
              </p>
            </div>
          ) : filteredSent.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Nenhum arquivo encontrado.</p>
          ) : (
            <div className="space-y-1">
              {filteredSent.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() =>
                    pick({
                      kind: file.kind,
                      url: file.url,
                      mimeType: file.mimeType,
                      filename: file.filename || `arquivo${extensionOf(file.url) ? `.${extensionOf(file.url)}` : ""}`,
                      fileSize: file.fileSize,
                    })
                  }
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-blue-50"
                >
                  <FileThumb kind={file.kind} url={file.url} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{sentLabel(file)}</span>
                    <span className="block truncate text-xs text-slate-500">
                      Para {file.contactName || file.contactPhone || "cliente"} ·{" "}
                      {new Date(file.createdAt).toLocaleDateString("pt-BR")}
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
