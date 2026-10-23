import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { chaveDaDevolucao, interpretarRetorno, problemaDoRetorno, retornoDoPedido } from "./order-return.js";

/** O retorno ao armazém do pedido de saída (parte 4.5d): só o retorno a receber, uma vez. Dados sintéticos. */

function rejeita(fn: () => unknown): HttpsError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

describe("o retorno do pedido", () => {
  it("só o retorno a receber, do pedido com cliente; o recebido não se recebe de novo", () => {
    const pedido = { customer_code: "BTG Pactual", retorno: { status: "a_receber", os: "10050-02", demanda: "10050", return_id: null } };
    assert.equal(problemaDoRetorno(pedido), null);
    assert.deepEqual(retornoDoPedido(pedido), { status: "a_receber", os: "10050-02", demanda: "10050", returnId: null });
    assert.equal(problemaDoRetorno({ customer_code: "BTG Pactual" }), "O pedido não tem retorno da Operação a receber.");
    assert.equal(problemaDoRetorno({ customer_code: "BTG Pactual", retorno: { status: "recebido", return_id: "ret_1" } }), "O retorno do pedido já foi recebido.");
    assert.equal(problemaDoRetorno({ retorno: { status: "a_receber" } }), "O pedido está sem o cliente.");
  });

  it("a devolução tem a chave do pedido; o que voltou vem inteiro e positivo", () => {
    assert.equal(chaveDaDevolucao("ord_118"), "pedido:ord_118");
    const item = { sku_code: "BTG-1", client_item_code: "ITEM-1", quantity: 12 };
    assert.equal(interpretarRetorno({ order_id: "ord_118", items: [item] }).items[0].quantity, 12);
    assert.match(rejeita(() => interpretarRetorno({ order_id: "ord_118", items: [] })).message, /Informe o que voltou/);
    assert.match(rejeita(() => interpretarRetorno({ order_id: "ord_118", items: [{ ...item, quantity: 0 }] })).message, /quantidade que voltou/);
    assert.match(rejeita(() => interpretarRetorno({ order_id: "ord_118", items: [{ ...item, quantity: 1.5 }] })).message, /inteira/);
    assert.match(rejeita(() => interpretarRetorno({ order_id: "ord_118", items: [item], customer_code: "X" })).message, /Campo não aceito: customer_code/);
  });
});
