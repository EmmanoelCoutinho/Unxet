import React, { useRef, useState } from "react";
import { FolderOpenIcon, PaperclipIcon, XIcon } from "lucide-react";
import { toast } from "react-toastify";
import { FileThumb } from "../../../components/files/FileThumb";
import { FileLibraryPicker } from "../../../components/chat/FileLibraryPicker";
import { formatBytes, KIND_LABEL, LIBRARY_ACCEPT } from "../../../services/fileLibrary";
import { draftFromFile, draftKind, draftLabel, type AttachmentDraft } from "../utils/attachment";

const CHIP_BUTTON =
  "inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50";

/** Anexo opcional da mensagem agendada: do computador ou do Banco de arquivos. */
export const AttachmentField: React.FC<{
  clinicId: string | null;
  value: AttachmentDraft | null;
  onChange: (value: AttachmentDraft | null) => void;
  disabled?: boolean;
}> = ({ clinicId, value, onChange, disabled }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = draftFromFile(file);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    onChange(result.draft);
  };

  if (value) {
    const kind = draftKind(value);
    const size = value.source === "local" ? formatBytes(value.file.size) : "";
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
          <FileThumb kind={kind} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{draftLabel(value)}</p>
            <p className="text-xs text-slate-500">{[KIND_LABEL[kind], size].filter(Boolean).join(" · ")}</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="rounded-full p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            aria-label="Remover anexo"
            title="Remover anexo"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {kind === "audio"
            ? "Áudio vai sem legenda: se tiver texto, ele sai numa mensagem logo depois."
            : "O texto vai como legenda do arquivo (pode ficar vazio)."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled} className={CHIP_BUTTON}>
        <PaperclipIcon className="h-3.5 w-3.5" />
        Anexar arquivo
      </button>
      <button type="button" onClick={() => setPickerOpen(true)} disabled={disabled} className={CHIP_BUTTON}>
        <FolderOpenIcon className="h-3.5 w-3.5" />
        Do Banco de arquivos
      </button>
      <input ref={inputRef} type="file" accept={LIBRARY_ACCEPT} onChange={handleFile} className="hidden" />
      <FileLibraryPicker
        open={pickerOpen}
        clinicId={clinicId}
        subtitle="Escolha um arquivo para ir junto com a mensagem agendada."
        onClose={() => setPickerOpen(false)}
        onSelect={(file) => {
          setPickerOpen(false);
          onChange({
            source: "saved",
            attachment: {
              url: file.url,
              kind: file.kind,
              mimeType: file.mimeType,
              filename: file.filename.slice(0, 200),
            },
          });
        }}
      />
    </div>
  );
};
