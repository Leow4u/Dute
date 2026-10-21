import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMERCIAL_APPROVER_ROLES,
  COMERCIAL_AUTHORIZATION_ROLES,
  COMERCIAL_ROLES,
  PLATFORM_ROLES,
  canApproveQuote,
  comercialAccessProblem,
  isPlatformRole,
} from "./platform-roles.js";

describe("papéis da plataforma no Comercial", () => {
  it("são os 11 do plano, na ordem de lib/dominio", () => {
    assert.deepEqual(PLATFORM_ROLES, [
      "owner",
      "admin",
      "interno",
      "wms",
      "campo",
      "comercial",
      "financeiro",
      "rh",
      "suporte",
      "painel",
      "cliente",
    ]);
    for (const role of PLATFORM_ROLES) assert.equal(isPlatformRole(role), true);
    assert.equal(isPlatformRole("viewer"), false);
    assert.equal(isPlatformRole(undefined), false);
  });

  it("o Comercial atende owner, admin e comercial", () => {
    assert.deepEqual(COMERCIAL_ROLES, ["owner", "admin", "comercial"]);
  });
});

describe("acesso às callables do Comercial", () => {
  it("owner, admin e comercial entram", () => {
    for (const role of ["owner", "admin", "comercial"] as const) {
      assert.equal(comercialAccessProblem(role), null, role);
    }
  });

  it("os outros papéis da equipe são negados", () => {
    for (const role of ["interno", "wms", "campo", "financeiro", "rh", "suporte", "painel"] as const) {
      assert.match(comercialAccessProblem(role) ?? "", /não tem acesso ao Comercial/, role);
    }
  });

  it("o cliente é negado", () => {
    assert.match(comercialAccessProblem("cliente") ?? "", /não tem acesso ao Comercial/);
  });

  it("os 11 papéis têm resposta, e só três entram", () => {
    const allowed = PLATFORM_ROLES.filter((role) => comercialAccessProblem(role) === null);
    assert.deepEqual(allowed, ["owner", "admin", "comercial"]);
  });

  it("papel fora da lista é negado", () => {
    assert.match(comercialAccessProblem("viewer" as never) ?? "", /não tem acesso ao Comercial/);
  });
});

describe("aprovação do orçamento", () => {
  it("só o owner aprova", () => {
    assert.deepEqual(COMERCIAL_APPROVER_ROLES, ["owner"]);
    const approvers = PLATFORM_ROLES.filter((role) => canApproveQuote(role));
    assert.deepEqual(approvers, ["owner"]);
  });
});

describe("autorização de faturamento (parte 15): o financeiro só quando a callable pede", () => {
  it("quem registra: owner, admin, comercial e financeiro", () => {
    assert.deepEqual(COMERCIAL_AUTHORIZATION_ROLES, [...COMERCIAL_ROLES, "financeiro"]);
  });

  it("com { financeiro: true }, entram owner, admin, comercial e financeiro, e mais ninguém", () => {
    const allowed = PLATFORM_ROLES.filter((role) => comercialAccessProblem(role, { financeiro: true }) === null);
    assert.deepEqual(allowed, [...COMERCIAL_AUTHORIZATION_ROLES]);
    for (const role of ["interno", "wms", "campo", "rh", "suporte", "painel", "cliente"] as const) {
      assert.match(comercialAccessProblem(role, { financeiro: true }) ?? "", /não tem acesso ao Comercial/, role);
    }
  });

  it("sem a opção, o financeiro continua negado", () => {
    assert.match(comercialAccessProblem("financeiro") ?? "", /não tem acesso ao Comercial/);
    assert.match(comercialAccessProblem("financeiro", {}) ?? "", /não tem acesso ao Comercial/);
  });
});
