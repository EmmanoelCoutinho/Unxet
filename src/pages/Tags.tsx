import React, { useMemo, useState, useEffect, useCallback } from "react";
import { PlusCircleIcon, PencilIcon, TrashIcon, TagIcon } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import * as Dialog from "@radix-ui/react-dialog";
import PreTitleIcon from "../components/ui/PreTitleIcon";

type TagItem = {
  id: string;
  name: string;
  color: string;
  clinicId: string;
  createdAt?: string;
};

type DbTagRow = {
  id: string;
  name: string | null;
  color: string | null;
  clinic_id: string | null;
  created_at: string | null;
};

type DbClinicRow = {
  id: string;
  name: string | null;
};

const AVAILABLE_COLORS = [
  "#0A84FF",
  "#34C759",
  "#FF9500",
  "#FF3B30",
  "#AF52DE",
  "#64D2FF",
  "#FF2D55",
  "#8E8E93",
  "#FFD60A",
  "#30B0C7",
  "#5E5CE6",
  "#AC8E68",
];

const mapDbToTagItem = (row: DbTagRow): TagItem => ({
  id: row.id,
  name: row.name ?? "",
  color: row.color ?? AVAILABLE_COLORS[0],
  clinicId: row.clinic_id ?? "",
  createdAt: row.created_at ?? undefined,
});

export const Tags: React.FC = () => {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;

  const [clinicName, setClinicName] = useState<string>("");

  const [activeTab, setActiveTab] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(AVAILABLE_COLORS[0]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const [tags, setTags] = useState<TagItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isEditing = Boolean(editingId);
  const canSubmit = name.trim().length > 0 && Boolean(clinicId) && !isSaving;

  // ✅ sempre vem da tabela clinics, não de tags
  const clinicLabel = useMemo(() => {
    if (!clinicId) return "Empresa atual (indefinida)";
    if (!clinicName) return "Empresa atual";
    return clinicName;
  }, [clinicId, clinicName]);

  const resetForm = useCallback(() => {
    setName("");
    setColor(AVAILABLE_COLORS[0]);
    setEditingId(null);
  }, []);

  const fetchClinic = useCallback(async () => {
    if (!clinicId) return;

    const { data, error } = await supabase
      .from("clinics")
      .select("id,name")
      .eq("id", clinicId)
      .single();

    if (error) {
      setClinicName("");
      return;
    }

    const clinic = data as DbClinicRow;
    setClinicName(clinic?.name ?? "");
  }, [clinicId]);

  const fetchTags = useCallback(async () => {
    if (!clinicId) return;

    setIsLoading(true);
    setErrorMsg(null);

    // ✅ SEM join. Só tags.
    const { data, error } = await supabase
      .from("tags")
      .select("id,name,color,clinic_id,created_at")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMsg(error.message);
      setTags([]);
      setIsLoading(false);
      return;
    }

    setTags((data as DbTagRow[]).map(mapDbToTagItem));
    setIsLoading(false);
  }, [clinicId]);

  useEffect(() => {
    fetchClinic();
    fetchTags();
  }, [fetchClinic, fetchTags]);

  const handleEdit = (tag: TagItem) => {
    setActiveTab("form");
    setEditingId(tag.id);
    setName(tag.name);
    setColor(tag.color);
  };

  const createTag = async () => {
    if (!clinicId) return;

    const payload = {
      name: name.trim(),
      color,
      clinic_id: clinicId,
    };

    const { data, error } = await supabase
      .from("tags")
      .insert(payload)
      .select("id,name,color,clinic_id,created_at")
      .single();

    if (error) throw error;

    const created = mapDbToTagItem(data as DbTagRow);
    setTags((prev) => [created, ...prev]);
  };

  const updateTag = async () => {
    if (!clinicId || !editingId) return;

    const payload = {
      name: name.trim(),
      color,
    };

    const { data, error } = await supabase
      .from("tags")
      .update(payload)
      .eq("id", editingId)
      .eq("clinic_id", clinicId) // segurança extra
      .select("id,name,color,clinic_id,created_at")
      .single();

    if (error) throw error;

    const updated = mapDbToTagItem(data as DbTagRow);
    setTags((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const deleteTag = async () => {
    if (!clinicId || !editingId) return;

    const { data, error } = await supabase
      .from("tags")
      .delete()
      .eq("id", editingId)
      .eq("clinic_id", clinicId)
      .select("id")
      .single();

    if (error) throw error;

    // Se não veio nada, não deletou (0 rows affected)
    if (!data?.id) {
      throw new Error(
        "Não foi possível excluir a tag (nenhuma linha encontrada). Verifique permissões (RLS) e clinic_id.",
      );
    }

    setTags((prev) => prev.filter((t) => t.id !== editingId));
  };

  const handleDeleteClick = () => {
    if (!isEditing) return;
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!isEditing || !editingId) return;

    setIsDeleting(true);
    setErrorMsg(null);

    try {
      await deleteTag();
      setIsDeleteDialogOpen(false);
      setActiveTab("list");
      resetForm();
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Erro ao excluir tag.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSaving(true);
    setErrorMsg(null);

    try {
      if (isEditing) await updateTag();
      else await createTag();

      setActiveTab("list");
      resetForm();
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Erro ao salvar tag.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="px-4 sm:px-6 py-5 border-b bg-white">
        <div className="flex items-center gap-3">
          <PreTitleIcon icon={TagIcon} />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Etiquetas</h1>
            <p className="text-sm text-gray-500">
              Gerencie as etiquetas da sua empresa para organizar atendimentos.
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-6 space-y-6">
        {errorMsg ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : null}

        {!clinicId ? (
          <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900">
              Empresa não identificada
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Aguarde o perfil carregar para listar/criar etiquetas.
            </p>
          </Card>
        ) : activeTab === "list" ? (
          <Card className="p-4 sm:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Etiquetas cadastradas
                </h2>
                <p className="text-sm text-gray-500">
                  Lista de todas as etiquetas associadas à empresa atual.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setActiveTab("form");
                    resetForm();
                  }}
                >
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <PlusCircleIcon className="h-4 w-4" />
                    Nova Etiqueta
                  </span>
                </Button>
              </div>
            </div>

            {isLoading ? (
              <div className="text-sm text-gray-500">
                Carregando etiquetas...
              </div>
            ) : tags.length === 0 ? (
              <div className="text-sm text-gray-500">
                Nenhuma etiqueta cadastrada para esta empresa, todas as suas
                etiquetas apareceram aqui.
              </div>
            ) : (
              <div className="space-y-3">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex flex-wrap items-center justify-between gap-4 border border-gray-200 rounded-lg px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="h-4 w-4 rounded-full border border-gray-200"
                        style={{ backgroundColor: tag.color }}
                      />
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {tag.name}
                        </p>

                        <p className="text-xs text-gray-500">{clinicLabel}</p>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(tag)}
                    >
                      <span className="flex items-center gap-2 text-gray-700">
                        <PencilIcon className="h-4 w-4" />
                        Editar
                      </span>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : (
          <Card className="p-4 sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {isEditing ? "Editar etiqueta" : "Criar nova etiqueta"}
                </h2>
                <p className="text-sm text-gray-500">
                  Defina um nome e escolha uma cor personalizada para a
                  etiqueta.
                </p>
              </div>

              {/* ✅ Botão excluir (só no editar) */}
              {isEditing ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteClick}
                  disabled={isSaving || isDeleting}
                >
                  <span className="flex items-center gap-2 text-red-600">
                    <TrashIcon className="h-4 w-4" />
                    {isDeleting ? "Excluindo..." : "Excluir"}
                  </span>
                </Button>
              ) : null}
            </div>

            <Dialog.Root
              open={isDeleteDialogOpen}
              onOpenChange={setIsDeleteDialogOpen}
            >
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm" />

                <Dialog.Content
                  onPointerDownOutside={(e: any) => {
                    if (isDeleting) e.preventDefault();
                  }}
                  onEscapeKeyDown={(e: any) => {
                    if (isDeleting) e.preventDefault();
                  }}
                  className="fixed left-1/2 top-1/2 max-h-[90dvh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-4 sm:p-6 shadow-xl border border-gray-200"
                >
                  <Dialog.Title className="text-base font-semibold text-gray-900">
                    Excluir Etiqueta
                  </Dialog.Title>

                  <Dialog.Description className="mt-2 text-sm text-gray-600">
                    Tem certeza que deseja excluir esta Etiqueta? Essa ação não
                    pode ser desfeita.
                  </Dialog.Description>

                  <div className="mt-6 flex items-center justify-end gap-3">
                    <Dialog.Close asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={isDeleting}
                      >
                        Cancelar
                      </Button>
                    </Dialog.Close>

                    <Button
                      type="button"
                      variant="primary"
                      className="bg-red-500 hover:bg-red-800"
                      onClick={handleConfirmDelete}
                      disabled={isDeleting}
                    >
                      {isDeleting ? "Excluindo..." : "Excluir"}
                    </Button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>

            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="grid gap-4 md:grid-cols-[1.2fr,1fr]">
                <div>
                  <label className="text-sm font-medium text-gray-700">
                    Nome da Etiqueta
                  </label>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex: Pós-consulta"
                    className="mt-2"
                    disabled={isSaving || isDeleting}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">
                    Empresa vinculada
                  </label>

                  <div className="mt-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 bg-gray-50">
                    {clinicLabel}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">
                    Paleta de cores
                  </label>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>Cor atual</span>
                    <span
                      className="h-4 w-4 rounded-full border border-gray-200"
                      style={{ backgroundColor: color }}
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-6 gap-3 sm:grid-cols-8 md:grid-cols-10">
                  {AVAILABLE_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      className={`h-8 w-8 rounded-full border-2 transition ${
                        color === hex
                          ? "border-gray-900"
                          : "border-transparent hover:border-gray-300"
                      }`}
                      style={{ backgroundColor: hex }}
                      onClick={() => setColor(hex)}
                      disabled={isSaving || isDeleting}
                    />
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <label className="text-sm text-gray-600">
                    Cor customizada
                  </label>
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    className="h-10 w-14 rounded border border-gray-200 bg-white"
                    disabled={isSaving || isDeleting}
                  />
                  <span className="text-xs text-gray-500">{color}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!canSubmit || isDeleting}
                >
                  {isSaving
                    ? "Salvando..."
                    : isEditing
                      ? "Salvar alterações"
                      : "Criar etiqueta"}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  disabled={isSaving || isDeleting}
                  onClick={() => {
                    setActiveTab("list");
                    resetForm();
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
};
