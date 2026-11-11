import { useCallback, useEffect, useState } from "react";
import {
  deleteLibraryFile,
  listLibraryFiles,
  type LibraryFile,
} from "../services/fileLibrary";

/** Arquivos da biblioteca da empresa, com atualização local depois de cada ação. */
export const useFileLibrary = (clinicId: string | null | undefined, enabled = true) => {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!clinicId || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      setFiles(await listLibraryFiles(clinicId));
    } catch (err: any) {
      setError(err?.message ?? "Não foi possível carregar os arquivos.");
    } finally {
      setLoading(false);
    }
  }, [clinicId, enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const upsertLocal = useCallback((file: LibraryFile) => {
    setFiles((current) => {
      const exists = current.some((item) => item.id === file.id);
      return exists
        ? current.map((item) => (item.id === file.id ? file : item))
        : [file, ...current];
    });
  }, []);

  const remove = useCallback(
    async (id: string) => {
      if (!clinicId) return;
      await deleteLibraryFile({ clinicId, id });
      setFiles((current) => current.filter((item) => item.id !== id));
    },
    [clinicId],
  );

  return { files, loading, error, refetch, upsertLocal, remove };
};
