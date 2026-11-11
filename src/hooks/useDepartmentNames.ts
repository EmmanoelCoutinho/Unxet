import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Rótulo do departamento no card da conversa: "Dep. Fiscal". Nome que já
 * começa com "Dep..." (Departamento Fiscal, Depto. Fiscal) fica como está.
 */
export function departmentLabel(name: string | undefined) {
  const clean = (name ?? "").trim();
  if (!clean) return undefined;
  return /^dep/i.test(clean) ? clean : `Dep. ${clean}`;
}

// Nome de cada departamento da empresa, indexado pelo id
export function useDepartmentNames(clinicId: string | null | undefined) {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!clinicId) {
      setNames({});
      return;
    }

    let active = true;

    const load = async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name")
        .eq("clinic_id", clinicId);

      if (!active || error) return;

      const next: Record<string, string> = {};
      ((data as any[]) ?? []).forEach((row) => {
        if (row?.id && row?.name) next[row.id] = row.name;
      });
      setNames(next);
    };

    void load();

    return () => {
      active = false;
    };
  }, [clinicId]);

  return names;
}
