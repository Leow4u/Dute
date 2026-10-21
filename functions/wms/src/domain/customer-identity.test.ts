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

describe("código comparado sem acento, sem maiúsculas e sem separador", () => {
  it("Itau e ITAÚ são o mesmo código", () => {
    assert.equal(canonicalCustomerCode("Itau"), canonicalCustomerCode("ITAÚ"));
    assert.equal(canonicalCustomerCode(" itaú  unibanco "), "ITAUUNIBANCO");
  });

  it("o código do WMS (com espaço) e o do Comercial (com hífen) são o mesmo", () => {
    assert.equal(canonicalCustomerCode("BTG Pactual"), canonicalCustomerCode("BTG-PACTUAL"));
    assert.equal(canonicalCustomerCode("Itaú Unibanco"), canonicalCustomerCode("ITAU-UNIBANCO"));
    assert.notEqual(canonicalCustomerCode("BTG Pactual"), canonicalCustomerCode("BTG"));
  });
});

describe("raiz do CNPJ", () => {
  it("8 primeiros dígitos do CNPJ inteiro, com ou sem máscara", () => {
    assert.equal(cnpjRoot("12.345.678/0001-95"), "12345678");
    assert.equal(cnpjRoot("12345678000276"), "12345678");
    assert.equal(cnpjRoot("CNPJ 12.345.678/0001-95"), "12345678");
  });

  it("CNPJ alfanumérico (IN RFB 2.229/2024): 8 primeiros caracteres", () => {
    assert.equal(cnpjRoot("12.ABC.345/01DE-35"), "12ABC345");
    assert.equal(cnpjRoot("12abc34501de35"), "12ABC345");
    assert.equal(cnpjRoot("12.ABC.345/01DE-3X"), null);
  });

  it("sem CNPJ inteiro e válido não há raiz", () => {
    assert.equal(cnpjRoot(undefined), null);
    assert.equal(cnpjRoot(""), null);
    assert.equal(cnpjRoot("123.456.789-01"), null);
    assert.equal(cnpjRoot("12.345.678"), null);
    assert.equal(cnpjRoot("a definir"), null);
    assert.equal(cnpjRoot("12.345.678/0001-90"), null);
    assert.equal(cnpjRoot("12.ABC.345/01DE-36"), null);
  });

  it("preenchimento provisório não tem raiz; a raiz 00000000 (Banco do Brasil) tem", () => {
    assert.equal(cnpjRoot("00.000.000/0000-00"), null);
    assert.equal(cnpjRoot("11.111.111/1111-11"), null);
    assert.equal(cnpjRoot("00.000.000/0001-91"), "00000000");
  });
});

describe("unicidade na criação pelo WMS", () => {
  const rows: CustomerIdentityRow[] = [
    { id: "BTG_Pactual", data: { code: "BTG Pactual", name: "BTG Pactual", sku_prefix: "BTG", document: "33.333.333/0001-91" } },
    { id: "ITA_", data: { code: "ITAÚ", customer_code: "ITAÚ", name: "Itaú Unibanco", sku_prefix: "ITAU" } },
    { id: "Antigo", data: { code: "Antigo", name: "Cliente antigo", status: "archived", archived: true, document: "11.111.111/0001-91" } },
    { id: "ACME", data: { code: "ACME", customer_code: "ACME", name: "Acme Ltda", stage: "prospect", document: "22.222.222/0001-91" } },
    { id: "legado", data: { customer_code: "Legado", name: "Legado" } },
    { id: "ALFA-NOVA", data: { code: "ALFA-NOVA", name: "Alfa Nova", document: "44.ABC.444/0001-56" } },
    { id: "Zeros", data: { code: "Zeros", name: "Cadastro provisório", document: "00.000.000/0000-00" } },
  ];
  const conflict = (code: string, document?: string, documentId = code) =>
    customerIdentityConflict({ code, document, documentId }, rows);

  it("criar Itau com ITAÚ já cadastrado é recusado", () => {
    assert.match(conflict("Itau") ?? "", /O código Itau já é do cliente Itaú Unibanco \(cadastrado como ITAÚ\)/);
    assert.match(conflict("itaú", undefined, "ita_") ?? "", /já é do cliente Itaú Unibanco/);
  });

  it("criar o código do Comercial de um cadastro do WMS é recusado: BTG-PACTUAL e BTG Pactual", () => {
    assert.match(conflict("BTG-PACTUAL") ?? "", /O código BTG-PACTUAL já é do cliente BTG Pactual \(cadastrado como BTG Pactual\)/);
    assert.match(conflict("btg.pactual") ?? "", /já é do cliente BTG Pactual/);
    assert.equal(conflict("BTG"), null);
  });

  it("vale contra arquivado, prospect e cadastro antigo que só tem customer_code", () => {
    assert.match(conflict("antigo") ?? "", /já é do cliente Cliente antigo/);
    assert.match(conflict("LEGADO") ?? "", /já é do cliente Legado/);
  });

  it("o conflito com prospect diz que ele está no Comercial", () => {
    assert.match(conflict("Acme") ?? "", /O código Acme já é do prospect Acme Ltda, no Comercial/);
    assert.match(conflict("Outro", "22.222.222/0002-72") ?? "", /raiz do CNPJ 22222222 já é do prospect Acme Ltda, no Comercial/);
  });

  it("criar com raiz de CNPJ repetida é recusado, inclusive contra filial, arquivado e prospect", () => {
    assert.match(conflict("BTG SP", "33333333000272") ?? "", /raiz do CNPJ 33333333 já é do cliente BTG Pactual/);
    assert.match(conflict("Novo", "11111111000272") ?? "", /já é do cliente Cliente antigo/);
    assert.match(conflict("Outro", "22.222.222/0002-72") ?? "", /já é do prospect Acme Ltda/);
    assert.match(conflict("Alfa", "44.ABC.444/0002-37") ?? "", /raiz do CNPJ 44ABC444 já é do cliente Alfa Nova/);
  });

  it("CNPJ provisório de zeros não bloqueia o próximo cadastro", () => {
    assert.equal(conflict("Provisorio", "00.000.000/0000-00"), null);
  });

  it("sem CNPJ, ou com CNPJ de outra raiz, só o código conta", () => {
    assert.equal(conflict("Safra"), null);
    assert.equal(conflict("Safra", ""), null);
    assert.equal(conflict("Safra", "44.444.444/0001-91"), null);
  });

  it("o próprio documento não conflita consigo mesmo", () => {
    assert.equal(conflict("BTG Pactual", "33.333.333/0001-91", "BTG_Pactual"), null);
  });
});
