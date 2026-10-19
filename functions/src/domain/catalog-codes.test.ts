import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertManagedCatalogCreateAllowed,
  formatSkuCode,
  normalizeBarcode,
} from "./catalog-codes.js";

describe("SKU gerado na sigla do cliente", () => {
  it("formata a sigla com seis dígitos", () => {
    assert.equal(formatSkuCode("BTG", 1), "BTG-000001");
    assert.equal(formatSkuCode("ITAU", 123), "ITAU-000123");
    assert.equal(formatSkuCode("DUT", 999999), "DUT-999999");
    assert.equal(formatSkuCode("DUT", 1000000), "DUT-1000000");
  });

  it("recusa sequência inválida", () => {
    assert.throws(() => formatSkuCode("BTG", 0), /inválida/);
    assert.throws(() => formatSkuCode("BTG", 1.5), /inválida/);
  });
});

describe("código de barras", () => {
  it("compara sem espaços e sem caixa", () => {
    assert.equal(normalizeBarcode(" 7891 0000 0001 "), "789100000001");
    assert.equal(normalizeBarcode("abc-1"), "ABC-1");
    assert.equal(normalizeBarcode(undefined), "");
  });
});

describe("cadastro avulso de catálogo", () => {
  it("não cria produto nem SKU; edita e arquiva", () => {
    assert.throws(() => assertManagedCatalogCreateAllowed("skus", "create"), /entra pelo Receber ou pela Contagem/);
    assert.throws(() => assertManagedCatalogCreateAllowed("products", "create"), /entra pelo Receber ou pela Contagem/);
    assert.doesNotThrow(() => assertManagedCatalogCreateAllowed("skus", "update"));
    assert.doesNotThrow(() => assertManagedCatalogCreateAllowed("products", "archive"));
    assert.doesNotThrow(() => assertManagedCatalogCreateAllowed("customers", "create"));
  });
});
