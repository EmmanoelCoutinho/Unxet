import React, { useEffect, useId, useRef, useState } from "react";
import { UploadCloudIcon } from "lucide-react";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";
import { FileThumb } from "./FileThumb";
import {
  classifyLibraryFile,
  formatBytes,
  LIBRARY_ACCEPT,
  LIBRARY_ACCEPTED_LABEL,
  nameWithoutExtension,
  type FileKind,
} from "../../services/fileLibrary";

export type LibraryFileFormValues = {
  file?: File;
  name: string;
  folder: string;
  description: string;
};

type Props = {
  open: boolean;
  /** upload: escolhe o arquivo; edit/save: arquivo já existe */
  mode: "upload" | "edit" | "save";
  initial?: Partial<LibraryFileFormValues>;
  /** Arquivo já existente (edit/save) para mostrar a miniatura */
  existing?: { kind: FileKind; url: string; label: string } | null;
  folders: string[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: LibraryFileFormValues) => void;
};

const TITLES = {
  upload: "Adicionar arquivo",
  edit: "Editar arquivo",
  save: "Salvar na biblioteca",
};

const SUBTITLES = {
  upload: "Fica disponível para toda a equipe enviar pelo + da conversa.",
  edit: "O arquivo continua o mesmo; mude só como ele aparece na biblioteca.",
  save: "O arquivo da conversa passa a aparecer no + da conversa para toda a equipe.",
};

export const LibraryFileFormModal: React.FC<Props> = ({
  open,
  mode,
  initial,
  existing,
  folders,
  saving,
  onClose,
  onSubmit,
}) => {
  const [file, setFile] = useState<File | undefined>();
  const [fileError, setFileError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [description, setDescription] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const foldersListId = useId();

  useEffect(() => {
    if (!open) return;
    setFile(undefined);
    setFileError(null);
    setName(initial?.name ?? "");
    setFolder(initial?.folder ?? "");
    setDescription(initial?.description ?? "");
    setDragging(false);
  }, [open, initial?.name, initial?.folder, initial?.description]);

  if (!open) return null;

  const pickFile = (picked: File | undefined) => {
    if (!picked) return;
    const check = classifyLibraryFile(picked);
    if (!check.ok) {
      setFile(undefined);
      setFileError(check.reason);
      return;
    }
    setFileError(null);
    setFile(picked);
    if (!name.trim()) setName(nameWithoutExtension(picked.name).slice(0, 120));
  };

  const pickedKind = file ? (classifyLibraryFile(file) as { kind?: FileKind }).kind : undefined;
  const canSubmit =
    !saving && name.trim().length > 0 && (mode !== "upload" || (!!file && !fileError));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ file, name, folder, description });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-3 py-4 sm:px-4">
      <form
        onSubmit={handleSubmit}
        className="max-h-full w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 shadow-lg sm:p-6"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{TITLES[mode]}</h2>
            <p className="mt-1 text-sm text-slate-500">{SUBTITLES[mode]}</p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="mt-5 space-y-4">
          {mode === "upload" ? (
            <div>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  pickFile(event.dataTransfer.files?.[0]);
                }}
                className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ${
                  dragging
                    ? "border-blue-400 bg-blue-50"
                    : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"
                }`}
              >
                {file && pickedKind ? (
                  <div className="flex w-full items-center gap-3 text-left">
                    <FileThumb kind={pickedKind} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
                      <p className="text-xs text-slate-500">
                        {formatBytes(file.size)} · clique para trocar
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <UploadCloudIcon className="h-8 w-8 text-slate-400" />
                    <span className="text-sm font-medium text-slate-700">
                      Clique para escolher ou arraste o arquivo aqui
                    </span>
                    <span className="text-xs text-slate-500">Aceitamos {LIBRARY_ACCEPTED_LABEL}.</span>
                  </>
                )}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={LIBRARY_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  pickFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              {fileError && <p className="mt-2 text-sm text-red-600">{fileError}</p>}
            </div>
          ) : existing ? (
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <FileThumb kind={existing.kind} url={existing.url} />
              <p className="min-w-0 truncate text-sm text-slate-700">{existing.label}</p>
            </div>
          ) : null}

          <div>
            <label className="block text-sm font-medium text-slate-800" htmlFor="library-file-name">
              Nome
            </label>
            <input
              id="library-file-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Tabela de preços 2026"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <p className="mt-1 text-xs text-slate-500">
              É o nome que o cliente vê no documento enviado.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-800" htmlFor="library-file-folder">
              Pasta <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="library-file-folder"
              list={foldersListId}
              value={folder}
              maxLength={60}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="Ex.: Contratos"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <datalist id={foldersListId}>
              {folders.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-800" htmlFor="library-file-description">
              Descrição <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <textarea
              id="library-file-description"
              value={description}
              maxLength={500}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Quando usar este arquivo"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!canSubmit} className="rounded-full">
            {saving ? "Salvando..." : mode === "upload" ? "Adicionar" : "Salvar"}
          </Button>
        </div>
      </form>
    </div>
  );
};
