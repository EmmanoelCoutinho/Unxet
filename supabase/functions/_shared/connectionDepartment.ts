// deno-lint-ignore-file
// @ts-nocheck
// Setor em que caem as conversas novas de um número de WhatsApp (sem
// dependência de Deno: testado no Vitest).
//
// Cada conexão pode ter um departamento padrão próprio
// (channel_connections.default_department_id). Sem ele, ou se o setor foi
// desativado, vale o departamento padrão da empresa.

type ConnectionDepartment = {
  id: string;
  clinic_id: string;
  is_active: boolean | null;
} | null;

/** Escolhe o setor do número quando ele é válido; senão o padrão da empresa. */
export const pickDefaultDepartmentId = (
  connectionDepartment: ConnectionDepartment,
  clinicId: string,
  clinicDefaultDepartmentId: string | null,
) => {
  if (
    connectionDepartment?.id &&
    connectionDepartment.clinic_id === clinicId &&
    connectionDepartment.is_active !== false
  ) {
    return connectionDepartment.id;
  }
  return clinicDefaultDepartmentId ?? null;
};

/** Departamento do número, buscado no banco. Erro de leitura cai no da empresa. */
export const loadConnectionDepartment = async (
  supabase,
  channelConnectionId: string | null | undefined,
): Promise<ConnectionDepartment> => {
  if (!channelConnectionId) return null;

  const { data, error } = await supabase
    .from("channel_connections")
    .select("default_department_id, departments:default_department_id ( id, clinic_id, is_active )")
    .eq("id", channelConnectionId)
    .maybeSingle();

  if (error) {
    console.error("[CONNECTION_DEPARTMENT_ERROR]", channelConnectionId, error);
    return null;
  }

  return data?.departments ?? null;
};
