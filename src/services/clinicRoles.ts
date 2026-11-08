import { supabase } from "../lib/supabaseClient";
import type { Permission } from "../modules/roles/permissions";

// Cargos personalizados da empresa (clinic_roles). Só o administrador cria,
// edita e apaga; o banco confere.
export type ClinicRole = {
  id: string;
  name: string;
  permissions: Permission[];
};

export const ROLE_NAME_MAX = 40;
const RESERVED_NAMES = ["administrador", "admin", "atendente"];

/** Erro do nome para mostrar no campo, ou null. */
export const validateRoleName = (name: string, others: ClinicRole[]): string | null => {
  const value = name.trim();
  if (!value) return "Dê um nome para o cargo.";
  if (value.length > ROLE_NAME_MAX) return `O nome pode ter no máximo ${ROLE_NAME_MAX} caracteres.`;
  if (RESERVED_NAMES.includes(value.toLowerCase())) {
    return "Esse nome é de um cargo padrão. Escolha outro.";
  }
  if (others.some((r) => r.name.trim().toLowerCase() === value.toLowerCase())) {
    return "Já existe um cargo com esse nome.";
  }
  return null;
};

const toError = (error: { message?: string; code?: string } | null) => {
  if (error?.code === "23505") return new Error("Já existe um cargo com esse nome.");
  if (error?.code === "42501") return new Error("Só administradores podem mudar os cargos.");
  return new Error(error?.message || "Não foi possível concluir a operação.");
};

export const clinicRolesService = {
  async list(clinicId: string): Promise<ClinicRole[]> {
    const { data, error } = await supabase
      .from("clinic_roles")
      .select("id, name, permissions")
      .eq("clinic_id", clinicId)
      .order("name");
    if (error) throw toError(error);
    return (data ?? []) as ClinicRole[];
  },

  async create(clinicId: string, name: string, permissions: Permission[]): Promise<void> {
    const { error } = await supabase
      .from("clinic_roles")
      .insert({ clinic_id: clinicId, name: name.trim(), permissions });
    if (error) throw toError(error);
  },

  async update(id: string, name: string, permissions: Permission[]): Promise<void> {
    const { error } = await supabase
      .from("clinic_roles")
      .update({ name: name.trim(), permissions })
      .eq("id", id);
    if (error) throw toError(error);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("clinic_roles").delete().eq("id", id);
    if (error) throw toError(error);
  },
};
