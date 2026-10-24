import { describe, expect, it } from "vitest";
import { pickDefaultDepartmentId } from "./connectionDepartment";

const CLINIC = "clinic-1";

describe("pickDefaultDepartmentId", () => {
  it("usa o setor do número quando ele está ativo e é da empresa", () => {
    expect(
      pickDefaultDepartmentId(
        { id: "dept-financeiro", clinic_id: CLINIC, is_active: true },
        CLINIC,
        "dept-padrao",
      ),
    ).toBe("dept-financeiro");
  });

  it("número sem setor cai no padrão da empresa", () => {
    expect(pickDefaultDepartmentId(null, CLINIC, "dept-padrao")).toBe(
      "dept-padrao",
    );
  });

  it("setor desativado ou de outra empresa cai no padrão da empresa", () => {
    expect(
      pickDefaultDepartmentId(
        { id: "dept-x", clinic_id: CLINIC, is_active: false },
        CLINIC,
        "dept-padrao",
      ),
    ).toBe("dept-padrao");
    expect(
      pickDefaultDepartmentId(
        { id: "dept-y", clinic_id: "outra", is_active: true },
        CLINIC,
        "dept-padrao",
      ),
    ).toBe("dept-padrao");
  });

  it("sem nenhum dos dois, devolve null", () => {
    expect(pickDefaultDepartmentId(null, CLINIC, null)).toBeNull();
  });
});
