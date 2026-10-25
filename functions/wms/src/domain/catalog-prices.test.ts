import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canSeeCatalogPrice,
  canSeeMerchandiseValue,
  catalogPriceId,
  hasPublishedMoney,
  merchandiseValue,
  unitPriceOf,
} from "./catalog-prices.js";

describe("preço fora da operação", () => {
  it("só owner, admin e financeiro veem o preço de catálogo", () => {
    for (const role of ["owner", "admin", "financeiro"]) {
      assert.equal(canSeeCatalogPrice(role), true);
    }
    for (const role of ["interno", "wms", "suporte", "cliente", "campo", "comercial"]) {
      assert.equal(canSeeCatalogPrice(role), false);
    }
  });

  it("o cliente vê o valor da própria mercadoria", () => {
    assert.equal(canSeeMerchandiseValue("cliente"), true);
    assert.equal(canSeeMerchandiseValue("wms"), false);
    assert.equal(canSeeMerchandiseValue("interno"), false);
  });

  it("o id do preço não carrega espaço nem barra", () => {
    assert.equal(
      catalogPriceId("BTG Pactual", "BTG-000001"),
      "cprice_BTG_Pactual__BTG-000001",
    );
  });

  it("tira o unitário do campo direto ou do custo total", () => {
    assert.equal(unitPriceOf({ preco_unit: 12.5, custo_total: 100 }), 12.5);
    assert.equal(unitPriceOf({ custo_total: 80, estoque_btg: 4 }), 20);
    assert.equal(unitPriceOf({ produto: "Camisa" }), undefined);
    assert.equal(hasPublishedMoney({ custo_total: 10 }), true);
    assert.equal(hasPublishedMoney({ produto: "Camisa" }), false);
  });

  it("soma o total gravado e cai no legado quando o preço ainda não foi separado", () => {
    const value = merchandiseValue(
      [
        { sku_code: "SKU-1", qty_on_hand: 4, total_cost: 999 },
        { sku_code: "SKU-2", client_item_code: "ITEM-2", qty_on_hand: 2, total_cost: 30 },
      ],
      [
        { sku_code: "SKU-1", item_code: "ITEM-1", preco_unit: 10, total_cost: 40 },
      ],
    );
    assert.equal(value, 40 + 30);
  });

  it("o valor do SKU com preço unitário é o saldo vezes o preço, mesmo com o total gravado zerado ou velho", () => {
    const value = merchandiseValue(
      [
        // O pedido zerou o total, com as 10 peças ainda no armazém.
        { sku_code: "SKU-1", qty_on_hand: 10 },
        // A entrega levou 6 de 10, e o total ficou o de antes.
        { sku_code: "SKU-2", qty_on_hand: 4 },
        // Sem preço unitário: vale o total gravado.
        { sku_code: "SKU-3", qty_on_hand: 2 },
      ],
      [
        { sku_code: "SKU-1", preco_unit: 25, total_cost: 0 },
        { sku_code: "SKU-2", preco_unit: 25, total_cost: 250 },
        { sku_code: "SKU-3", total_cost: 90 },
      ],
    );
    assert.equal(value, 10 * 25 + 4 * 25 + 90);
  });
});
