import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// Rótulo do atendente responsável por uma conversa
export function getAssigneeLabel(
  assignedTo: string | undefined,
  currentUserId: string | undefined,
  names: Record<string, string>,
) {
  if (!assignedTo) return undefined;
  if (assignedTo === currentUserId) return "Você";
  return names[assignedTo] ?? "Atendente";
}

// Nome de exibição de cada usuário da clínica, indexado por user_id
export function useClinicUserNames(
  clinicId: string | null | undefined,
  enabled = true,
) {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!clinicId || !enabled) {
      setNames({});
      return;
    }

    let active = true;

    const load = async () => {
      const { data, error } = await supabase
        .from("clinic_users")
        .select("user_id, name, email")
        .eq("clinic_id", clinicId);

      if (!active || error) return;

      const next: Record<string, string> = {};
      ((data as any[]) ?? []).forEach((row) => {
        if (!row?.user_id) return;
        next[row.user_id] = row.name || row.email || "Atendente";
      });
      setNames(next);
    };

    void load();

    return () => {
      active = false;
    };
  }, [clinicId, enabled]);

  return names;
}
