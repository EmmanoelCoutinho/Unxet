import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../ui/Button";

type DepartmentRow = { id: string; name: string };

export const TransferModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: (target: { departmentId: string }) => void;
  loading: boolean;

  clinicId: string | null;
  currentDepartmentId: string | null;
}> = ({ open, onClose, onConfirm, loading, clinicId, currentDepartmentId }) => {
  const [deptId, setDeptId] = useState("");
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDeptId("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!clinicId) return;

    const loadDepartments = async () => {
      setDepartmentsLoading(true);

      const { data, error } = await supabase
        .from("departments")
        .select("id,name")
        .eq("clinic_id", clinicId)
        .order("name");

      if (!error) setDepartments((data ?? []) as DepartmentRow[]);
      setDepartmentsLoading(false);
    };

    loadDepartments();
  }, [open, clinicId]);

  const canConfirm = useMemo(() => {
    return !!deptId && deptId !== currentDepartmentId;
  }, [deptId, currentDepartmentId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute left-1/2 top-1/2 max-h-[90dvh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-xl border border-gray-200">
        <div className="p-5 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">
            Transferir conversa
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            A conversa vai para a fila do setor escolhido e ficará pendente até
            alguém aceitar.
          </p>
        </div>

        <div className="p-5 space-y-2">
          <label className="text-sm font-medium text-gray-700">
            Setor de destino
          </label>

          <select
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
        </div>

        <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm({ departmentId: deptId })}
            disabled={!canConfirm || loading}
          >
            {loading ? "Transferindo..." : "Transferir"}
          </Button>
        </div>
      </div>
    </div>
  );
};
