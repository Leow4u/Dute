import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { inviteCustomerProblem } from "./customer-invite.js";

const comSigla = { code: "Itaú", customer_code: "Itaú", name: "Itaú Unibanco", sku_prefix: "ITAU", status: "active" };

function problem(customerCode: string, customers: Array<Record<string, unknown>>, role = "cliente") {
  return inviteCustomerProblem({ role, customerCode, customers });
}

describe("convite de usuário cliente", () => {
  it("cliente com cadastro ativo e sigla recebe convite", () => {
    assert.equal(problem("Itaú", [comSigla]), null);
    assert.equal(problem("Itaú", [{ ...comSigla, status: "paused" }]), null);
  });

  it("prospect do Comercial não recebe convite", () => {
    const prospect = { code: "ACME", customer_code: "ACME", name: "Acme", stage: "prospect", status: "active" };
    assert.match(problem("ACME", [prospect]) ?? "", /prospect do Comercial/);
    assert.match(problem("ACME", [{ ...prospect, sku_prefix: "ACM" }]) ?? "", /prospect do Comercial/);
  });

  it("cadastro arquivado não recebe convite", () => {
    assert.match(problem("Itaú", [{ ...comSigla, status: "archived", archived: true }]) ?? "", /arquivado/);
    assert.match(problem("Itaú", [{ ...comSigla, status: "archived" }]) ?? "", /arquivado/);
  });

  it("código sem cadastro não recebe convite", () => {
    assert.match(problem("Inexistente", []) ?? "", /não está cadastrado/);
    assert.match(problem("itaú", [comSigla]) ?? "", /não está cadastrado/);
  });

  it("cliente sem sigla (sem armazenagem) não recebe convite", () => {
    const semSigla = { code: "Mudancas", customer_code: "Mudancas", name: "Mudanças SP", stage: "cliente", status: "active" };
    assert.match(problem("Mudancas", [semSigla]) ?? "", /não tem sigla do SKU/);
    assert.match(problem("Mudancas", [{ ...semSigla, sku_prefix: "  " }]) ?? "", /não tem sigla do SKU/);
  });

  it("trava: a BTG sem client_access, sem client_profiles, sem sigla e até sem cadastro continua recebendo convite", () => {
    assert.equal(problem("BTG Pactual", []), null);
    assert.equal(problem("BTG Pactual", [{ code: "BTG Pactual", name: "BTG Pactual", status: "active" }]), null);
  });

  it("só o perfil cliente é conferido; cliente sem código é recusado", () => {
    assert.equal(problem("Dutelog", [], "interno"), null);
    assert.equal(problem("", [], "admin"), null);
    assert.match(problem("", []) ?? "", /Informe o cliente/);
  });
});

describe("o convite passa pela regra no backend", () => {
  it("mutateManagedEntity confere o cliente do convite antes de gravar", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, "../../src/index.ts"), "utf8");
    const start = source.indexOf("export const mutateManagedEntity = onCall(");
    assert.ok(start > 0, "mutateManagedEntity não encontrado");
    const body = source.slice(start, source.indexOf("\nexport const ", start + 1));
    const check = body.indexOf("await assertInviteCustomerAllowed(transaction, db, payload");
    assert.ok(check > 0, "o convite não chama assertInviteCustomerAllowed");
    assert.ok(check < body.indexOf("transaction.create(targetRef, payload)"), "a conferência vem antes da escrita");
  });
});
