import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";

type DepartmentRow = { id: string; name: string };
type MemberRow = { userId: string; name: string };

export type TransferTarget = { departmentId: string } | { userId: string };

type Mode = "user" | "department";

export const TransferModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: (target: TransferTarget) => void;
  loading: boolean;

  clinicId: string | null;
  currentDepartmentId: string | null;
  currentAssigneeId?: string | null;
  // Plano sem departamentos: só transfere para uma pessoa
  allowDepartments?: boolean;
}> = ({
  open,
  onClose,
  onConfirm,
  loading,
  clinicId,
  currentDepartmentId,
  currentAssigneeId = null,
  allowDepartments = true,
}) => {
  const [mode, setMode] = useState<Mode>("user");
  const [deptId, setDeptId] = useState("");
  const [userId, setUserId] = useState("");
  const [search, setSearch] = useState("");
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("user");
    setDeptId("");
    setUserId("");
    setSearch("");
  }, [open]);

  useEffect(() => {
    if (!open || !clinicId || !allowDepartments) return;
    let active = true;

    const loadDepartments = async () => {
      setDepartmentsLoading(true);
      const { data, error } = await supabase
        .from("departments")
        .select("id,name")
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .order("name");

      if (!active) return;
      if (!error) setDepartments((data ?? []) as DepartmentRow[]);
      setDepartmentsLoading(false);
    };

    void loadDepartments();
    return () => {
      active = false;
    };
  }, [open, clinicId, allowDepartments]);

  useEffect(() => {
    if (!open || !clinicId) return;
    let active = true;

    const loadMembers = async () => {
      setMembersLoading(true);
      // Só quem já aceitou o convite (a função recusa os demais)
      const { data, error } = await supabase
        .from("clinic_users")
        .select("user_id, name, email")
        .eq("clinic_id", clinicId)
        .not("accepted_at", "is", null);

      if (!active) return;
      if (!error) {
        setMembers(
          ((data ?? []) as Array<{ user_id: string; name: string | null; email: string | null }>)
            .filter((row) => row.user_id)
            .map((row) => ({
              userId: row.user_id,
              name: row.name || row.email || "Atendente",
            }))
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        );
      }
      setMembersLoading(false);
    };

    void loadMembers();
    return () => {
      active = false;
    };
  }, [open, clinicId]);

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return members.filter(
      (m) => m.userId !== currentAssigneeId && (!term || m.name.toLowerCase().includes(term)),
    );
  }, [members, currentAssigneeId, search]);

  const canConfirm =
    mode === "user" ? !!userId : !!deptId && deptId !== currentDepartmentId;

  if (!open) return null;

  const tabClass = (active: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
    }`;

  return (
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute left-1/2 top-1/2 flex max-h-[90dvh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 p-5">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">
              Transferir conversa
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {mode === "user"
                ? "A pessoa escolhida vira a responsável e já pode responder o cliente."
                : "A conversa vai para a fila do setor escolhido e ficará pendente até alguém aceitar."}
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {allowDepartments && (
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "user"}
                onClick={() => setMode("user")}
                className={tabClass(mode === "user")}
              >
                Pessoa
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "department"}
                onClick={() => setMode("department")}
                className={tabClass(mode === "department")}
              >
                Setor
              </button>
            </div>
          )}

          {mode === "user" ? (
            <>
              <label className="text-sm font-medium text-gray-700" htmlFor="transfer-search">
                Atendente de destino
              </label>
              <input
                id="transfer-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pelo nome"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <div className="max-h-60 space-y-1 overflow-y-auto pr-1">
                {membersLoading ? (
                  <p className="py-3 text-center text-sm text-gray-400">Carregando...</p>
                ) : candidates.length === 0 ? (
                  <p className="py-3 text-center text-sm text-gray-400">
                    Nenhum atendente encontrado.
                  </p>
                ) : (
                  candidates.map((m) => {
                    const selected = userId === m.userId;
                    return (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() => setUserId(m.userId)}
                        aria-pressed={selected}
                        className={`flex w-full items-center rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          selected
                            ? "border-blue-300 bg-blue-50 text-blue-900"
                            : "border-transparent text-gray-800 hover:bg-gray-50"
                        }`}
                      >
                        <span className="truncate">{m.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <>
              <label className="text-sm font-medium text-gray-700" htmlFor="transfer-department">
                Setor de destino
              </label>
              <select
                id="transfer-department"
                value={deptId}
                onChange={(e) => setDeptId(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                disabled={departmentsLoading || !clinicId}
              >
                <option value="">
                  {departmentsLoading ? "Carregando..." : "Selecione..."}
                </option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.id === currentDepartmentId ? " (atual)" : ""}
                  </option>
                ))}
              </select>
              {!!deptId && deptId === currentDepartmentId && (
                <p className="text-xs text-amber-600">
                  Escolha um setor diferente do atual.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 p-5">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              onConfirm(mode === "user" ? { userId } : { departmentId: deptId })
            }
            disabled={!canConfirm || loading}
          >
            {loading ? "Transferindo..." : "Transferir"}
          </Button>
        </div>
      </div>
    </div>
  );
};
