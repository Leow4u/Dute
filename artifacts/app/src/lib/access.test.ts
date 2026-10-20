import { describe, expect, it } from "vitest";

import { ROLE_INFO, assignableRoles, canManagePerson, profileAccess, roleLabel, visibleRoleInfo } from "./access";

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

describe("papéis da plataforma no convite (Fase 2)", () => {
  const NEW_ROLES = ["campo", "comercial", "rh", "painel"] as const;

  it("aparecem só onde a plataforma está liberada", () => {
    for (const role of NEW_ROLES) {
      expect(assignableRoles("owner", false)).not.toContain(role);
      expect(assignableRoles("admin", false)).not.toContain(role);
      expect(assignableRoles("owner", true)).toContain(role);
      expect(assignableRoles("admin", true)).toContain(role);
    }
    expect(visibleRoleInfo(false).map((item) => item.role)).not.toContain("campo");
    expect(visibleRoleInfo(true).map((item) => item.role)).toContain("campo");
  });

  it("fora da liberação, o convite fica igual ao de hoje", () => {
    expect(assignableRoles("owner", false)).toEqual(["admin", "interno", "wms", "financeiro", "suporte", "cliente"]);
    expect(assignableRoles("admin", false)).toEqual(["interno", "wms", "financeiro", "suporte", "cliente"]);
  });

  it("todo papel novo tem nome e descrição, e um papel novo não vira cliente na tela", () => {
    for (const role of NEW_ROLES) {
      const info = ROLE_INFO.find((item) => item.role === role);
      expect(info?.label).toBeTruthy();
      expect(info?.description).toBeTruthy();
      expect(roleLabel(role)).not.toBe("Sem perfil");
    }
    expect(profileAccess({ role: "campo" })).toEqual({ state: "active", role: "campo" });
  });
});
