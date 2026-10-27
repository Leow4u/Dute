import { expect, it } from "vitest";
import { API_PERMISSIONS } from "@workspace/dominio";
import { integrationProblem, integrationStatus, PERMISSOES } from "./model";

const valid = { name: "Parceiro", customers: ["A"], scopes: ["operacao:ler"], expires_in_days: 30 };
it("valida nome, clientes explícitos, escopos e validade sem ampliar o contrato", () => {
  expect(integrationProblem(valid)).toBeNull();
  for (const input of [
    { ...valid, name: " " }, { ...valid, name: "a".repeat(81) },
    { ...valid, customers: [] }, { ...valid, customers: ["*"] }, { ...valid, customers: ["A/B"] },
    { ...valid, customers: Array.from({ length: 51 }, (_, n) => String(n)) },
    { ...valid, scopes: [] }, { ...valid, scopes: ["all"] },
    { ...valid, expires_in_days: 91 }, { ...valid, expires_in_days: 0 }, { ...valid, expires_in_days: 1.5 },
  ]) expect(integrationProblem(input)).toBeTruthy();
  expect(PERMISSOES).toEqual(API_PERMISSIONS);
});
it("distingue ativa, expirada e revogada sem revelar credencial", () => {
  const expires_at = "2026-11-25T00:00:00Z";
  expect(integrationStatus({ expires_at, revoked: false }, Date.parse("2026-10-26"))).toBe("Ativa");
  expect(integrationStatus({ expires_at, revoked: false }, Date.parse("2026-12-26"))).toBe("Expirada");
  expect(integrationStatus({ expires_at, revoked: true }, 0)).toBe("Revogada");
});

it("autoriza recursos globais sem cliente, mas exige cliente em qualquer escopo local", () => {
  expect(integrationProblem({ ...valid, customers: [], scopes: ["rh:ler", "rh:registros:gravar"] })).toBeNull();
  expect(integrationProblem({ ...valid, customers: [], scopes: ["operacao:recursos:ler"] })).toBeNull();
  expect(integrationProblem({ ...valid, customers: [], scopes: ["rh:ler", "comercial:ler"] })).toBeTruthy();
  expect(integrationProblem({ ...valid, customers: ["FUTURO-01"], scopes: ["comercial:clientes:gravar"] })).toBeNull();
  expect(integrationProblem({ ...valid, customers: ["A\\B"] })).toBeTruthy();
});
