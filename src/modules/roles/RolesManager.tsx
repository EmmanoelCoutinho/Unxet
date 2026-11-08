import React, { useEffect, useMemo, useState } from "react";
import { CheckIcon, LockIcon, PencilIcon, PlusIcon, ShieldIcon, Trash2Icon } from "lucide-react";
import { toast } from "react-toastify";
import { CloseButton } from "../../components/ui/CloseButton";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import {
  ROLE_NAME_MAX,
  clinicRolesService,
  validateRoleName,
  type ClinicRole,
} from "../../services/clinicRoles";
import {
  ADMIN_ONLY_AREAS,
  AGENT_DEFAULT_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_GROUPS,
  type Permission,
} from "./permissions";

const labelOf = (key: Permission) => PERMISSIONS.find((p) => p.key === key)?.label ?? key;

const PermissionChips: React.FC<{ permissions: Permission[]; empty: string }> = ({ permissions, empty }) =>
  permissions.length === 0 ? (
    <p className="text-xs text-slate-500">{empty}</p>
  ) : (
    <div className="flex flex-wrap gap-1.5">
      {/* Na ordem da tela, não na alfabética que vem do banco */}
      {PERMISSIONS.map((p) => p.key).filter((key) => permissions.includes(key)).map((key) => (
        <span key={key} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
          {labelOf(key)}
        </span>
      ))}
    </div>
  );

/** Formulário de criar/editar cargo. */
const RoleForm: React.FC<{
  role: ClinicRole | null;
  others: ClinicRole[];
  saving: boolean;
  onCancel: () => void;
  onSave: (name: string, permissions: Permission[]) => Promise<void>;
}> = ({ role, others, saving, onCancel, onSave }) => {
  const [name, setName] = useState(role?.name ?? "");
  // Cargo novo começa com o que o Atendente já pode, para ninguém perder acesso sem querer
  const [selected, setSelected] = useState<Set<Permission>>(
    new Set(role?.permissions ?? AGENT_DEFAULT_PERMISSIONS),
  );
  const [showErrors, setShowErrors] = useState(false);
  const nameError = showErrors ? validateRoleName(name, others) : null;

  const toggle = (key: Permission) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (validateRoleName(name, others)) {
      setShowErrors(true);
      document.getElementById("role-name")?.focus();
      return;
    }
    await onSave(name, PERMISSIONS.map((p) => p.key).filter((key) => selected.has(key)));
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label htmlFor="role-name" className="block text-sm font-medium text-slate-800">
          Nome do cargo
        </label>
        <input
          id="role-name"
          type="text"
          autoFocus
          value={name}
          maxLength={ROLE_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Supervisor"
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? "role-name-error" : undefined}
          className={`mt-1.5 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:ring-4 ${
            nameError
              ? "border-red-400 focus:border-red-500 focus:ring-red-100"
              : "border-slate-200 focus:border-blue-400 focus:ring-blue-100"
          }`}
        />
        {nameError ? (
          <p id="role-name-error" className="mt-1.5 text-xs text-red-600">
            {nameError}
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        <p className="text-sm font-medium text-slate-800">O que este cargo pode fazer</p>
        <p className="-mt-3 text-xs leading-5 text-slate-500">
          Além do que todo atendente já faz: atender as conversas do próprio departamento, usar
          mensagens rápidas e etiquetas, chat interno, funil e campanhas próprios.
        </p>
        {PERMISSION_GROUPS.map((group) => (
          <fieldset key={group}>
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {PERMISSIONS.filter((p) => p.group === group).map((p) => {
                const checked = selected.has(p.key);
                return (
                  <label
                    key={p.key}
                    className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                      checked ? "border-blue-400 bg-blue-50/60" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.key)}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">{p.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500">{p.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          <LockIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
          Só administradores: {ADMIN_ONLY_AREAS.join(", ").toLowerCase()}.
        </p>
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Voltar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? "Salvando..." : role ? "Salvar cargo" : "Criar cargo"}
        </button>
      </div>
    </form>
  );
};

/**
 * Janela "Cargos e permissões" da tela de Atendentes. Lista os cargos padrão
 * (só leitura) e os personalizados da empresa.
 */
export const RolesManager: React.FC<{
  clinicId: string;
  roles: ClinicRole[];
  // Pessoas em cada cargo personalizado (para o aviso ao apagar)
  membersByRole: Record<string, number>;
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}> = ({ clinicId, roles, membersByRole, onChanged, onClose }) => {
  const confirm = useConfirm();
  // null: lista; "new": criando; ClinicRole: editando
  const [editing, setEditing] = useState<ClinicRole | "new" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const others = useMemo(
    () => roles.filter((r) => editing === "new" || editing === null || r.id !== editing.id),
    [roles, editing],
  );

  const save = async (name: string, permissions: Permission[]) => {
    setSaving(true);
    try {
      if (editing && editing !== "new") await clinicRolesService.update(editing.id, name, permissions);
      else await clinicRolesService.create(clinicId, name, permissions);
      toast.success(editing === "new" ? "Cargo criado." : "Cargo salvo.");
      await onChanged();
      setEditing(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (role: ClinicRole) => {
    const count = membersByRole[role.id] ?? 0;
    const ok = await confirm({
      title: `Apagar o cargo "${role.name}"?`,
      description:
        count > 0
          ? `${count} ${count === 1 ? "pessoa volta" : "pessoas voltam"} a ser Atendente e perdem as permissões deste cargo.`
          : "Ninguém está com este cargo agora.",
      confirmLabel: "Apagar cargo",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await clinicRolesService.remove(role.id);
      toast.success("Cargo apagado.");
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-3 py-4 sm:px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cargos e permissões"
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {editing === "new" ? "Novo cargo" : editing ? `Editar "${editing.name}"` : "Cargos e permissões"}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {editing
                ? "Marque o que as pessoas com este cargo podem fazer."
                : "Crie cargos para dar a algumas pessoas mais acesso do que o Atendente, sem fazer delas administradoras."}
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {editing ? (
            <RoleForm
              key={editing === "new" ? "new" : editing.id}
              role={editing === "new" ? null : editing}
              others={others}
              saving={saving}
              onCancel={() => setEditing(null)}
              onSave={save}
            />
          ) : (
            <div className="space-y-3">
              {/* Cargos padrão: não mudam */}
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2">
                  <ShieldIcon className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-semibold text-slate-900">Administrador</span>
                  <span className="text-xs text-slate-400">padrão</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Pode tudo, inclusive convidar pessoas e mudar cargos.</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2">
                  <ShieldIcon className="h-4 w-4 text-slate-400" />
                  <span className="text-sm font-semibold text-slate-900">Atendente</span>
                  <span className="text-xs text-slate-400">padrão</span>
                </div>
                <p className="mb-2 mt-1 text-xs text-slate-500">
                  Atende as conversas do próprio departamento. Além disso:
                </p>
                <PermissionChips permissions={AGENT_DEFAULT_PERMISSIONS} empty="" />
              </div>

              {roles.map((role) => (
                <div key={role.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ShieldIcon className="h-4 w-4 text-blue-600" />
                        <span className="truncate text-sm font-semibold text-slate-900">{role.name}</span>
                        <span className="whitespace-nowrap text-xs text-slate-400">
                          {membersByRole[role.id] ?? 0}{" "}
                          {(membersByRole[role.id] ?? 0) === 1 ? "pessoa" : "pessoas"}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(role)}
                        className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        aria-label={`Editar ${role.name}`}
                        title="Editar"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(role)}
                        className="rounded-full p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Apagar ${role.name}`}
                        title="Apagar"
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <PermissionChips
                      permissions={role.permissions}
                      empty="Sem permissões além de atender o próprio departamento."
                    />
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setEditing("new")}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 p-3 text-sm font-medium text-slate-600 hover:border-blue-300 hover:text-blue-700"
              >
                <PlusIcon className="h-4 w-4" />
                Novo cargo
              </button>
              {roles.length === 0 ? (
                <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                  <CheckIcon className="h-3.5 w-3.5" />
                  Exemplo: um "Supervisor" que vê o Painel, os Relatórios e todas as conversas.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
