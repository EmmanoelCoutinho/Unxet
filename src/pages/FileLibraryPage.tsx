import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  BookmarkPlusIcon,
  ExternalLinkIcon,
  FolderIcon,
  FolderOpenIcon,
  MessageCircleIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../contexts/ClinicContext";
import { useFileLibrary } from "../hooks/useFileLibrary";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { FileThumb } from "../components/files/FileThumb";
import {
  LibraryFileFormModal,
  type LibraryFileFormValues,
} from "../components/files/LibraryFileFormModal";
import {
  CONVERSATION_FILES_PAGE,
  formatBytes,
  KIND_LABEL,
  listConversationFiles,
  nameWithoutExtension,
  saveConversationFileToLibrary,
  storagePathFromUrl,
  updateLibraryFile,
  uploadLibraryFile,
  type ConversationFile,
  type FileKind,
  type LibraryFile,
} from "../services/fileLibrary";
import { openMediaFile } from "../lib/openMediaFile";

type Tab = "library" | "conversations";
type Period = "7" | "30" | "90" | "all";

const NO_FOLDER = "__none__";

const selectClass =
  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const IconAction: React.FC<{
  label: string;
  onClick: () => void;
  icon: React.ElementType;
  danger?: boolean;
  disabled?: boolean;
}> = ({ label, onClick, icon: Icon, danger, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      danger
        ? "text-red-500 hover:bg-red-50"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
    }`}
  >
    <Icon className="h-4 w-4" />
  </button>
);

type FormState =
  | { mode: "upload" }
  | { mode: "edit"; file: LibraryFile }
  | { mode: "save"; file: ConversationFile }
  | null;

export const FileLibraryPage: React.FC = () => {
  const { clinicId, can } = useClinic();
  const canManage = can("file_library.manage");
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>("library");
  const library = useFileLibrary(clinicId);
  const [form, setForm] = useState<FormState>(null);
  const [saving, setSaving] = useState(false);

  // Filtros da biblioteca
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<FileKind | "">("");

  const folders = useMemo(
    () =>
      Array.from(
        new Set(library.files.map((file) => file.folder).filter((f): f is string => !!f)),
      ).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [library.files],
  );

  const libraryUrls = useMemo(
    () => new Set(library.files.map((file) => file.url)),
    [library.files],
  );

  const filteredLibrary = useMemo(() => {
    const term = search.trim().toLowerCase();
    return library.files.filter((file) => {
      if (kindFilter && file.kind !== kindFilter) return false;
      if (folderFilter === NO_FOLDER && file.folder) return false;
      if (folderFilter && folderFilter !== NO_FOLDER && file.folder !== folderFilter) return false;
      if (!term) return true;
      return [file.name, file.folder, file.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [library.files, search, folderFilter, kindFilter]);

  // Arquivos das conversas
  const [convSearch, setConvSearch] = useState("");
  const [convSearchDebounced, setConvSearchDebounced] = useState("");
  const [convKind, setConvKind] = useState<FileKind | "">("");
  const [convDirection, setConvDirection] = useState<"" | "inbound" | "outbound">("");
  const [convPeriod, setConvPeriod] = useState<Period>("30");
  const [convFiles, setConvFiles] = useState<ConversationFile[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [convLoadingMore, setConvLoadingMore] = useState(false);
  const [convHasMore, setConvHasMore] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setConvSearchDebounced(convSearch), 350);
    return () => clearTimeout(timer);
  }, [convSearch]);

  const convFilters = useMemo(() => {
    const from =
      convPeriod === "all"
        ? null
        : new Date(Date.now() - Number(convPeriod) * 24 * 60 * 60 * 1000).toISOString();
    return {
      kind: convKind || null,
      direction: convDirection || null,
      search: convSearchDebounced,
      from,
    };
  }, [convKind, convDirection, convSearchDebounced, convPeriod]);

  const loadConversationFiles = useCallback(async () => {
    setConvLoading(true);
    setConvError(null);
    try {
      const rows = await listConversationFiles(convFilters);
      setConvFiles(rows);
      setConvHasMore(rows.length === CONVERSATION_FILES_PAGE);
    } catch (err: any) {
      setConvError(err?.message ?? "Não foi possível carregar os arquivos.");
    } finally {
      setConvLoading(false);
    }
  }, [convFilters]);

  useEffect(() => {
    if (tab === "conversations") void loadConversationFiles();
  }, [tab, loadConversationFiles]);

  const loadMore = async () => {
    const last = convFiles[convFiles.length - 1];
    if (!last) return;
    setConvLoadingMore(true);
    try {
      const rows = await listConversationFiles(convFilters, { createdAt: last.createdAt, id: last.id });
      setConvFiles((current) => [...current, ...rows]);
      setConvHasMore(rows.length === CONVERSATION_FILES_PAGE);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível carregar mais arquivos.");
    } finally {
      setConvLoadingMore(false);
    }
  };

  const handleSubmit = async (values: LibraryFileFormValues) => {
    if (!clinicId || !form) return;
    setSaving(true);
    const fields = { name: values.name, folder: values.folder, description: values.description };
    try {
      if (form.mode === "upload" && values.file) {
        library.upsertLocal(await uploadLibraryFile({ clinicId, file: values.file, ...fields }));
        toast.success("Arquivo adicionado ao Banco de arquivos.");
      } else if (form.mode === "edit") {
        library.upsertLocal(await updateLibraryFile({ clinicId, id: form.file.id, ...fields }));
        toast.success("Arquivo atualizado.");
      } else if (form.mode === "save") {
        library.upsertLocal(
          await saveConversationFileToLibrary({ clinicId, file: form.file, ...fields }),
        );
        toast.success("Arquivo salvo na biblioteca.");
      }
      setForm(null);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (file: LibraryFile) => {
    const ok = await confirm({
      title: "Excluir da biblioteca?",
      description: `"${file.name}" deixa de aparecer no + da conversa. Mensagens em que ele já foi enviado continuam com o arquivo.`,
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await library.remove(file.id);
      toast.success("Arquivo excluído da biblioteca.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível excluir.");
    }
  };

  const formInitial = useMemo(() => {
    if (!form || form.mode === "upload") return undefined;
    if (form.mode === "edit") {
      return {
        name: form.file.name,
        folder: form.file.folder ?? "",
        description: form.file.description ?? "",
      };
    }
    const base = form.file.filename
      ? nameWithoutExtension(form.file.filename)
      : `${KIND_LABEL[form.file.kind]} de ${form.file.contactName || form.file.contactPhone || "cliente"}`;
    return { name: base.slice(0, 120), folder: "", description: "" };
  }, [form]);

  const formExisting = useMemo(() => {
    if (!form || form.mode === "upload") return null;
    if (form.mode === "edit") {
      return { kind: form.file.kind, url: form.file.url, label: form.file.name };
    }
    return {
      kind: form.file.kind,
      url: form.file.url,
      label: form.file.filename || KIND_LABEL[form.file.kind],
    };
  }, [form]);

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        tab === value ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b bg-white px-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <PreTitleIcon icon={FolderOpenIcon} />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Banco de arquivos</h1>
              <p className="mt-1 text-sm text-gray-500">
                Arquivos da Empresa para enviar pelo <span className="font-semibold">+</span> da
                conversa, e tudo o que já foi enviado e recebido nas conversas.
              </p>
            </div>
          </div>

          {canManage && (
            <Button type="button" onClick={() => setForm({ mode: "upload" })} className="rounded-full">
              <span className="flex items-center gap-2">
                <PlusIcon className="h-4 w-4" />
                Adicionar arquivo
              </span>
            </Button>
          )}
        </div>

        <div className="mt-5 flex gap-1">
          {tabButton("library", "Biblioteca")}
          {tabButton("conversations", "Das conversas")}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        {tab === "library" ? (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <div className="relative min-w-[200px] flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por nome, pasta ou descrição"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <select
                value={folderFilter}
                onChange={(event) => setFolderFilter(event.target.value)}
                className={selectClass}
                aria-label="Pasta"
              >
                <option value="">Todas as pastas</option>
                {folders.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
                <option value={NO_FOLDER}>Sem pasta</option>
              </select>
              <select
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as FileKind | "")}
                className={selectClass}
                aria-label="Tipo"
              >
                <option value="">Todos os tipos</option>
                {(Object.keys(KIND_LABEL) as FileKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </div>

            {library.error ? (
              <Card className="p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-gray-900">Não foi possível carregar</h2>
                <p className="mt-2 text-sm text-gray-500">{library.error}</p>
                <Button type="button" variant="ghost" onClick={library.refetch} className="mt-4">
                  Tentar novamente
                </Button>
              </Card>
            ) : library.loading && library.files.length === 0 ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white" />
                ))}
              </div>
            ) : library.files.length === 0 ? (
              <Card className="rounded-2xl p-5 text-center sm:p-8">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                  <FolderOpenIcon className="h-6 w-6 text-slate-500" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-gray-900">Nenhum arquivo na biblioteca</h2>
                <p className="mt-2 text-sm text-gray-500">
                  {canManage
                    ? "Adicione tabelas de preço, contratos, catálogos e orientações para a equipe enviar sem procurar no computador."
                    : "Quem administra a Empresa pode adicionar arquivos aqui para a equipe enviar nas conversas."}
                </p>
                {canManage && (
                  <Button type="button" onClick={() => setForm({ mode: "upload" })} className="mt-6 rounded-full">
                    Adicionar o primeiro arquivo
                  </Button>
                )}
              </Card>
            ) : filteredLibrary.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">Nenhum arquivo com esses filtros.</p>
            ) : (
              <div className="space-y-2">
                {filteredLibrary.map((file) => (
                  <Card key={file.id} className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                    <div className="flex items-start gap-3">
                      <FileThumb kind={file.kind} url={file.url} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{file.name}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                          {file.folder && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                              <FolderIcon className="h-3 w-3" />
                              {file.folder}
                            </span>
                          )}
                          <span>{KIND_LABEL[file.kind]}</span>
                          {file.fileSize ? <span>· {formatBytes(file.fileSize)}</span> : null}
                          <span>· {formatDate(file.createdAt)}</span>
                        </p>
                        {file.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{file.description}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center">
                        <IconAction label="Abrir" icon={ExternalLinkIcon} onClick={() => openMediaFile(file.url)} />
                        {canManage && (
                          <>
                            <IconAction label="Editar" icon={PencilIcon} onClick={() => setForm({ mode: "edit", file })} />
                            <IconAction label="Excluir" icon={Trash2Icon} danger onClick={() => handleDelete(file)} />
                          </>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <div className="relative min-w-[200px] flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={convSearch}
                  onChange={(event) => setConvSearch(event.target.value)}
                  placeholder="Buscar por cliente, telefone ou nome do arquivo"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <select
                value={convDirection}
                onChange={(event) => setConvDirection(event.target.value as "" | "inbound" | "outbound")}
                className={selectClass}
                aria-label="Enviados ou recebidos"
              >
                <option value="">Enviados e recebidos</option>
                <option value="inbound">Recebidos</option>
                <option value="outbound">Enviados</option>
              </select>
              <select
                value={convKind}
                onChange={(event) => setConvKind(event.target.value as FileKind | "")}
                className={selectClass}
                aria-label="Tipo"
              >
                <option value="">Todos os tipos</option>
                {(Object.keys(KIND_LABEL) as FileKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
              <select
                value={convPeriod}
                onChange={(event) => setConvPeriod(event.target.value as Period)}
                className={selectClass}
                aria-label="Período"
              >
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
                <option value="all">Desde o início</option>
              </select>
            </div>

            <p className="mb-3 text-xs text-slate-500">
              Aparecem só os arquivos das conversas que você pode abrir.
            </p>

            {convError ? (
              <Card className="p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-gray-900">Não foi possível carregar</h2>
                <p className="mt-2 text-sm text-gray-500">{convError}</p>
                <Button type="button" variant="ghost" onClick={loadConversationFiles} className="mt-4">
                  Tentar novamente
                </Button>
              </Card>
            ) : convLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white" />
                ))}
              </div>
            ) : convFiles.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">
                Nenhum arquivo enviado ou recebido com esses filtros.
              </p>
            ) : (
              <div className="space-y-2">
                {convFiles.map((file) => {
                  const inbound = file.direction === "inbound";
                  const saved = libraryUrls.has(file.url);
                  const canSave = canManage && !saved && !!storagePathFromUrl(file.url);
                  return (
                    <Card key={file.id} className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                      <div className="flex items-start gap-3">
                        <FileThumb kind={file.kind} url={file.url} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {file.filename || KIND_LABEL[file.kind]}
                          </p>
                          <p className="mt-0.5 truncate text-sm text-slate-600">
                            {file.contactName || file.contactPhone || "Cliente"}
                            {file.contactName && file.contactPhone ? (
                              <span className="text-slate-400"> · {file.contactPhone}</span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                            <span
                              className={`inline-flex items-center gap-1 ${
                                inbound ? "text-emerald-600" : "text-blue-600"
                              }`}
                            >
                              {inbound ? (
                                <ArrowDownLeftIcon className="h-3 w-3" />
                              ) : (
                                <ArrowUpRightIcon className="h-3 w-3" />
                              )}
                              {inbound ? "Recebido" : "Enviado"}
                            </span>
                            <span>{formatDate(file.createdAt)}</span>
                            {file.fileSize ? <span>· {formatBytes(file.fileSize)}</span> : null}
                            {saved && <span className="text-slate-400">· Na biblioteca</span>}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center">
                          <IconAction label="Abrir" icon={ExternalLinkIcon} onClick={() => openMediaFile(file.url)} />
                          <IconAction
                            label="Abrir conversa"
                            icon={MessageCircleIcon}
                            onClick={() => navigate(`/inbox/chat/${file.conversationId}`)}
                          />
                          {canSave && (
                            <IconAction
                              label="Salvar na biblioteca"
                              icon={BookmarkPlusIcon}
                              onClick={() => setForm({ mode: "save", file })}
                            />
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
                {convHasMore && (
                  <div className="flex justify-center pt-2">
                    <Button type="button" variant="ghost" onClick={loadMore} disabled={convLoadingMore}>
                      {convLoadingMore ? "Carregando..." : "Carregar mais"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <LibraryFileFormModal
        open={!!form}
        mode={form?.mode ?? "upload"}
        initial={formInitial}
        existing={formExisting}
        folders={folders}
        saving={saving}
        onClose={() => !saving && setForm(null)}
        onSubmit={handleSubmit}
      />
    </div>
  );
};

export default FileLibraryPage;
