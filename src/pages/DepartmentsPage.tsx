import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2Icon,
  CheckIcon,
  Edit3Icon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Input } from "../components/ui/Input";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../contexts/ClinicContext";
import PreTitleIcon from "../components/ui/PreTitleIcon";

type Department = {
  id: string;
  clinic_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type DepartmentFormValues = {
  name: string;
  description: string;
  is_active: boolean;
  is_default: boolean;
};

type Toast = {
  id: string;
  message: string;
  type: "success" | "error" | "info";
};

type ModalMode = "create" | "edit";

type DepartmentActionError = {
  message: string;
  isPermission: boolean;
};

const normalizeSlug = (value: string) => {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00E7/g, "c")
    .replace(/\u00C7/g, "c")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const isPermissionError = (
  error: { status?: number; code?: string } | null,
) => {
  if (!error) return false;
  return error.status === 401 || error.status === 403 || error.code === "42501";
};

const mapRowToDepartment = (row: Department): Department => ({
  id: row.id,
  clinic_id: row.clinic_id,
  name: row.name,
  slug: row.slug,
  description: row.description,
  is_default: row.is_default,
  is_active: row.is_active,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const buildDepartmentPayload = (
  values: DepartmentFormValues,
  clinicId: string,
) => ({
  clinic_id: clinicId,
  name: values.name.trim(),
  slug: normalizeSlug(values.name),
  description: values.description.trim() || null,
  is_active: values.is_active,
});

const buildDepartmentUpdatePayload = (values: DepartmentFormValues) => ({
  name: values.name.trim(),
  slug: normalizeSlug(values.name),
  description: values.description.trim() || null,
  is_active: values.is_active,
});

const buildToast = (message: string, type: Toast["type"]): Toast => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  message,
  type,
});

const useToasts = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((toast: Toast) => {
    setToasts((prev) => [...prev, toast]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 3200);

    return () => window.clearTimeout(timer);
  }, [toasts]);

  return { toasts, pushToast };
};

export const DepartmentsPage: React.FC = () => {
  const { clinicId, membership } = useClinic();
  const isAdmin = membership?.role === "admin";

  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Department | null>(null);
  const [formErrors, setFormErrors] = useState<{
    name?: string;
  }>({});
  const [formValues, setFormValues] = useState<DepartmentFormValues>({
    name: "",
    description: "",
    is_active: true,
    is_default: false,
  });

  const { toasts, pushToast } = useToasts();

  const resetForm = useCallback(() => {
    setFormValues({
      name: "",
      description: "",
      is_active: true,
      is_default: false,
    });
    setEditingDepartment(null);
    setFormErrors({});
  }, []);

  const validateForm = useCallback(() => {
    const nextErrors: { name?: string } = {};
    if (!formValues.name.trim()) {
      nextErrors.name = "Nome é obrigatório";
    }
    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [formValues]);

  const handleActionError = useCallback(
    (error: DepartmentActionError) => {
      if (error.isPermission) {
        pushToast(buildToast("Você não tem permissão para esta ação", "error"));
      } else {
        pushToast(buildToast(error.message, "error"));
      }
    },
    [pushToast],
  );

  const fetchDepartments = useCallback(async () => {
    if (!clinicId) {
      setDepartments([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("departments")
      .select(
        "id, clinic_id, name, slug, description, is_default, is_active, created_at, updated_at",
      )
      .eq("clinic_id", clinicId)
      .order("is_default", { ascending: false })
      .order("is_active", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      setError(
        isPermissionError(error)
          ? "Você não tem permissão para esta ação"
          : error.message,
      );
      setDepartments([]);
      setIsLoading(false);
      return;
    }

    setDepartments((data as Department[]).map(mapRowToDepartment));
    setIsLoading(false);
  }, [clinicId]);

  const createDepartment = useCallback(
    async (values: DepartmentFormValues) => {
      if (!clinicId) return null;

      if (values.is_default) {
        const { error: defaultError } = await supabase
          .from("departments")
          .update({ is_default: false })
          .eq("clinic_id", clinicId);

        if (defaultError) {
          throw {
            message: defaultError.message,
            isPermission: isPermissionError(defaultError),
          } as DepartmentActionError;
        }
      }

      const payload = buildDepartmentPayload(values, clinicId);
      const { data, error } = await supabase
        .from("departments")
        .insert({ ...payload, is_default: values.is_default })
        .select(
          "id, clinic_id, name, slug, description, is_default, is_active, created_at, updated_at",
        )
        .single();

      if (error) {
        throw {
          message: error.message,
          isPermission: isPermissionError(error),
        } as DepartmentActionError;
      }

      return mapRowToDepartment(data as Department);
    },
    [clinicId],
  );

  const updateDepartment = useCallback(
    async (departmentId: string, values: DepartmentFormValues) => {
      if (!clinicId) return null;

      const payload = buildDepartmentUpdatePayload(values);

      const { data, error } = await supabase
        .from("departments")
        .update(payload)
        .eq("id", departmentId)
        .eq("clinic_id", clinicId)
        .select(
          "id, clinic_id, name, slug, description, is_default, is_active, created_at, updated_at",
        )
        .single();

      if (error) {
        throw {
          message: error.message,
          isPermission: isPermissionError(error),
        } as DepartmentActionError;
      }

      return mapRowToDepartment(data as Department);
    },
    [clinicId],
  );

  const deleteDepartment = useCallback(
    async (departmentId: string) => {
      if (!clinicId) return;

      const { error } = await supabase
        .from("departments")
        .delete()
        .eq("id", departmentId)
        .eq("clinic_id", clinicId);

      if (error) {
        throw {
          message: error.message,
          isPermission: isPermissionError(error),
        } as DepartmentActionError;
      }
    },
    [clinicId],
  );

  const setDefaultDepartment = useCallback(
    async (departmentId: string) => {
      if (!clinicId) return;

      const { error: resetError } = await supabase
        .from("departments")
        .update({ is_default: false })
        .eq("clinic_id", clinicId);

      if (resetError) {
        throw {
          message: resetError.message,
          isPermission: isPermissionError(resetError),
        } as DepartmentActionError;
      }

      const { data, error } = await supabase
        .from("departments")
        .update({ is_default: true })
        .eq("id", departmentId)
        .eq("clinic_id", clinicId)
        .select(
          "id, clinic_id, name, slug, description, is_default, is_active, created_at, updated_at",
        )
        .single();

      if (error) {
        throw {
          message: error.message,
          isPermission: isPermissionError(error),
        } as DepartmentActionError;
      }

      return mapRowToDepartment(data as Department);
    },
    [clinicId],
  );

  const toggleActiveDepartment = useCallback(
    async (departmentId: string, isActive: boolean) => {
      if (!clinicId) return null;

      const { data, error } = await supabase
        .from("departments")
        .update({ is_active: isActive })
        .eq("id", departmentId)
        .eq("clinic_id", clinicId)
        .select(
          "id, clinic_id, name, slug, description, is_default, is_active, created_at, updated_at",
        )
        .single();

      if (error) {
        throw {
          message: error.message,
          isPermission: isPermissionError(error),
        } as DepartmentActionError;
      }

      return mapRowToDepartment(data as Department);
    },
    [clinicId],
  );

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const openCreateModal = () => {
    resetForm();
    setModalMode("create");
    setIsModalOpen(true);
  };

  const openEditModal = (department: Department) => {
    setModalMode("edit");
    setEditingDepartment(department);
    setFormValues({
      name: department.name,
      description: department.description ?? "",
      is_active: department.is_active,
      is_default: department.is_default,
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const handleNameChange = (value: string) => {
    setFormValues((prev) => ({
      ...prev,
      name: value,
    }));
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    if (!clinicId) return;
    if (!isAdmin) {
      pushToast(buildToast("Você não tem permissão para esta ação", "error"));
      return;
    }

    setIsSubmitting(true);

    try {
      if (modalMode === "create") {
        const created = await createDepartment(formValues);
        if (created) {
          setDepartments((prev) => [created, ...prev]);
        }
        if (formValues.is_default && created) {
          const updatedDefault = await setDefaultDepartment(created.id);
          if (updatedDefault) {
            setDepartments((prev) =>
              prev.map((item) =>
                item.id === updatedDefault.id
                  ? updatedDefault
                  : { ...item, is_default: false },
              ),
            );
          }
        }
        pushToast(buildToast("Departamento criado com sucesso", "success"));
      } else if (editingDepartment) {
        const updated = await updateDepartment(
          editingDepartment.id,
          formValues,
        );
        if (updated) {
          setDepartments((prev) =>
            prev.map((item) => (item.id === updated.id ? updated : item)),
          );
        }
        if (formValues.is_default && updated) {
          const updatedDefault = await setDefaultDepartment(updated.id);
          if (updatedDefault) {
            setDepartments((prev) =>
              prev.map((item) =>
                item.id === updatedDefault.id
                  ? updatedDefault
                  : { ...item, is_default: false },
              ),
            );
          }
        }
        pushToast(buildToast("Departamento atualizado", "success"));
      }

      closeModal();
      fetchDepartments();
    } catch (error) {
      handleActionError(error as DepartmentActionError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRequest = (department: Department) => {
    setPendingDelete(department);
    setIsConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);

    try {
      await deleteDepartment(pendingDelete.id);
      setDepartments((prev) =>
        prev.filter((item) => item.id !== pendingDelete.id),
      );
      pushToast(buildToast("Departamento excluído", "success"));
      setIsConfirmOpen(false);
      setPendingDelete(null);
    } catch (error) {
      handleActionError(error as DepartmentActionError);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDefaultToggle = async (department: Department) => {
    if (!isAdmin) {
      pushToast(buildToast("Você não tem permissão para esta ação", "error"));
      return;
    }

    if (department.is_default) return;

    try {
      const updated = await setDefaultDepartment(department.id);
      if (updated) {
        setDepartments((prev) =>
          prev.map((item) =>
            item.id === updated.id ? updated : { ...item, is_default: false },
          ),
        );
      }
      pushToast(buildToast("Departamento definido como padrão", "success"));
    } catch (error) {
      handleActionError(error as DepartmentActionError);
    }
  };

  const handleActiveToggle = async (department: Department) => {
    if (!isAdmin) {
      pushToast(buildToast("Você não tem permissão para esta ação", "error"));
      return;
    }

    if (department.is_default && department.is_active) {
      pushToast(
        buildToast("Não é possível desativar o departamento padrão", "info"),
      );
      return;
    }

    try {
      const updated = await toggleActiveDepartment(
        department.id,
        !department.is_active,
      );
      if (updated) {
        setDepartments((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
      pushToast(
        buildToast(
          updated?.is_active
            ? "Departamento ativado"
            : "Departamento desativado",
          "success",
        ),
      );
    } catch (error) {
      handleActionError(error as DepartmentActionError);
    }
  };

  const sortedDepartments = useMemo(() => {
    return [...departments].sort((a, b) => {
      if (a.is_default !== b.is_default) {
        return a.is_default ? -1 : 1;
      }
      if (a.is_active !== b.is_active) {
        return a.is_active ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [departments]);

  const canDelete = (department: Department) => !department.is_default;

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="px-4 pt-6 pb-4 border-b bg-white sm:px-10 sm:pt-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <PreTitleIcon icon={Building2Icon} />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Departamentos
              </h1>
              <p className="text-sm text-gray-500">
                Apenas administradores podem alterar departamentos.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            disabled={!isAdmin}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            Criar departamento
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50">
        <div className="px-4 py-6 sm:px-10 sm:py-8">
          {error ? (
            <div className="rounded-2xl border border-red-100 bg-white p-5 sm:p-8 text-center shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">
                Ocorreu um erro ao carregar
              </h2>
              <p className="mt-2 text-sm text-gray-500">{error}</p>
              <button
                type="button"
                onClick={fetchDepartments}
                className="mt-6 inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
              >
                Tentar novamente
              </button>
            </div>
          ) : isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((row) => (
                <div
                  key={row}
                  className="h-16 rounded-2xl border border-slate-200 bg-white/70 animate-pulse"
                />
              ))}
            </div>
          ) : sortedDepartments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center shadow-sm sm:p-10">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <Building2Icon className="h-6 w-6 text-slate-500" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-gray-900">
                Nenhum departamento cadastrado
              </h2>
              <p className="mt-2 text-sm text-gray-500">
                Organize seus atendimentos criando departamentos para cada área.
              </p>
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
              >
                <PlusIcon className="h-4 w-4" />
                Criar departamento
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="block w-full divide-y divide-slate-100 md:table md:min-w-full">
                <thead className="hidden bg-slate-50 text-left md:table-header-group text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 sm:px-6 py-4">Nome</th>
                    <th className="px-4 sm:px-6 py-4">Status</th>
                    <th className="px-4 sm:px-6 py-4">Default</th>
                    <th className="px-4 sm:px-6 py-4">Ações</th>
                  </tr>
                </thead>
                <tbody className="block divide-y divide-slate-100 md:table-row-group">
                  {sortedDepartments.map((department) => (
                    <tr
                      key={department.id}
                      className="flex flex-wrap items-center gap-2 p-4 md:table-row md:p-0"
                    >
                      <td className="block basis-full md:basis-auto md:table-cell md:px-6 md:py-4">
                        <p className="text-sm font-semibold text-slate-800">
                          {department.name}
                        </p>
                        {department.description && (
                          <p className="text-xs text-slate-500">
                            {department.description}
                          </p>
                        )}
                      </td>
                      <td className="block md:table-cell md:px-6 md:py-4">
                        <span
                          className={[
                            "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
                            department.is_active
                              ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                              : "border-slate-200 text-slate-500 bg-slate-50",
                          ].join(" ")}
                        >
                          {department.is_active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="block md:table-cell md:px-6 md:py-4">
                        <span
                          className={[
                            "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
                            department.is_default
                              ? "border-blue-100 text-blue-700 bg-blue-50"
                              : "border-slate-200 text-slate-500 bg-slate-50",
                          ].join(" ")}
                        >
                          <span className="mr-1 md:hidden">Padrão:</span>
                          {department.is_default ? "Sim" : "Não"}
                        </span>
                      </td>
                      <td className="block basis-full pt-1 md:basis-auto md:pt-4 md:table-cell md:px-6 md:py-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(department)}
                            disabled={!isAdmin}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Edit3Icon className="h-3.5 w-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDefaultToggle(department)}
                            disabled={!isAdmin || department.is_default}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <CheckIcon className="h-3.5 w-3.5" />
                            Tornar padrão
                          </button>
                          <button
                            type="button"
                            onClick={() => handleActiveToggle(department)}
                            disabled={!isAdmin}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {department.is_active ? "Desativar" : "Ativar"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRequest(department)}
                            disabled={!isAdmin || !canDelete(department)}
                            title={
                              department.is_default
                                ? "O departamento padrão não pode ser excluído"
                                : undefined
                            }
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2Icon className="h-3.5 w-3.5" />
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-3 py-4 sm:px-4">
          <div className="max-h-full w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 sm:p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {modalMode === "create"
                  ? "Criar departamento"
                  : "Editar departamento"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Fechar
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <Input
                label="Nome"
                placeholder="Ex: Financeiro"
                value={formValues.name}
                onChange={(event) => handleNameChange(event.target.value)}
                error={formErrors.name}
              />
              <div>
                <label className="block text-sm font-medium text-slate-800 mb-1">
                  Descrição
                </label>
                <textarea
                  value={formValues.description}
                  onChange={(event) =>
                    setFormValues((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  rows={3}
                  placeholder="Detalhes opcionais do departamento"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                  <span>Departamento ativo</span>
                  <input
                    type="checkbox"
                    checked={formValues.is_active}
                    onChange={(event) =>
                      setFormValues((prev) => ({
                        ...prev,
                        is_active: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-slate-700"
                  />
                </label>
                <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                  <span>Definir como padrão</span>
                  <input
                    type="checkbox"
                    checked={formValues.is_default}
                    onChange={(event) => {
                      if (
                        editingDepartment?.is_default &&
                        !event.target.checked
                      ) {
                        pushToast(
                          buildToast(
                            "O departamento padrão só pode ser alterado escolhendo outro",
                            "info",
                          ),
                        );
                        return;
                      }
                      setFormValues((prev) => ({
                        ...prev,
                        is_default: event.target.checked,
                      }));
                    }}
                    disabled={Boolean(editingDepartment?.is_default)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-700 disabled:cursor-not-allowed"
                  />
                </label>
              </div>
              {editingDepartment?.is_default && (
                <p className="text-xs text-slate-500">
                  Para mudar o padrão, use o botão “Tornar padrão” em outro
                  departamento.
                </p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || !isAdmin}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting
                  ? "Salvando..."
                  : modalMode === "create"
                    ? "Criar"
                    : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isConfirmOpen && pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-3 py-4 sm:px-4">
          <div className="max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 sm:p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-slate-900">
              Excluir departamento
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Tem certeza que deseja excluir “{pendingDelete.name}”? Essa ação
              não poderá ser desfeita.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed right-6 top-24 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={[
              "rounded-xl border px-4 py-3 text-sm shadow-md",
              toast.type === "success"
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : toast.type === "info"
                  ? "border-blue-100 bg-blue-50 text-blue-700"
                  : "border-red-100 bg-red-50 text-red-700",
            ].join(" ")}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
};
