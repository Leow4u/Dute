import { describe, expect, it } from "vitest";

import { assignableRoles, canManagePerson, profileAccess, roleLabel } from "./access";

describe("acesso das pessoas", () => {
  it("perfil com acesso removido não entra, mesmo com papel válido", () => {
    expect(profileAccess({ role: "wms", access_disabled: true })).toEqual({ state: "removed" });
    expect(profileAccess({ role: "wms", access_disabled: false })).toEqual({ state: "active", role: "wms" });
    expect(profileAccess({ role: "nada" })).toEqual({ state: "none" });
    expect(profileAccess(undefined)).toEqual({ state: "none" });
  });

  it("só o owner atribui administração", () => {
    expect(assignableRoles("admin")).not.toContain("admin");
    expect(assignableRoles("owner")).toContain("admin");
  });

  it("admin não gerencia outro admin nem o owner", () => {
    expect(canManagePerson("admin", "wms")).toBe(true);
    expect(canManagePerson("admin", "admin")).toBe(false);
    expect(canManagePerson("admin", "owner")).toBe(false);
    expect(canManagePerson("owner", "admin")).toBe(true);
    expect(canManagePerson("interno", "wms")).toBe(false);
  });

  it("nomes dos perfis como a operação fala", () => {
    expect(roleLabel("interno")).toBe("Coordenação");
    expect(roleLabel("wms")).toBe("Operação WMS");
  });
});
