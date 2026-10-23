import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { entregaDoPedido, instanteDeSaoPaulo, interpretarDemandaDoArmazem, itensDaEntrega, pedidoDoWms, tituloDaEntrega } from "./demanda-do-armazem.js";

/**
 * A entrega do pedido de saída pela Dutelog na Operação (parte 4.5b): só a
 * entrega pela Dutelog, lida do pedido, vira demanda; a retirada pelo
 * cliente não gera OS. Dados sintéticos.
 */

const ENTREGA = {
  modo: "dutelog",
  destino: "Transamerica Expo · Pavilhão B",
  data: "2026-10-28",
  hora: "13:00",
  contato: { nome: "Lucas Prado", telefone: "11987654321" },
  montagem: true,
  retorno: { data: "2026-10-30", hora: "18:00" },
  definida_em: "2026-10-23T13:00:00.000Z",
  demanda: null,
};

const pedido = (extra: Record<string, unknown> = {}) => pedidoDoWms("ord_118", { customer_code: "BTG Pactual", order_number: "PED-0118", status: "EM_EXPEDICAO", entrega: ENTREGA, ...extra });

describe("a entrega do pedido na Operação", () => {
  it("lê a entrega pela Dutelog do pedido, com o contato, a montagem e o retorno", () => {
    assert.deepEqual(entregaDoPedido(pedido()), {
      destino: "Transamerica Expo · Pavilhão B",
      data: "2026-10-28",
      hora: "13:00",
      contato: { nome: "Lucas Prado", telefone: "11987654321" },
      montagem: true,
      retorno: { data: "2026-10-30", hora: "18:00" },
      definidaEm: "2026-10-23T13:00:00.000Z",
      demanda: null,
    });
    assert.equal(pedido().numero, "PED-0118");
    assert.equal(tituloDaEntrega(pedido()), "Entrega do pedido PED-0118");
    assert.equal(instanteDeSaoPaulo("2026-10-28", "13:00"), "2026-10-28T16:00:00.000Z");
  });

  it("a retirada pelo cliente não gera OS; sem entrega, já em demanda, saído ou incompleto também não", () => {
    assert.equal(entregaDoPedido(pedido({ entrega: { modo: "retirada", data: "2026-10-24", hora: "09:00", quem_retira: "Carlos" } })), "A retirada pelo cliente não gera OS.");
    assert.equal(entregaDoPedido(pedido({ entrega: null })), "Defina a entrega do pedido no WMS.");
    assert.equal(entregaDoPedido(pedido({ entrega: { ...ENTREGA, demanda: "10050" } })), "A entrega já virou a demanda 10050.");
    for (const status of ["EXPEDIDO", "ENTREGUE", "CANCELADO"]) assert.equal(entregaDoPedido(pedido({ status })), "O pedido já saiu do armazém.", status);
    assert.equal(entregaDoPedido(pedido({ entrega: { ...ENTREGA, hora: "13h" } })), "A entrega do pedido está incompleta no WMS.");
    assert.equal(entregaDoPedido(pedido({ customer_code: "" })), "O pedido está sem o cliente.");
  });

  it("os itens: a viagem de ida, a montagem pedida e, com o retorno, a viagem de volta", () => {
    const completa = itensDaEntrega(pedido(), { montagem: true, retorno: { data: "2026-10-30", hora: "18:00" } });
    assert.deepEqual(completa.pedidos.map((item) => [item.item, item.unidade, item.quantidade]), [
      ["Transporte do pedido PED-0118", "viagem", "1"],
      ["Montagem no destino", "vb", "1"],
      ["Desmontagem e retorno ao armazém do pedido PED-0118", "viagem", "1"],
    ]);
    assert.deepEqual([completa.ida, completa.volta], [[0, 1], [2]]);
    const simples = itensDaEntrega(pedido(), { montagem: false, retorno: null });
    assert.deepEqual([simples.pedidos.length, simples.ida, simples.volta], [1, [0], []]);
  });

  it("quem chama só diz o pedido: a entrega é lida do pedido, nunca do navegador", () => {
    assert.throws(() => interpretarDemandaDoArmazem({ idempotency_key: "k", order_id: "ord_118", entrega: ENTREGA }), /Campo não aceito: entrega\./);
    assert.equal(interpretarDemandaDoArmazem({ idempotency_key: "k", order_id: "ord_118" }).order_id, "ord_118");
  });
});
