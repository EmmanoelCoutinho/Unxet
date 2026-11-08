import { describe, expect, it } from "vitest";
import { AGENT_DEFAULT_PERMISSIONS, PERMISSIONS, resolvePermissions } from "./permissions";

describe("resolvePermissions", () => {
  it("administrador tem todas", () => {
    expect(resolvePermissions("admin", null).size).toBe(PERMISSIONS.length);
    // Cargo não limita o administrador
    expect(resolvePermissions("admin", []).size).toBe(PERMISSIONS.length);
  });

  it("atendente sem cargo fica com o padrão do Atendente", () => {
    expect([...resolvePermissions("agent", null)]).toEqual(AGENT_DEFAULT_PERMISSIONS);
  });

  it("cargo personalizado usa só as permissões dele e ignora as desconhecidas", () => {
    const perms = resolvePermissions("agent", ["reports.view", "team.manage"]);
    expect([...perms]).toEqual(["reports.view"]);
    // O padrão do Atendente não soma: o cargo define tudo
    expect(perms.has("meta_templates.create")).toBe(false);
  });

  it("catálogo não tem chave repetida", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
