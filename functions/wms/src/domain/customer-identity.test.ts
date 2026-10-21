import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CUSTOMER_STAGES,
  canonicalCustomerCode,
  cnpjRoot,
  customerIdentityConflict,
  customerStage,
  isProspect,
  type CustomerIdentityRow,
} from "./customer-profile.js";

describe("estágio do cadastro", () => {
  it("prospect e cliente; sem o campo vale cliente", () => {
    assert.deepEqual(CUSTOMER_STAGES, ["prospect", "cliente"]);
    assert.equal(customerStage(undefined), "cliente");
    assert.equal(customerStage(null), "cliente");
    assert.equal(customerStage(""), "cliente");
    assert.equal(customerStage("cliente"), "cliente");
    assert.equal(customerStage("prospect"), "prospect");
    assert.equal(customerStage(" Prospect "), "prospect");
  });

  it("valor desconhecido não vira prospect", () => {
    assert.equal(customerStage("lead"), "cliente");
    assert.equal(isProspect({ code: "BTG Pactual" }), false);
    assert.equal(isProspect({ stage: "prospect" }), true);
    assert.equal(isProspect(null), false);
  });
});

describe("código comparado sem acento e sem maiúsculas", () => {
  it("Itau e ITAÚ são o mesmo código", () => {
    assert.equal(canonicalCustomerCode("Itau"), canonicalCustomerCode("ITAÚ"));
    assert.equal(canonicalCustomerCode(" itaú  unibanco "), "ITAU UNIBANCO");
    assert.notEqual(canonicalCustomerCode("BTG Pactual"), canonicalCustomerCode("BTG-Pactual"));
  });
});

describe("raiz do CNPJ", () => {
  it("8 primeiros dígitos do CNPJ inteiro, com ou sem máscara", () => {
    assert.equal(cnpjRoot("12.345.678/0001-90"), "12345678");
    assert.equal(cnpjRoot("12345678000271"), "12345678");
  });

  it("sem CNPJ inteiro não há raiz", () => {
    assert.equal(cnpjRoot(undefined), null);
    assert.equal(cnpjRoot(""), null);
    assert.equal(cnpjRoot("123.456.789-01"), null);
    assert.equal(cnpjRoot("12.345.678"), null);
    assert.equal(cnpjRoot("a definir"), null);
  });
});

describe("unicidade na criação pelo WMS", () => {
  const rows: CustomerIdentityRow[] = [
    { id: "BTG_Pactual", data: { code: "BTG Pactual", name: "BTG Pactual", sku_prefix: "BTG", document: "33.333.333/0001-33" } },
    { id: "ITA_", data: { code: "ITAÚ", customer_code: "ITAÚ", name: "Itaú Unibanco", sku_prefix: "ITAU" } },
    { id: "Antigo", data: { code: "Antigo", name: "Cliente antigo", status: "archived", archived: true, document: "11.111.111/0001-11" } },
    { id: "ACME", data: { code: "ACME", customer_code: "ACME", name: "Acme Ltda", stage: "prospect", document: "22.222.222/0001-22" } },
    { id: "legado", data: { customer_code: "Legado", name: "Legado" } },
  ];
  const conflict = (code: string, document?: string, documentId = code) =>
    customerIdentityConflict({ code, document, documentId }, rows);

  it("criar Itau com ITAÚ já cadastrado é recusado", () => {
    assert.match(conflict("Itau") ?? "", /O código Itau já é do cliente Itaú Unibanco \(cadastrado como ITAÚ\)/);
    assert.match(conflict("itaú", undefined, "ita_") ?? "", /já é do cliente Itaú Unibanco/);
  });

  it("vale contra arquivado, prospect e cadastro antigo que só tem customer_code", () => {
    assert.match(conflict("antigo") ?? "", /já é do cliente Cliente antigo/);
    assert.match(conflict("Acme") ?? "", /já é do cliente Acme Ltda/);
    assert.match(conflict("LEGADO") ?? "", /já é do cliente Legado/);
  });

  it("criar com raiz de CNPJ repetida é recusado, inclusive contra filial, arquivado e prospect", () => {
    assert.match(conflict("BTG SP", "33333333000226") ?? "", /raiz do CNPJ 33333333 já é do cliente BTG Pactual/);
    assert.match(conflict("Novo", "11111111000199") ?? "", /já é do cliente Cliente antigo/);
    assert.match(conflict("Outro", "22.222.222/0002-03") ?? "", /já é do cliente Acme Ltda/);
  });

  it("sem CNPJ, ou com CNPJ de outra raiz, só o código conta", () => {
    assert.equal(conflict("Safra"), null);
    assert.equal(conflict("Safra", ""), null);
    assert.equal(conflict("Safra", "44.444.444/0001-44"), null);
  });

  it("o próprio documento não conflita consigo mesmo", () => {
    assert.equal(conflict("BTG Pactual", "33.333.333/0001-33", "BTG_Pactual"), null);
  });
});
